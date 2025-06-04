// src/services/ticketService.js - TPG Ticket Management Service
const Ticket = require('../models/Ticket');
const TicketComment = require('../models/TicketComment');
const TicketAttachment = require('../models/TicketAttachment');
const User = require('../models/User');
const logger = require('../config/logger');

class TicketService {
  /**
   * Create a new ticket with validation and business logic
   */
  async createTicket(ticketData, createdBy, context = {}) {
    try {
      // Generate unique ticket number
      const ticketNumber = await this.generateTicketNumber();

      // Prepare ticket data
      const ticket = await Ticket.query().insert({
        ticket_number: ticketNumber,
        title: ticketData.title,
        description: ticketData.description,
        category: ticketData.category,
        urgency: ticketData.urgency || 'medium',
        status: 'open',
        user_id: createdBy,
        estimated_resolution_hours: ticketData.estimated_resolution_hours || this.getDefaultResolutionHours(ticketData.category),
        tags: ticketData.tags || [],
        metadata: {
          ...ticketData.metadata,
          user_agent: context.userAgent,
          ip_address: context.ip,
          created_via: context.createdVia || 'web_portal'
        }
      });

      // Auto-assign based on category and urgency
      await this.autoAssignTicket(ticket);

      // Create initial activity comment
      await this.createSystemComment(ticket.id, 'Ticket created', createdBy);

      // Log creation
      logger.info(`Ticket created: ${ticket.ticket_number}`, {
        ticket_id: ticket.id,
        user_id: createdBy,
        category: ticket.category,
        urgency: ticket.urgency
      });

      return await this.getTicketById(ticket.id, { includeRelations: true });
    } catch (error) {
      logger.error('TicketService.createTicket error:', error);
      throw error;
    }
  }

  /**
   * Get ticket by ID with optional relations
   */
  async getTicketById(id, options = {}) {
    try {
      const { includeRelations = false, includeStats = false } = options;

      let query = Ticket.query().findById(id);

      if (includeRelations) {
        query = query.withGraphFetched(`[
          user.[select(id, username, email, pharmacy_name, tpg_license_number)],
          assignedUser.[select(id, username, email)],
          comments(orderByCreated).[user.[select(id, username, email)], attachments],
          attachments.[user.[select(id, username, email)]]
        ]`).modifiers({
          orderByCreated: builder => builder.orderBy('created_at', 'asc')
        });
      }

      const ticket = await query;

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      let result = { ticket };

      if (includeStats) {
        result.statistics = await this.getTicketStatistics(id);
      }

      return result;
    } catch (error) {
      logger.error('TicketService.getTicketById error:', error);
      throw error;
    }
  }

  /**
   * Update ticket with validation and activity tracking
   */
  async updateTicket(id, updates, updatedBy, context = {}) {
    try {
      const ticket = await Ticket.query().findById(id);
      if (!ticket) {
        throw new Error('Ticket not found');
      }

      // Store old values for comparison
      const oldValues = {
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        urgency: ticket.urgency,
        status: ticket.status,
        assigned_to: ticket.assigned_to
      };

      // Update ticket
      const updatedTicket = await ticket.$query().patchAndFetch(updates);

      // Create activity comments for significant changes
      await this.trackTicketChanges(ticket, updates, updatedBy, oldValues);

      // Handle status-specific logic
      if (updates.status && updates.status !== oldValues.status) {
        await this.handleStatusChange(updatedTicket, oldValues.status, updatedBy);
      }

      // Handle assignment changes
      if (updates.assigned_to !== undefined && updates.assigned_to !== oldValues.assigned_to) {
        await this.handleAssignmentChange(updatedTicket, oldValues.assigned_to, updatedBy);
      }

      logger.info(`Ticket updated: ${ticket.ticket_number}`, {
        ticket_id: id,
        updated_by: updatedBy,
        changes: Object.keys(updates)
      });

      return updatedTicket;
    } catch (error) {
      logger.error('TicketService.updateTicket error:', error);
      throw error;
    }
  }

  /**
   * Assign ticket to user
   */
  async assignTicket(ticketId, assignedTo, assignedBy, reason = '') {
    try {
      const ticket = await Ticket.query().findById(ticketId);
      if (!ticket) {
        throw new Error('Ticket not found');
      }

      // Validate assignee
      if (assignedTo) {
        const assignee = await User.query().findById(assignedTo);
        if (!assignee) {
          throw new Error('Assignee not found');
        }

        if (!['admin', 'super_admin'].includes(assignee.role)) {
          throw new Error('Tickets can only be assigned to admin users');
        }

        if (assignee.status !== 'active') {
          throw new Error('Cannot assign tickets to inactive users');
        }
      }

      const oldAssignee = ticket.assigned_to;
      
      // Update assignment
      const updatedTicket = await ticket.$query().patchAndFetch({
        assigned_to: assignedTo || null,
        status: assignedTo ? 'in-progress' : 'open'
      });

      // Create assignment comment
      const assignmentMessage = assignedTo 
        ? `Ticket assigned to ${(await User.query().findById(assignedTo)).username}` 
        : 'Ticket unassigned';
      
      await this.createSystemComment(
        ticketId, 
        `${assignmentMessage}${reason ? `. Reason: ${reason}` : ''}`,
        assignedBy
      );

      // Send notifications
      await this.sendAssignmentNotifications(updatedTicket, oldAssignee, assignedTo);

      logger.info(`Ticket assignment changed: ${ticket.ticket_number}`, {
        ticket_id: ticketId,
        old_assignee: oldAssignee,
        new_assignee: assignedTo,
        assigned_by: assignedBy
      });

      return updatedTicket;
    } catch (error) {
      logger.error('TicketService.assignTicket error:', error);
      throw error;
    }
  }

  /**
   * Update ticket status with proper validation
   */
  async updateTicketStatus(ticketId, status, updatedBy, options = {}) {
    try {
      const { resolutionNotes = '', satisfactionRating, satisfactionComment } = options;

      const ticket = await Ticket.query().findById(ticketId);
      if (!ticket) {
        throw new Error('Ticket not found');
      }

      // Validate status transition
      if (!this.isValidStatusTransition(ticket.status, status)) {
        throw new Error(`Cannot change status from ${ticket.status} to ${status}`);
      }

      const updates = { status };

      // Handle resolution
      if (status === 'resolved') {
        updates.resolved_at = new Date().toISOString();
        updates.resolution_notes = resolutionNotes;
        
        const createdAt = new Date(ticket.created_at);
        const resolvedAt = new Date();
        updates.actual_resolution_hours = Math.round((resolvedAt - createdAt) / (1000 * 60 * 60));
      }

      // Handle closing
      if (status === 'closed') {
        updates.closed_at = new Date().toISOString();
        if (satisfactionRating) {
          updates.satisfaction_rating = satisfactionRating;
          updates.satisfaction_comment = satisfactionComment || '';
        }
      }

      // Update ticket
      const updatedTicket = await ticket.$query().patchAndFetch(updates);

      // Create status change comment
      let statusMessage = `Status changed from ${ticket.status} to ${status}`;
      if (resolutionNotes) {
        statusMessage += `. Resolution: ${resolutionNotes}`;
      }

      await this.createSystemComment(ticketId, statusMessage, updatedBy);

      // Send notifications
      await this.sendStatusUpdateNotifications(updatedTicket);

      logger.info(`Ticket status updated: ${ticket.ticket_number}`, {
        ticket_id: ticketId,
        old_status: ticket.status,
        new_status: status,
        updated_by: updatedBy
      });

      return updatedTicket;
    } catch (error) {
      logger.error('TicketService.updateTicketStatus error:', error);
      throw error;
    }
  }

  /**
   * Search tickets with advanced filtering
   */
  async searchTickets(filters = {}, pagination = {}) {
    try {
      const {
        search,
        status,
        category,
        urgency,
        assignedTo,
        userId,
        createdAfter,
        createdBefore,
        sortBy = 'created_at',
        sortOrder = 'desc'
      } = filters;

      const { page = 1, limit = 20 } = pagination;

      let query = Ticket.query()
        .withGraphFetched('[user.[select(id, username, email)], assignedUser.[select(id, username, email)]]');

      // Apply search
      if (search) {
        query = query.where(builder => {
          builder
            .where('title', 'ilike', `%${search}%`)
            .orWhere('description', 'ilike', `%${search}%`)
            .orWhere('ticket_number', 'ilike', `%${search}%`);
        });
      }

      // Apply filters
      if (status) {
        const statuses = Array.isArray(status) ? status : [status];
        query = query.whereIn('status', statuses);
      }

      if (category) {
        const categories = Array.isArray(category) ? category : [category];
        query = query.whereIn('category', categories);
      }

      if (urgency) {
        const urgencies = Array.isArray(urgency) ? urgency : [urgency];
        query = query.whereIn('urgency', urgencies);
      }

      if (assignedTo) {
        if (assignedTo === 'unassigned') {
          query = query.whereNull('assigned_to');
        } else {
          query = query.where('assigned_to', assignedTo);
        }
      }

      if (userId) {
        query = query.where('user_id', userId);
      }

      if (createdAfter) {
        query = query.where('created_at', '>=', createdAfter);
      }

      if (createdBefore) {
        query = query.where('created_at', '<=', createdBefore);
      }

      // Apply sorting
      const validSortFields = [
        'created_at', 'updated_at', 'title', 'status', 'urgency', 
        'category', 'resolved_at', 'ticket_number'
      ];
      
      if (validSortFields.includes(sortBy)) {
        query = query.orderBy(sortBy, sortOrder);
      }

      // Get total count
      const totalQuery = query.clone().count();
      
      // Apply pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      query = query.offset(offset).limit(parseInt(limit));

      const [tickets, [{ count: total }]] = await Promise.all([
        query,
        totalQuery
      ]);

      return {
        tickets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('TicketService.searchTickets error:', error);
      throw error;
    }
  }

  /**
   * Get ticket statistics
   */
  async getTicketStatistics(ticketId = null, filters = {}) {
    try {
      let query = Ticket.query();

      if (ticketId) {
        query = query.where('id', ticketId);
      }

      // Apply filters
      if (filters.startDate) {
        query = query.where('created_at', '>=', filters.startDate);
      }

      if (filters.endDate) {
        query = query.where('created_at', '<=', filters.endDate);
      }

      if (filters.userId) {
        query = query.where('user_id', filters.userId);
      }

      if (filters.category) {
        query = query.where('category', filters.category);
      }

      const tickets = await query;

      if (ticketId && tickets.length === 1) {
        // Individual ticket stats
        const ticket = tickets[0];
        const comments = await TicketComment.query().where('ticket_id', ticketId);
        const attachments = await TicketAttachment.query().where('ticket_id', ticketId);

        return {
          age_hours: ticket.getAgeInHours(),
          resolution_time_hours: ticket.getResolutionTimeInHours(),
          is_overdue: ticket.isOverdue(),
          needs_escalation: ticket.needsEscalation(),
          priority_score: ticket.getPriorityScore(),
          comment_count: comments.length,
          attachment_count: attachments.length,
          status_history: await this.getStatusHistory(ticketId)
        };
      } else {
        // Aggregate stats
        return this.calculateAggregateStats(tickets);
      }
    } catch (error) {
      logger.error('TicketService.getTicketStatistics error:', error);
      throw error;
    }
  }

  /**
   * Get overdue tickets
   */
  async getOverdueTickets(limit = 50) {
    try {
      const tickets = await Ticket.query()
        .whereIn('status', ['open', 'in-progress'])
        .whereNotNull('estimated_resolution_hours')
        .withGraphFetched('[user.[select(id, username, email)], assignedUser.[select(id, username, email)]]')
        .orderBy('created_at', 'asc')
        .limit(limit);

      return tickets.filter(ticket => ticket.isOverdue());
    } catch (error) {
      logger.error('TicketService.getOverdueTickets error:', error);
      throw error;
    }
  }

  /**
   * Get tickets needing escalation
   */
  async getTicketsNeedingEscalation() {
    try {
      const tickets = await Ticket.query()
        .whereIn('status', ['open', 'in-progress'])
        .withGraphFetched('[user.[select(id, username, email)], assignedUser.[select(id, username, email)]]');

      return tickets.filter(ticket => ticket.needsEscalation());
    } catch (error) {
      logger.error('TicketService.getTicketsNeedingEscalation error:', error);
      throw error;
    }
  }

  // Helper methods

  /**
   * Generate unique ticket number
   */
  async generateTicketNumber() {
    const prefix = process.env.TICKET_ID_PREFIX || 'TPG';
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    
    const todayCount = await Ticket.query()
      .count()
      .where('created_at', '>=', startOfDay.toISOString())
      .where('created_at', '<', endOfDay.toISOString());
    
    const sequence = String(parseInt(todayCount[0].count) + 1).padStart(4, '0');
    
    return `${prefix}-${year}${month}-${sequence}`;
  }

  /**
   * Auto-assign ticket based on rules
   */
  async autoAssignTicket(ticket) {
    try {
      // Auto-assignment rules based on category and urgency
      const assignmentRules = {
        'payment-gateway': { urgency: 'critical', assignToRole: 'admin' },
        'system-errors': { urgency: 'high', assignToRole: 'admin' },
        'performance-issues': { urgency: 'high', assignToRole: 'admin' }
      };

      const rule = assignmentRules[ticket.category];
      if (rule && ['high', 'critical'].includes(ticket.urgency)) {
        // Find available admin
        const availableAdmin = await User.query()
          .where('role', 'admin')
          .where('status', 'active')
          .orderBy('last_login', 'desc')
          .first();

        if (availableAdmin) {
          await this.assignTicket(ticket.id, availableAdmin.id, 'system', 'Auto-assigned based on category and urgency');
        }
      }
    } catch (error) {
      logger.error(`Auto-assignment failed for ticket ${ticket.ticket_number}:`, error);
    }
  }

  /**
   * Get default resolution hours by category
   */
  getDefaultResolutionHours(category) {
    const defaultHours = {
      'cpd-points': 48,
      'license-management': 72,
      'performance-issues': 24,
      'payment-gateway': 24,
      'user-interface': 24,
      'data-inconsistencies': 48,
      'system-errors': 24
    };

    return defaultHours[category] || 24;
  }

  /**
   * Validate status transitions
   */
  isValidStatusTransition(currentStatus, newStatus) {
    const validTransitions = {
      'open': ['in-progress', 'resolved', 'closed'],
      'in-progress': ['open', 'resolved', 'closed'],
      'resolved': ['closed', 'in-progress'],
      'closed': ['in-progress']
    };
    
    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }

  /**
   * Create system comment
   */
  async createSystemComment(ticketId, content, userId) {
    try {
      await TicketComment.query().insert({
        ticket_id: ticketId,
        user_id: userId,
        content,
        is_internal: true
      });
    } catch (error) {
      logger.error('Failed to create system comment:', error);
    }
  }

  /**
   * Track ticket changes and create activity comments
   */
  async trackTicketChanges(ticket, updates, updatedBy, oldValues) {
    const changes = [];
    
    if (updates.title && updates.title !== oldValues.title) {
      changes.push(`Title changed to "${updates.title}"`);
    }
    
    if (updates.urgency && updates.urgency !== oldValues.urgency) {
      changes.push(`Priority changed from ${oldValues.urgency} to ${updates.urgency}`);
    }
    
    if (updates.category && updates.category !== oldValues.category) {
      changes.push(`Category changed from ${oldValues.category} to ${updates.category}`);
    }
    
    if (changes.length > 0) {
      await this.createSystemComment(ticket.id, `Ticket updated: ${changes.join(', ')}`, updatedBy);
    }
  }

  /**
   * Handle status change logic
   */
  async handleStatusChange(ticket, oldStatus, updatedBy) {
    // Additional logic for status changes
    if (ticket.status === 'resolved' && oldStatus !== 'resolved') {
      // Calculate resolution metrics
      const resolutionTime = ticket.getResolutionTimeInHours();
      logger.info(`Ticket resolved: ${ticket.ticket_number}`, {
        ticket_id: ticket.id,
        resolution_time_hours: resolutionTime,
        estimated_hours: ticket.estimated_resolution_hours
      });
    }
  }

  /**
   * Handle assignment change logic
   */
  async handleAssignmentChange(ticket, oldAssignee, updatedBy) {
    // Send notifications to old and new assignees
    await this.sendAssignmentNotifications(ticket, oldAssignee, ticket.assigned_to);
  }

  /**
   * Send assignment notifications
   */
  async sendAssignmentNotifications(ticket, oldAssignee, newAssignee) {
    // TODO: Implement email notifications
    logger.info(`Assignment notification needed for ticket ${ticket.ticket_number}`, {
      old_assignee: oldAssignee,
      new_assignee: newAssignee
    });
  }

  /**
   * Send status update notifications
   */
  async sendStatusUpdateNotifications(ticket) {
    // TODO: Implement email notifications
    logger.info(`Status update notification needed for ticket ${ticket.ticket_number}`, {
      status: ticket.status
    });
  }

  /**
   * Get status history for a ticket
   */
  async getStatusHistory(ticketId) {
    // This would query audit logs or system comments to build status history
    const systemComments = await TicketComment.query()
      .where('ticket_id', ticketId)
      .where('is_internal', true)
      .where('content', 'like', '%Status changed%')
      .orderBy('created_at', 'asc');

    return systemComments.map(comment => ({
      timestamp: comment.created_at,
      description: comment.content,
      user_id: comment.user_id
    }));
  }

  /**
   * Calculate aggregate statistics
   */
  calculateAggregateStats(tickets) {
    const total = tickets.length;
    
    if (total === 0) {
      return {
        total: 0,
        by_status: {},
        by_category: {},
        by_urgency: {},
        resolution_stats: { average_hours: 0, median_hours: 0 },
        satisfaction_stats: { average_rating: 0, total_ratings: 0 }
      };
    }

    const byStatus = this.groupBy(tickets, 'status');
    const byCategory = this.groupBy(tickets, 'category');
    const byUrgency = this.groupBy(tickets, 'urgency');
    
    const resolvedTickets = tickets.filter(t => t.resolved_at);
    const resolutionTimes = resolvedTickets.map(t => t.getResolutionTimeInHours()).filter(t => t !== null);
    
    const ratedTickets = tickets.filter(t => t.satisfaction_rating);
    const ratings = ratedTickets.map(t => t.satisfaction_rating);

    return {
      total,
      by_status: byStatus,
      by_category: byCategory,
      by_urgency: byUrgency,
      resolution_stats: {
        average_hours: resolutionTimes.length > 0 ? 
          Math.round(resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length) : 0,
        median_hours: resolutionTimes.length > 0 ? 
          resolutionTimes.sort((a, b) => a - b)[Math.floor(resolutionTimes.length / 2)] : 0
      },
      satisfaction_stats: {
        average_rating: ratings.length > 0 ? 
          Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0,
        total_ratings: ratings.length
      }
    };
  }

  /**
   * Group array by field
   */
  groupBy(array, field) {
    return array.reduce((acc, item) => {
      const key = item[field];
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }
}

module.exports = new TicketService();