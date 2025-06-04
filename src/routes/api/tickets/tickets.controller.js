// src/routes/api/tickets/tickets.controller.js - TPG Ticket Management Controller
const Ticket = require('../../../models/Ticket');
const TicketComment = require('../../../models/TicketComment');
const User = require('../../../models/User');
const logger = require('../../../config/logger');
const { validateTicketCreate, validateTicketUpdate, validateTicketAssign, validateTicketStatusUpdate } = require('./tickets.validation');

class TicketsController {
  /**
   * Get all tickets with filtering and pagination
   * GET /api/tickets
   * Permissions: tickets.view.own (users) or tickets.view.all (admin+)
   */
  async getTickets(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        category,
        urgency,
        assigned_to,
        search,
        sortBy = 'created_at',
        sortOrder = 'desc',
        my_tickets = false
      } = req.query;

      let query = Ticket.query()
        .withGraphFetched('[user.[select(id, username, email)], assignedUser.[select(id, username, email)], comments(latest)]')
        .modifiers({
          latest: builder => builder.orderBy('created_at', 'desc').limit(1)
        });

      // Apply permission-based filtering
      if (req.user.role === 'user' || my_tickets === 'true') {
        // Regular users only see their own tickets
        query = query.where('user_id', req.user.id);
      } else if (req.user.role === 'admin') {
        // Admins can see all tickets or filter by assignment
        if (assigned_to === 'me') {
          query = query.where('assigned_to', req.user.id);
        }
      }
      // Super admins see everything by default

      // Apply search filter
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

      if (assigned_to && assigned_to !== 'me') {
        if (assigned_to === 'unassigned') {
          query = query.whereNull('assigned_to');
        } else {
          query = query.where('assigned_to', assigned_to);
        }
      }

      // Apply sorting
      const validSortFields = [
        'created_at', 'updated_at', 'title', 'status', 'urgency', 
        'category', 'resolved_at', 'ticket_number'
      ];
      
      if (validSortFields.includes(sortBy)) {
        query = query.orderBy(sortBy, sortOrder === 'asc' ? 'asc' : 'desc');
      }

      // Get total count for pagination
      const totalQuery = query.clone().count();
      
      // Apply pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      query = query.offset(offset).limit(parseInt(limit));

      const [tickets, [{ count: total }]] = await Promise.all([
        query,
        totalQuery
      ]);

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'list',
        'tickets',
        'filtered_list',
        req.ip
      );

      res.json({
        success: true,
        tickets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit)
        },
        filters: { status, category, urgency, assigned_to, search, my_tickets }
      });
    } catch (error) {
      logger.error('Get tickets error:', error);
      res.status(500).json({
        error: 'Failed to retrieve tickets',
        message: 'An error occurred while fetching tickets'
      });
    }
  }

  /**
   * Get single ticket by ID
   * GET /api/tickets/:id
   * Permissions: tickets.view.own or tickets.view.all
   */
  async getTicket(req, res) {
    try {
      const { id } = req.params;

      const ticket = await Ticket.query()
        .findById(id)
        .withGraphFetched(`[
          user.[select(id, username, email, pharmacy_name)], 
          assignedUser.[select(id, username, email)],
          comments.[user.[select(id, username, email)], attachments],
          attachments.[user.[select(id, username, email)]]
        ]`)
        .modifiers({
          orderComments: builder => builder.orderBy('created_at', 'asc')
        });

      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      // Check permissions
      const canView = req.user.hasPermission('tickets.view.all') || 
                     (req.user.hasPermission('tickets.view.own') && ticket.user_id === req.user.id);

      if (!canView) {
        logger.security.logPermissionDenied(
          req.user.id,
          'tickets.view',
          `ticket_${id}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only view your own tickets'
        });
      }

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'ticket',
        id,
        req.ip
      );

      res.json({
        success: true,
        ticket
      });
    } catch (error) {
      logger.error('Get ticket error:', error);
      res.status(500).json({
        error: 'Failed to retrieve ticket',
        message: 'An error occurred while fetching ticket details'
      });
    }
  }

  /**
   * Create new ticket
   * POST /api/tickets
   * Permissions: tickets.create
   */
  async createTicket(req, res) {
    try {
      // Validate input
      const { error, value } = validateTicketCreate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const { title, description, category, urgency = 'medium', metadata = {} } = value;

      // Generate ticket number
      const ticketNumber = await this.generateTicketNumber();

      // Create ticket
      const ticket = await Ticket.query().insert({
        ticket_number: ticketNumber,
        title,
        description,
        category,
        urgency,
        status: 'open',
        user_id: req.user.id,
        metadata: {
          ...metadata,
          user_agent: req.get('User-Agent'),
          ip_address: req.ip,
          created_via: 'web_portal'
        }
      });

      // Fetch the created ticket with relations
      const createdTicket = await Ticket.query()
        .findById(ticket.id)
        .withGraphFetched('[user.[select(id, username, email)]]');

      // Log ticket creation
      logger.security.logDataAccess(
        req.user.id,
        'create',
        'ticket',
        ticket.id,
        req.ip
      );

      // Auto-assign based on category if configured
      await this.autoAssignTicket(createdTicket);

      // TODO: Send notification emails
      // await emailService.sendTicketCreatedEmail(createdTicket);

      res.status(201).json({
        success: true,
        message: 'Ticket created successfully',
        ticket: createdTicket
      });
    } catch (error) {
      logger.error('Create ticket error:', error);
      res.status(500).json({
        error: 'Ticket creation failed',
        message: 'An error occurred while creating the ticket'
      });
    }
  }

  /**
   * Update ticket
   * PUT /api/tickets/:id
   * Permissions: tickets.edit.own or tickets.edit.all
   */
  async updateTicket(req, res) {
    try {
      const { id } = req.params;

      // Validate input
      const { error, value } = validateTicketUpdate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      // Check if ticket exists
      const ticket = await Ticket.query().findById(id);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      // Check permissions
      const canEdit = req.user.hasPermission('tickets.edit.all') || 
                     (req.user.hasPermission('tickets.edit.own') && ticket.user_id === req.user.id);

      if (!canEdit) {
        logger.security.logPermissionDenied(
          req.user.id,
          'tickets.edit',
          `ticket_${id}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only edit your own tickets'
        });
      }

      // Filter allowed fields based on permissions and ticket status
      const allowedFields = this.getAllowedUpdateFields(req.user, ticket);
      const updates = {};
      
      for (const field of allowedFields) {
        if (value[field] !== undefined) {
          updates[field] = value[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          error: 'No valid updates provided',
          message: 'Please provide valid fields to update'
        });
      }

      // Update ticket
      const updatedTicket = await ticket.$query().patchAndFetch(updates);

      // Create activity comment for significant changes
      await this.createActivityComment(ticket, updates, req.user);

      // Log the update
      logger.security.logDataAccess(
        req.user.id,
        'update',
        'ticket',
        id,
        req.ip
      );

      res.json({
        success: true,
        message: 'Ticket updated successfully',
        ticket: updatedTicket
      });
    } catch (error) {
      logger.error('Update ticket error:', error);
      res.status(500).json({
        error: 'Ticket update failed',
        message: 'An error occurred while updating the ticket'
      });
    }
  }

  /**
   * Assign ticket to user
   * PUT /api/tickets/:id/assign
   * Permissions: tickets.assign
   */
  async assignTicket(req, res) {
    try {
      const { id } = req.params;

      // Validate input
      const { error, value } = validateTicketAssign(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { assigned_to, reason = '' } = value;

      // Check if ticket exists
      const ticket = await Ticket.query().findById(id);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      // Validate assignee exists and has appropriate role
      if (assigned_to) {
        const assignee = await User.query().findById(assigned_to);
        if (!assignee) {
          return res.status(400).json({
            error: 'Invalid assignee',
            message: 'The specified user does not exist'
          });
        }

        if (!['admin', 'super_admin'].includes(assignee.role)) {
          return res.status(400).json({
            error: 'Invalid assignee',
            message: 'Tickets can only be assigned to admin users'
          });
        }

        if (assignee.status !== 'active') {
          return res.status(400).json({
            error: 'Invalid assignee',
            message: 'Cannot assign tickets to inactive users'
          });
        }
      }

      const oldAssignee = ticket.assigned_to;
      
      // Update ticket assignment
      const updatedTicket = await ticket.$query().patchAndFetch({
        assigned_to: assigned_to || null,
        status: assigned_to ? 'in-progress' : 'open'
      });

      // Create assignment activity comment
      const assignmentMessage = assigned_to 
        ? `Ticket assigned to ${(await User.query().findById(assigned_to)).username}` 
        : 'Ticket unassigned';
      
      await TicketComment.query().insert({
        ticket_id: id,
        user_id: req.user.id,
        content: `${assignmentMessage}${reason ? `. Reason: ${reason}` : ''}`,
        is_internal: true
      });

      // Log assignment
      logger.security.logAdminAction(
        req.user.id,
        'ticket_assigned',
        id,
        {
          old_assignee: oldAssignee,
          new_assignee: assigned_to,
          reason
        },
        req.ip
      );

      // TODO: Send assignment notification emails
      // if (assigned_to) {
      //   await emailService.sendTicketAssignedEmail(updatedTicket, assignee);
      // }

      res.json({
        success: true,
        message: assigned_to ? 'Ticket assigned successfully' : 'Ticket unassigned successfully',
        ticket: updatedTicket
      });
    } catch (error) {
      logger.error('Assign ticket error:', error);
      res.status(500).json({
        error: 'Ticket assignment failed',
        message: 'An error occurred while assigning the ticket'
      });
    }
  }

  /**
   * Update ticket status
   * PUT /api/tickets/:id/status
   * Permissions: tickets.edit.all or tickets.close (for resolution)
   */
  async updateTicketStatus(req, res) {
    try {
      const { id } = req.params;

      // Validate input
      const { error, value } = validateTicketStatusUpdate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { status, resolution_notes = '', satisfaction_rating, satisfaction_comment } = value;

      // Check if ticket exists
      const ticket = await Ticket.query().findById(id);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      // Validate status transition
      if (!this.isValidStatusTransition(ticket.status, status)) {
        return res.status(400).json({
          error: 'Invalid status transition',
          message: `Cannot change status from ${ticket.status} to ${status}`
        });
      }

      // Prepare update data
      const updates = { status };

      // Handle resolution
      if (status === 'resolved') {
        updates.resolved_at = new Date().toISOString();
        updates.resolution_notes = resolution_notes;
        
        // Calculate resolution time
        const createdAt = new Date(ticket.created_at);
        const resolvedAt = new Date();
        updates.actual_resolution_hours = Math.round((resolvedAt - createdAt) / (1000 * 60 * 60));
      }

      // Handle closing with satisfaction
      if (status === 'closed') {
        updates.closed_at = new Date().toISOString();
        if (satisfaction_rating) {
          updates.satisfaction_rating = satisfaction_rating;
          updates.satisfaction_comment = satisfaction_comment || '';
        }
      }

      // Update ticket
      const updatedTicket = await ticket.$query().patchAndFetch(updates);

      // Create status change activity comment
      let statusMessage = `Status changed from ${ticket.status} to ${status}`;
      if (resolution_notes) {
        statusMessage += `. Resolution: ${resolution_notes}`;
      }

      await TicketComment.query().insert({
        ticket_id: id,
        user_id: req.user.id,
        content: statusMessage,
        is_internal: true
      });

      // Log status change
      logger.security.logDataAccess(
        req.user.id,
        'status_update',
        'ticket',
        id,
        req.ip
      );

      // TODO: Send status change notification emails
      // await emailService.sendTicketStatusUpdateEmail(updatedTicket);

      res.json({
        success: true,
        message: `Ticket ${status} successfully`,
        ticket: updatedTicket
      });
    } catch (error) {
      logger.error('Update ticket status error:', error);
      res.status(500).json({
        error: 'Status update failed',
        message: 'An error occurred while updating ticket status'
      });
    }
  }

  /**
   * Delete ticket (soft delete)
   * DELETE /api/tickets/:id
   * Permissions: tickets.delete.own or tickets.delete.all
   */
  async deleteTicket(req, res) {
    try {
      const { id } = req.params;
      const { reason = 'User requested deletion' } = req.body;

      // Check if ticket exists
      const ticket = await Ticket.query().findById(id);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      // Check permissions
      const canDelete = req.user.hasPermission('tickets.delete.all') || 
                       (req.user.hasPermission('tickets.delete.own') && ticket.user_id === req.user.id);

      if (!canDelete) {
        logger.security.logPermissionDenied(
          req.user.id,
          'tickets.delete',
          `ticket_${id}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only delete your own tickets'
        });
      }

      // Prevent deletion of resolved/closed tickets unless admin
      if (['resolved', 'closed'].includes(ticket.status) && !req.user.hasPermission('tickets.delete.all')) {
        return res.status(400).json({
          error: 'Cannot delete ticket',
          message: 'Resolved and closed tickets cannot be deleted'
        });
      }

      // Soft delete by updating status and adding metadata
      await ticket.$query().patch({
        status: 'closed',
        closed_at: new Date().toISOString(),
        metadata: {
          ...ticket.metadata,
          deleted: true,
          deleted_by: req.user.id,
          deleted_at: new Date().toISOString(),
          deletion_reason: reason
        }
      });

      // Create deletion activity comment
      await TicketComment.query().insert({
        ticket_id: id,
        user_id: req.user.id,
        content: `Ticket deleted. Reason: ${reason}`,
        is_internal: true
      });

      // Log deletion
      logger.security.logAdminAction(
        req.user.id,
        'ticket_deleted',
        id,
        {
          ticket_number: ticket.ticket_number,
          reason
        },
        req.ip
      );

      res.json({
        success: true,
        message: 'Ticket deleted successfully'
      });
    } catch (error) {
      logger.error('Delete ticket error:', error);
      res.status(500).json({
        error: 'Ticket deletion failed',
        message: 'An error occurred while deleting the ticket'
      });
    }
  }

  /**
   * Get ticket statistics
   * GET /api/tickets/stats
   * Permissions: tickets.view.all or own stats
   */
  async getTicketStats(req, res) {
    try {
      const { user_id, period = '30d' } = req.query;

      // Determine date range
      const endDate = new Date();
      const startDate = new Date();
      
      switch (period) {
        case '7d':
          startDate.setDate(endDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(endDate.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(endDate.getDate() - 90);
          break;
        case '1y':
          startDate.setFullYear(endDate.getFullYear() - 1);
          break;
        default:
          startDate.setDate(endDate.getDate() - 30);
      }

      let query = Ticket.query().where('created_at', '>=', startDate.toISOString());

      // Filter by user if specified and permitted
      if (user_id) {
        if (user_id !== req.user.id && !req.user.hasPermission('tickets.view.all')) {
          return res.status(403).json({
            error: 'Access denied',
            message: 'You can only view your own statistics'
          });
        }
        query = query.where('user_id', user_id);
      } else if (req.user.role === 'user') {
        // Regular users only see their own stats
        query = query.where('user_id', req.user.id);
      }

      const tickets = await query;

      // Calculate statistics
      const stats = {
        total: tickets.length,
        by_status: {
          open: tickets.filter(t => t.status === 'open').length,
          'in-progress': tickets.filter(t => t.status === 'in-progress').length,
          resolved: tickets.filter(t => t.status === 'resolved').length,
          closed: tickets.filter(t => t.status === 'closed').length
        },
        by_urgency: {
          low: tickets.filter(t => t.urgency === 'low').length,
          medium: tickets.filter(t => t.urgency === 'medium').length,
          high: tickets.filter(t => t.urgency === 'high').length,
          critical: tickets.filter(t => t.urgency === 'critical').length
        },
        by_category: {},
        resolution_times: {
          average_hours: 0,
          median_hours: 0
        }
      };

      // Calculate category statistics
      const categories = ['cpd-points', 'license-management', 'performance-issues', 'payment-gateway', 'user-interface', 'data-inconsistencies', 'system-errors'];
      categories.forEach(category => {
        stats.by_category[category] = tickets.filter(t => t.category === category).length;
      });

      // Calculate resolution times for resolved tickets
      const resolvedTickets = tickets.filter(t => t.resolved_at);
      if (resolvedTickets.length > 0) {
        const resolutionTimes = resolvedTickets.map(t => t.actual_resolution_hours || 0);
        stats.resolution_times.average_hours = Math.round(
          resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
        );
        
        const sortedTimes = resolutionTimes.sort((a, b) => a - b);
        stats.resolution_times.median_hours = sortedTimes[Math.floor(sortedTimes.length / 2)];
      }

      res.json({
        success: true,
        period,
        date_range: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        },
        statistics: stats
      });
    } catch (error) {
      logger.error('Get ticket stats error:', error);
      res.status(500).json({
        error: 'Failed to retrieve statistics',
        message: 'An error occurred while fetching ticket statistics'
      });
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
    
    // Get count of tickets created today
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
   * Auto-assign ticket based on category rules
   */
  async autoAssignTicket(ticket) {
    // Auto-assignment logic could be implemented here
    // For now, we'll just log the opportunity
    logger.info(`Auto-assignment check for ticket ${ticket.ticket_number}, category: ${ticket.category}`);
  }

  /**
   * Get allowed update fields based on user permissions and ticket status
   */
  getAllowedUpdateFields(user, ticket) {
    const baseFields = ['title', 'description', 'urgency'];
    
    if (user.hasPermission('tickets.edit.all')) {
      return [...baseFields, 'category', 'status', 'assigned_to', 'resolution_notes'];
    }
    
    // Regular users can only edit basic fields and only if ticket is not resolved/closed
    if (['resolved', 'closed'].includes(ticket.status)) {
      return []; // No edits allowed for resolved/closed tickets
    }
    
    return baseFields;
  }

  /**
   * Create activity comment for ticket changes
   */
  async createActivityComment(ticket, updates, user) {
    const changes = [];
    
    if (updates.title && updates.title !== ticket.title) {
      changes.push(`Title changed to "${updates.title}"`);
    }
    
    if (updates.urgency && updates.urgency !== ticket.urgency) {
      changes.push(`Priority changed to ${updates.urgency}`);
    }
    
    if (updates.category && updates.category !== ticket.category) {
      changes.push(`Category changed to ${updates.category}`);
    }
    
    if (changes.length > 0) {
      await TicketComment.query().insert({
        ticket_id: ticket.id,
        user_id: user.id,
        content: `Ticket updated: ${changes.join(', ')}`,
        is_internal: true
      });
    }
  }

  /**
   * Validate status transitions
   */
  isValidStatusTransition(currentStatus, newStatus) {
    const validTransitions = {
      'open': ['in-progress', 'resolved', 'closed'],
      'in-progress': ['open', 'resolved', 'closed'],
      'resolved': ['closed', 'in-progress'], // Can reopen resolved tickets
      'closed': ['in-progress'] // Can reopen closed tickets (admin only)
    };
    
    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }
}

module.exports = new TicketsController();