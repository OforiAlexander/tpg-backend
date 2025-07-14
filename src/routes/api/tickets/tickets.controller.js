const Ticket = require('../../../models/Tickets');
const TicketComment = require('../../../models/TicketComment');
const User = require('../../../models/User');
const logger = require('../../../config/logger');
const redis = require('../../../config/redis');
const { transaction } = require('objection');
const { validateTicketCreate, validateTicketUpdate, validateTicketAssign, validateTicketStatusUpdate } = require('./tickets.validation');
const {
  calculateSLACompliance,
  calculateEscalationRate,
  calculateSatisfactionTrend
} = require('../../../utils/SLAUtils');
const bindMethods = require('../../../utils/bindMethods');
const TicketNotificationService = require('../../../services/ticketNotificationService');
const ticketNotificationService = require('../../../services/ticketNotificationService');

class TicketsController {
  constructor() {
    bindMethods(this, [
      'getTickets',
      'getTicket',
      'createTicket',
      'updateTicket',
      'assignTicket',
      'updateTicketStatus',
      'deleteTicket',
      'getTicketStats',
      'escalateTicket',
      'mergeTickets',
      'bulkTicketOperation',
      'searchTickets',
      'exportTickets',
      'getSummaryReport',
      'getResolutionTimeReport',
      'getSatisfactionReport',
      'subscribeToTicket',
      'unsubscribeFromTicket',
      'getTicketHistory',
      'getTicketTimeline',
      'quickCloseTicket',
      'quickResolveTicket',
      'reopenTicket',
      'resolveTicket',
      'getTicketTemplates',
      'createTicketTemplate',
      'getSystemHealth',
      'generateTicketNumber',
      'autoAssignTicket',
      'getAllowedUpdateFields',
      'createActivityComment',
      'isValidStatusTransition',
      'calculateSLACompliance',
      'calculateEscalationRate',
      'calculateSatisfactionTrend',
      'validateUUID'
    ]);
  }

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

      // Validate pagination parameters
      const validPage = Math.max(1, parseInt(page) || 1);
      const validLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));

      // Build base query for tickets (WITHOUT joins for counting)
      let baseQuery = Ticket.query();

      // Apply permission-based filtering
      if (req.user.role === 'user' || my_tickets === 'true') {
        baseQuery = baseQuery.where('user_id', req.user.id);
      } else if (req.user.role === 'admin') {
        if (assigned_to === 'me') {
          baseQuery = baseQuery.where('assigned_to', req.user.id);
        }
      }

      // Apply search filter
      if (search && search.trim().length > 0) {
        const searchTerm = search.trim();
        baseQuery = baseQuery.where(builder => {
          builder
            .where('title', 'ilike', `%${searchTerm}%`)
            .orWhere('description', 'ilike', `%${searchTerm}%`)
            .orWhere('ticket_number', 'ilike', `%${searchTerm}%`);
        });
      }

      // Apply status filter
      if (status) {
        const statuses = Array.isArray(status) ? status : [status];
        const validStatuses = statuses.filter(s => ['open', 'in-progress', 'resolved', 'closed'].includes(s));
        if (validStatuses.length > 0) {
          baseQuery = baseQuery.whereIn('status', validStatuses);
        }
      }

      // Apply category filter
      if (category) {
        const categories = Array.isArray(category) ? category : [category];
        const validCategories = categories.filter(c => [
          'cpd-points', 'license-management', 'performance-issues',
          'payment-gateway', 'user-interface', 'data-inconsistencies', 'system-errors'
        ].includes(c));
        if (validCategories.length > 0) {
          baseQuery = baseQuery.whereIn('category', validCategories);
        }
      }

      // Apply urgency filter
      if (urgency) {
        const urgencies = Array.isArray(urgency) ? urgency : [urgency];
        const validUrgencies = urgencies.filter(u => ['low', 'medium', 'high', 'critical'].includes(u));
        if (validUrgencies.length > 0) {
          baseQuery = baseQuery.whereIn('urgency', validUrgencies);
        }
      }

      // Apply assigned_to filter
      if (assigned_to && assigned_to !== 'me') {
        if (assigned_to === 'unassigned') {
          baseQuery = baseQuery.whereNull('assigned_to');
        } else {
          // Validate UUID format
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          if (uuidRegex.test(assigned_to)) {
            baseQuery = baseQuery.where('assigned_to', assigned_to);
          } else {
            return res.status(400).json({
              success: false,
              error: 'Invalid assigned_to parameter',
              message: 'assigned_to must be a valid UUID, "me", or "unassigned"'
            });
          }
        }
      }

      // **FIX: Get total count using the base query WITHOUT joins**
      const totalCountQuery = baseQuery.clone().count('id as count');

      // Build final query with joins for actual data
      let dataQuery = baseQuery.clone()
  .withGraphFetched('[user(selectUserFields), assignedUser(selectUserFields), comments(latest)]')
  .modifiers({
    selectUserFields: builder => builder.select('id', 'username', 'email'),
    latest: builder => builder.orderBy('created_at', 'desc').limit(1)
  });

      // Apply sorting
      const validSortFields = [
        'created_at', 'updated_at', 'title', 'status', 'urgency',
        'category', 'resolved_at', 'ticket_number'
      ];

      const validSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
      const validSortOrder = ['asc', 'desc'].includes(sortOrder?.toLowerCase()) ? sortOrder.toLowerCase() : 'desc';

      dataQuery = dataQuery.orderBy(validSortBy, validSortOrder);

      // Apply pagination to data query
      const offset = (validPage - 1) * validLimit;
      dataQuery = dataQuery.offset(offset).limit(validLimit);

      // **FIX: Execute queries separately to avoid GROUP BY issues**
      const [tickets, countResult] = await Promise.all([
        dataQuery,
        totalCountQuery
      ]);

      // Extract total count
      const total = parseInt(countResult[0]?.count || 0);

      // Log successful access
      logger.security.logDataAccess(
        req.user.id,
        'list',
        'tickets',
        'filtered_list',
        req.ip
      );

      // Return successful response
      res.json({
        success: true,
        tickets,
        pagination: {
          page: validPage,
          limit: validLimit,
          total,
          pages: Math.ceil(total / validLimit)
        },
        filters: {
          status, category, urgency, assigned_to, search: search?.trim(), my_tickets
        }
      });

    } catch (error) {
      // Enhanced error logging
      logger.error('Get tickets error:', {
        error: error.message,
        stack: error.stack,
        query: req.query,
        user_id: req.user?.id,
        method: req.method,
        url: req.originalUrl
      });

      // Return error response
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve tickets',
        message: 'An error occurred while fetching tickets',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
    user(selectUserWithPharmacy),
    assignedUser(selectUserFields),
    comments.[user(selectUserFields), attachments],
    attachments.[user(selectUserFields)]
  ]`)
  .modifiers({
    selectUserFields: builder => builder.select('id', 'username', 'email'),
    selectUserWithPharmacy: builder => builder.select('id', 'username', 'email', 'pharmacy_name'),
    orderComments: builder => builder.orderBy('created_at', 'asc')
  });

      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

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
      logger.error('Get ticket error:', { error: error.message, stack: error.stack });
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
      const { error, value } = validateTicketCreate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const { title, description, category, urgency = 'medium', metadata = {} } = value;

      const ticketNumber = await this.generateTicketNumber();

      const ticket = await Ticket.query().insert({
        ticket_number: ticketNumber,
        title,
        description,
        category,
        urgency,
        status: 'open',
        user_id: req.user.id,
        metadata: {
          ...(typeof metadata === 'object' ? metadata : {}),
          user_agent: req.get('User-Agent'),
          ip_address: req.ip,
          created_via: 'web_portal'
        }
      });

      const createdTicket = await Ticket.query()
  .findById(ticket.id)
  .withGraphFetched('[user(selectUserFields)]')
  .modifiers({
    selectUserFields: builder => builder.select('id', 'username', 'email')
  });

  
  logger.security.logDataAccess(
        req.user.id,
        'create',
        'ticket',
        ticket.id,
        req.ip
        );
        
        await this.autoAssignTicket(createdTicket);
        await ticketNotificationService.notifyTicketCreated(createdTicket);

      res.status(201).json({
        success: true,
        message: 'Ticket created successfully',
        ticket: createdTicket
      });
    } catch (error) {
      logger.error('Create ticket error:', { error: error.message, stack: error.stack });
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

      const { error, value } = validateTicketUpdate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const ticket = await Ticket.query().findById(id);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

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

      const updatedTicket = await ticket.$query().patchAndFetch(updates);

      await this.createActivityComment(ticket, updates, req.user);

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
      logger.error('Update ticket error:', { error: error.message, stack: error.stack });
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

      const { error, value } = validateTicketAssign(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { assigned_to, reason = '' } = value;

      const ticket = await Ticket.query().findById(id);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

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

      const updatedTicket = await ticket.$query().patchAndFetch({
        assigned_to: assigned_to || null,
        status: assigned_to ? 'in-progress' : 'open'
      });

      const assignmentMessage = assigned_to
        ? `Ticket assigned to ${(await User.query().findById(assigned_to)).username}`
        : 'Ticket unassigned';

      await TicketComment.query().insert({
        ticket_id: id,
        user_id: req.user.id,
        content: `${assignmentMessage}${reason ? `. Reason: ${reason}` : ''}`,
        is_internal: true
      });

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

      if (assigned_to) {
        const assignedToUser = await User.query().findById(assigned_to);
        const ticketWithUser = await Ticket.query()
          .findById(id)
          .withGraphFetched('user');
  
        await ticketNotificationService.notifyTicketAssigned(
          ticketWithUser,
          assignedToUser,
          req.user
        );
      }

      res.json({
        success: true,
        message: assigned_to ? 'Ticket assigned successfully' : 'Ticket unassigned successfully',
        ticket: updatedTicket
      });
    } catch (error) {
      logger.error('Assign ticket error:', { error: error.message, stack: error.stack });
      res.status(500).json({
        error: 'Ticket assignment failed',
        message: 'An error occurred while assigning the ticket'
      });
    }
  }

  /**
   * Update ticket status
   * PUT /api/tickets/:id/status
   * Permissions: tickets.edit.all or tickets.close
   */
  async updateTicketStatus(req, res) {
    try {
      const { id } = req.params;

      const { error, value } = validateTicketStatusUpdate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { status, resolution_notes = '', satisfaction_rating, satisfaction_comment } = value;

      const ticket = await Ticket.query().findById(id);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      if (!this.isValidStatusTransition(ticket.status, status)) {
        return res.status(400).json({
          error: 'Invalid status transition',
          message: `Cannot change status from ${ticket.status} to ${status}`
        });
      }

      const updates = { status };

      if (status === 'resolved') {
        updates.resolved_at = new Date().toISOString();
        updates.resolution_notes = resolution_notes;

        const createdAt = new Date(ticket.created_at);
        const resolvedAt = new Date();
        updates.actual_resolution_hours = Math.round((resolvedAt - createdAt) / (1000 * 60 * 60));
      }

      if (status === 'closed') {
        updates.closed_at = new Date().toISOString();
        if (satisfaction_rating) {
          updates.satisfaction_rating = satisfaction_rating;
          updates.satisfaction_comment = satisfaction_comment || '';
        }
      }

      const oldStatus = ticket.status;

      const updatedTicket = await ticket.$query().patchAndFetch(updates);

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

      logger.security.logDataAccess(
        req.user.id,
        'status_update',
        'ticket',
        id,
        req.ip
      );

      const ticketWithUser = await Ticket.query()
      .findById(id)
      .withGraphFetched('user');

    await ticketNotificationService.notifyTicketStatusChanged(
      ticketWithUser,
      oldStatus,
      req.user,
      resolution_notes || req.body.statusMessage || null
    );

      res.json({
        success: true,
        message: `Ticket ${status} successfully`,
        ticket: updatedTicket
      });
    } catch (error) {
      logger.error('Update ticket status error:', { error: error.message, stack: error.stack });
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

      const ticket = await Ticket.query().findById(id);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

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

      if (['resolved', 'closed'].includes(ticket.status) && !req.user.hasPermission('tickets.delete.all')) {
        return res.status(400).json({
          error: 'Cannot delete ticket',
          message: 'Resolved and closed tickets cannot be deleted'
        });
      }

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

      await TicketComment.query().insert({
        ticket_id: id,
        user_id: req.user.id,
        content: `Ticket deleted. Reason: ${reason}`,
        is_internal: true
      });

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
      logger.error('Delete ticket error:', { error: error.message, stack: error.stack });
      res.status(500).json({
        error: 'Ticket deletion failed',
        message: 'An error occurred while deleting the ticket'
      });
    }
  }

  async resolveTicket(req, res) {
    try {
      const { id } = req.params;
      const { resolution_notes = 'Ticket has been resolved' } = req.body;
  
      const ticket = await Ticket.query().findById(id);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }
  
      // Check if already resolved
      if (ticket.status === 'resolved') {
        return res.status(400).json({
          error: 'Already resolved',
          message: 'This ticket is already resolved'
        });
      }
  
      // Update to resolved status
      const updatedTicket = await ticket.$query().patchAndFetch({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolution_notes
      });
  
      // Create resolution comment
      await TicketComment.query().insert({
        ticket_id: id,
        user_id: req.user.id,
        content: `Ticket resolved. ${resolution_notes}`,
        is_internal: false
      });
  
      // Send notifications
      const ticketWithUser = await Ticket.query()
        .findById(id)
        .withGraphFetched('user');
  
      const resolution = {
        content: resolution_notes,
        resolvedAt: new Date()
      };
  
      await ticketNotificationService.notifyTicketResolved(
        ticketWithUser,
        resolution,
        req.user
      );
  
      res.json({
        success: true,
        message: 'Ticket resolved successfully',
        ticket: updatedTicket
      });
  
    } catch (error) {
      logger.error('Resolve ticket error:', error);
      res.status(500).json({
        error: 'Resolution failed',
        message: 'An error occurred while resolving the ticket'
      });
    }
  }

  /**
   * Get ticket statistics
   * GET /api/tickets/stats
   * Permissions: tickets.view.all or own stats
   */
  async getTicketStats(req, res) {
    const startTime = Date.now();

    try {
      const { user_id, period = 'month' } = req.query;

      // Validate and normalize period
      const periodMap = {
        'week': 7, '7d': 7, 'month': 30, '30d': 30,
        'quarter': 90, '90d': 90, 'year': 365, '1y': 365
      };
      const days = periodMap[period] || 30;

      // Calculate date boundaries
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

      // Validate user permissions and UUID
      if (user_id) {
        if (user_id !== req.user.id && !req.user.hasPermission('tickets.view.all')) {
          return res.status(403).json({
            success: false,
            error: 'Access denied',
            message: 'Insufficient permissions to view user statistics'
          });
        }

        if (!this.validateUUID(user_id)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid user_id format',
            message: 'user_id must be a valid UUID'
          });
        }

        // Verify user exists
        const userExists = await User.query().findById(user_id);
        if (!userExists) {
          return res.status(404).json({
            success: false,
            error: 'User not found',
            message: 'The specified user does not exist'
          });
        }
      }

      // Generate cache key
      const cacheKey = `ticket_stats:${period}:${user_id || 'all'}:${startDate.toISOString().split('T')[0]}`;

      // Try to get cached results
      const cachedResult = await redis.get(cacheKey);
      if (cachedResult && process.env.NODE_ENV === 'production') {
        logger.info(`Serving cached ticket stats for ${req.user.id}`);
        return res.json(JSON.parse(cachedResult));
      }

      // Execute statistics calculation in transaction for consistency
      const statistics = await transaction(Ticket.knex(), async (trx) => {
        // Build base queries with transaction
        let ticketQuery = Ticket.query(trx)
          .where('created_at', '>=', startDate.toISOString())
          .where('created_at', '<=', endDate.toISOString());

        let commentQuery = TicketComment.query(trx)
          .joinRelated('ticket')
          .where('ticket.created_at', '>=', startDate.toISOString())
          .where('ticket.created_at', '<=', endDate.toISOString());

        if (user_id) {
          ticketQuery = ticketQuery.where('user_id', user_id);
          commentQuery = commentQuery.where('ticket.user_id', user_id);
        }

        // Execute parallel database queries for performance
        const [
          tickets,
          statusCounts,
          urgencyCounts,
          categoryCounts,
          firstResponseData,
          satisfactionData
        ] = await Promise.all([
          // Get all ticket details
          ticketQuery.clone(),

          // Get status breakdown using aggregation
          ticketQuery.clone()
            .groupBy('status')
            .count('* as count')
            .select('status'),

          // Get urgency breakdown
          ticketQuery.clone()
            .groupBy('urgency')
            .count('* as count')
            .select('urgency'),

          // Get category breakdown
          ticketQuery.clone()
            .groupBy('category')
            .count('* as count')
            .select('category'),

          // Get first response times
          commentQuery.clone()
            .select('ticket.id as ticket_id', 'ticket.created_at as ticket_created')
            .min('ticket_comments.created_at as first_response')
            .where('ticket_comments.user_id', '!=',
              Ticket.query(trx)
                .select('user_id')
                .from('tickets')
                .where('id', trx.ref('ticket.id'))
            )
            .groupBy('ticket.id', 'ticket.created_at'),

        // Get satisfaction ratings
        ticketQuery.clone()
          .whereNotNull('satisfaction_rating')
          .select('satisfaction_rating')
        ]);

      // Process status breakdown
      const statusBreakdown = {
        open: 0, 'in-progress': 0, resolved: 0, closed: 0
      };
      statusCounts.forEach(({ status, count }) => {
        statusBreakdown[status] = parseInt(count);
      });

      // Process urgency breakdown
      const urgencyBreakdown = {
        low: 0, medium: 0, high: 0, critical: 0
      };
      urgencyCounts.forEach(({ urgency, count }) => {
        urgencyBreakdown[urgency] = parseInt(count);
      });

      // Process category breakdown dynamically
      const categoryBreakdown = {};
      const validCategories = [
        'cpd-points', 'license-management', 'performance-issues',
        'payment-gateway', 'user-interface', 'data-inconsistencies', 'system-errors'
      ];

      validCategories.forEach(category => {
        categoryBreakdown[category] = 0;
      });

      categoryCounts.forEach(({ category, count }) => {
        if (validCategories.includes(category)) {
          categoryBreakdown[category] = parseInt(count);
        }
      });

      // Calculate resolution metrics
      const resolvedTickets = tickets.filter(t =>
        ['resolved', 'closed'].includes(t.status) && t.resolved_at
      );

      const averageResolutionTime = resolvedTickets.length > 0
        ? resolvedTickets.reduce((total, ticket) => {
          const resolutionTime = new Date(ticket.resolved_at) - new Date(ticket.created_at);
          return total + (resolutionTime / (1000 * 60 * 60)); // Convert to hours
        }, 0) / resolvedTickets.length
        : 0;

      // Calculate average first response time
      const averageFirstResponseTime = firstResponseData.length > 0
        ? firstResponseData.reduce((total, response) => {
          if (response.first_response && response.ticket_created) {
            const responseTime = new Date(response.first_response) - new Date(response.ticket_created);
            return total + (responseTime / (1000 * 60 * 60)); // Convert to hours
          }
          return total;
        }, 0) / firstResponseData.filter(r => r.first_response).length
        : 0;

      // Calculate satisfaction rating
      const satisfactionRating = satisfactionData.length > 0
        ? satisfactionData.reduce((total, ticket) =>
          total + (ticket.satisfaction_rating || 0), 0
        ) / satisfactionData.length
        : 0;

      // Calculate resolution rate
      const totalTickets = tickets.length;
      const resolutionRate = totalTickets > 0
        ? ((statusBreakdown.resolved + statusBreakdown.closed) / totalTickets) * 100
        : 0;

      // Calculate trend data (comparison with previous period)
      const prevStartDate = new Date(startDate.getTime() - (days * 24 * 60 * 60 * 1000));
      const prevEndDate = new Date(startDate.getTime());

      let prevTicketQuery = Ticket.query(trx)
        .where('created_at', '>=', prevStartDate.toISOString())
        .where('created_at', '<', prevEndDate.toISOString());

      if (user_id) {
        prevTicketQuery = prevTicketQuery.where('user_id', user_id);
      }

      const prevTickets = await prevTicketQuery;
      const prevTotalTickets = prevTickets.length;

      const ticketVolumeChange = prevTotalTickets > 0
        ? ((totalTickets - prevTotalTickets) / prevTotalTickets) * 100
        : 0;

        return {
          total: totalTickets,
          by_status: statusBreakdown,
          by_urgency: urgencyBreakdown,
          by_category: categoryBreakdown,
          average_resolution_time: Number(averageResolutionTime.toFixed(2)),
          average_first_response_time: Number(averageFirstResponseTime.toFixed(2)),
          satisfaction_rating: Number(satisfactionRating.toFixed(1)),
          resolution_rate: Number(resolutionRate.toFixed(1)),
          trends: {
            ticket_volume_change: Number(ticketVolumeChange.toFixed(1)),
            previous_period_total: prevTotalTickets
          },
          performance_indicators: {
            sla_compliance: calculateSLACompliance(averageFirstResponseTime, averageResolutionTime),
            escalation_rate: calculateEscalationRate(tickets),
            customer_satisfaction_trend: calculateSatisfactionTrend(satisfactionData, prevTickets)
          }
        };
    });

    // Prepare response
    const response = {
      success: true,
      period,
      date_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      user_id: user_id || null,
      statistics,
      generated_at: new Date().toISOString(),
      cache_ttl: 300,
      execution_time_ms: Date.now() - startTime
    };

    // Cache the result for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(response));

    // Log successful access
    logger.security.logDataAccess(
      req.user.id,
      'view',
      'ticket_statistics',
      user_id || 'all_tickets',
      req.ip,
      { execution_time: Date.now() - startTime }
    );

    res.json(response);

  } catch(error) {
    // Enhanced error logging with context
    logger.error('Ticket statistics error:', {
      error: error.message,
      stack: error.stack,
      query: req.query,
      user_id: req.user?.id,
      execution_time: Date.now() - startTime,
      memory_usage: process.memoryUsage()
    });

    // Clear potentially corrupted cache
    if (req.query.user_id || req.query.period) {
      const cacheKey = `ticket_stats:${req.query.period || 'month'}:${req.query.user_id || 'all'}:*`;
      redis.del(cacheKey).catch(() => { }); // Silent fail on cache clear
    }

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve ticket statistics',
      message: 'An internal error occurred while processing statistics',
      error_id: require('crypto').randomBytes(8).toString('hex'),
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
}

  /**
   * Escalate ticket
   * PUT /api/tickets/:id/escalate
   * Permissions: tickets.escalate
   */
  async escalateTicket(req, res) {
  try {
    const { id } = req.params;
    const { reason = '' } = req.body;

    const ticket = await Ticket.query().findById(id);
    if (!ticket) {
      return res.status(404).json({
        error: 'Ticket not found',
        message: 'The requested ticket does not exist'
      });
    }

    if (!req.user.hasPermission('tickets.escalate')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'tickets.escalate',
        `ticket_${id}`,
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to escalate tickets'
      });
    }

    const updatedTicket = await ticket.$query().patchAndFetch({
      urgency: 'critical',
      metadata: {
        ...ticket.metadata,
        escalated: true,
        escalated_at: new Date().toISOString(),
        escalation_reason: reason
      }
    });

    await TicketComment.query().insert({
      ticket_id: id,
      user_id: req.user.id,
      content: `Ticket escalated. Reason: ${reason}`,
      is_internal: true
    });

    logger.security.logAdminAction(
      req.user.id,
      'ticket_escalated',
      id,
      { reason },
      req.ip
    );

    res.json({
      success: true,
      message: 'Ticket escalated successfully',
      ticket: updatedTicket
    });
  } catch (error) {
    logger.error('Escalate ticket error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Ticket escalation failed',
      message: 'An error occurred while escalating the ticket'
    });
  }
}

  /**
   * Merge tickets
   * PUT /api/tickets/:id/merge
   * Permissions: tickets.merge
   */
  async mergeTickets(req, res) {
  try {
    const { id } = req.params;
    const { ticket_ids, reason = '' } = req.body;

    if (!req.user.hasPermission('tickets.merge')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'tickets.merge',
        `ticket_${id}`,
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to merge tickets'
      });
    }

    if (!Array.isArray(ticket_ids) || ticket_ids.length === 0) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'At least one ticket ID must be provided for merging'
      });
    }

    const primaryTicket = await Ticket.query().findById(id);
    if (!primaryTicket) {
      return res.status(404).json({
        error: 'Primary ticket not found',
        message: 'The primary ticket does not exist'
      });
    }

    const ticketsToMerge = await Ticket.query().findByIds(ticket_ids);
    if (ticketsToMerge.length !== ticket_ids.length) {
      return res.status(404).json({
        error: 'Invalid ticket IDs',
        message: 'One or more tickets to merge do not exist'
      });
    }

    const mergedComments = [];
    for (const ticket of ticketsToMerge) {
      const comments = await TicketComment.query().where('ticket_id', ticket.id);
      for (const comment of comments) {
        await TicketComment.query().insert({
          ticket_id: id,
          user_id: comment.user_id,
          content: `Merged from ticket ${ticket.ticket_number}: ${comment.content}`,
          is_internal: comment.is_internal,
          created_at: comment.created_at
        });
        mergedComments.push(comment);
      }

      await ticket.$query().patch({
        status: 'closed',
        closed_at: new Date().toISOString(),
        metadata: {
          ...ticket.metadata,
          merged_into: id,
          merged_at: new Date().toISOString(),
          merge_reason: reason
        }
      });
    }

    await TicketComment.query().insert({
      ticket_id: id,
      user_id: req.user.id,
      content: `Merged tickets ${ticket_ids.map(id => `TPG-${id}`).join(', ')}. Reason: ${reason}`,
      is_internal: true
    });

    logger.security.logAdminAction(
      req.user.id,
      'tickets_merged',
      id,
      { merged_ticket_ids: ticket_ids, reason },
      req.ip
    );

    const updatedPrimaryTicket = await Ticket.query()
  .findById(id)
  .withGraphFetched('[user(selectUserFields)]')
  .modifiers({
    selectUserFields: builder => builder.select('id', 'username', 'email')
  });

    res.json({
      success: true,
      message: 'Tickets merged successfully',
      ticket: updatedPrimaryTicket
    });
  } catch (error) {
    logger.error('Merge tickets error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Ticket merge failed',
      message: 'An error occurred while merging tickets'
    });
  }
}

  /**
   * Bulk ticket operations
   * POST /api/tickets/bulk
   * Permissions: tickets.edit.all
   */
  async bulkTicketOperation(req, res) {
  try {
    const { ticket_ids, action, updates = {} } = req.body;

    if (!req.user.hasPermission('tickets.edit.all')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'tickets.edit.all',
        'bulk_operation',
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to perform bulk operations'
      });
    }

    if (!Array.isArray(ticket_ids) || ticket_ids.length === 0) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'At least one ticket ID must be provided'
      });
    }

    const tickets = await Ticket.query().findByIds(ticket_ids);
    if (tickets.length !== ticket_ids.length) {
      return res.status(404).json({
        error: 'Invalid ticket IDs',
        message: 'One or more tickets do not exist'
      });
    }

    let updatedTickets = [];
    switch (action) {
      case 'update_status':
        if (!this.isValidStatusTransition(null, updates.status)) {
          return res.status(400).json({
            error: 'Invalid status',
            message: `Invalid status: ${updates.status}`
          });
        }
        updatedTickets = await Ticket.query()
          .whereIn('id', ticket_ids)
          .patchAndFetch(updates.status ? { status: updates.status } : {});
        break;
      case 'assign':
        if (updates.assigned_to) {
          const assignee = await User.query().findById(updates.assigned_to);
          if (!assignee || !['admin', 'super_admin'].includes(assignee.role)) {
            return res.status(400).json({
              error: 'Invalid assignee',
              message: 'Assignee must be an active admin user'
            });
          }
        }
        updatedTickets = await Ticket.query()
          .whereIn('id', ticket_ids)
          .patchAndFetch({ assigned_to: updates.assigned_to || null });
        break;
      case 'delete':
        updatedTickets = await Ticket.query()
          .whereIn('id', ticket_ids)
          .patchAndFetch({
            status: 'closed',
            closed_at: new Date().toISOString(),
            metadata: {
              deleted: true,
              deleted_by: req.user.id,
              deleted_at: new Date().toISOString(),
              deletion_reason: updates.reason || 'Bulk deletion'
            }
          });
        break;
      default:
        return res.status(400).json({
          error: 'Invalid action',
          message: 'Supported actions: update_status, assign, delete'
        });
    }

    for (const ticket of updatedTickets) {
      await TicketComment.query().insert({
        ticket_id: ticket.id,
        user_id: req.user.id,
        content: `Bulk operation: ${action}${updates.reason ? `. Reason: ${updates.reason}` : ''}`,
        is_internal: true
      });
    }

    logger.security.logAdminAction(
      req.user.id,
      'bulk_operation',
      ticket_ids.join(','),
      { action, updates },
      req.ip
    );

    res.json({
      success: true,
      message: `Bulk operation (${action}) completed successfully`,
      tickets: updatedTickets
    });
  } catch (error) {
    logger.error('Bulk ticket operation error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Bulk operation failed',
      message: 'An error occurred while performing bulk operation'
    });
  }
}

  /**
   * Advanced search for tickets
   * GET /api/tickets/search
   * Permissions: tickets.view.all or tickets.view.own
   */
  async searchTickets(req, res) {
  try {
    const { query: searchQuery, page = 1, limit = 20, sortBy = 'created_at', sortOrder = 'desc' } = req.query;

    if (!searchQuery) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Search query is required'
      });
    }

    let query = Ticket.query()
  .withGraphFetched('[user(selectUserFields), assignedUser(selectUserFields)]')
  .modifiers({
    selectUserFields: builder => builder.select('id', 'username', 'email')
  });

    if (req.user.role === 'user') {
      query = query.where('user_id', req.user.id);
    }

    query = query.where(builder => {
      builder
        .where('title', 'ilike', `%${searchQuery}%`)
        .orWhere('description', 'ilike', `%${searchQuery}%`)
        .orWhere('ticket_number', 'ilike', `%${searchQuery}%`);
    });

    const validSortFields = ['created_at', 'updated_at', 'title', 'status', 'urgency', 'category', 'ticket_number'];
    if (validSortFields.includes(sortBy)) {
      query = query.orderBy(sortBy, sortOrder === 'asc' ? 'asc' : 'desc');
    }

    const totalQuery = query.clone().count();
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.offset(offset).limit(parseInt(limit));

    const [tickets, [{ count: total }]] = await Promise.all([
      query,
      totalQuery
    ]);

    logger.security.logDataAccess(
      req.user.id,
      'search',
      'tickets',
      searchQuery,
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
      }
    });
  } catch (error) {
    logger.error('Search tickets error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Search failed',
      message: 'An error occurred while searching tickets'
    });
  }
}

  /**
   * Export tickets
   * POST /api/tickets/export
   * Permissions: tickets.export
   */
  async exportTickets(req, res) {
  try {
    const { ticket_ids, format = 'json' } = req.body;

    if (!req.user.hasPermission('tickets.export')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'tickets.export',
        'export_tickets',
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to export tickets'
      });
    }

    let query = Ticket.query()
  .withGraphFetched('[user(selectUserFields), assignedUser(selectUserFields)]')
  .modifiers({
    selectUserFields: builder => builder.select('id', 'username', 'email')
  });

    if (req.user.role === 'user') {
      query = query.where('user_id', req.user.id);
    }

    if (Array.isArray(ticket_ids) && ticket_ids.length > 0) {
      query = query.whereIn('id', ticket_ids);
    }

    const tickets = await query;

    let exportData;
    if (format === 'csv') {
      const csvRows = [
        'ticket_number,title,description,category,urgency,status,created_at,resolved_at,user_id,assigned_to'
      ];
      tickets.forEach(ticket => {
        csvRows.push([
          ticket.ticket_number,
          `"${ticket.title.replace(/"/g, '""')}"`,
          `"${ticket.description.replace(/"/g, '""')}"`,
          ticket.category,
          ticket.urgency,
          ticket.status,
          ticket.created_at,
          ticket.resolved_at || '',
          ticket.user_id,
          ticket.assigned_to || ''
        ].join(','));
      });
      exportData = csvRows.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=tickets_export.csv');
    } else {
      exportData = tickets;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=tickets_export.json');
    }

    logger.security.logAdminAction(
      req.user.id,
      'export_tickets',
      ticket_ids ? ticket_ids.join(',') : 'all',
      { format },
      req.ip
    );

    res.send(exportData);
  } catch (error) {
    logger.error('Export tickets error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Export failed',
      message: 'An error occurred while exporting tickets'
    });
  }
}

  /**
   * Get summary report
   * GET /api/tickets/reports/summary
   * Permissions: analytics.view
   */
  async getSummaryReport(req, res) {
  try {
    if (!req.user.hasPermission('analytics.view')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'analytics.view',
        'summary_report',
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to view reports'
      });
    }

    const { period = '30d' } = req.query;
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

    const tickets = await Ticket.query()
      .where('created_at', '>=', startDate.toISOString());

    const report = {
      total_tickets: tickets.length,
      open_tickets: tickets.filter(t => t.status === 'open').length,
      in_progress_tickets: tickets.filter(t => t.status === 'in-progress').length,
      resolved_tickets: tickets.filter(t => t.status === 'resolved').length,
      closed_tickets: tickets.filter(t => t.status === 'closed').length,
      average_resolution_time: 0
    };

    const resolvedTickets = tickets.filter(t => t.resolved_at);
    if (resolvedTickets.length > 0) {
      const resolutionTimes = resolvedTickets.map(t => t.actual_resolution_hours || 0);
      report.average_resolution_time = Math.round(
        resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
      );
    }

    logger.security.logDataAccess(
      req.user.id,
      'view_summary_report',
      'tickets',
      period,
      req.ip
    );

    res.json({
      success: true,
      report,
      period,
      date_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    });
  } catch (error) {
    logger.error('Get summary report error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to retrieve summary report',
      message: 'An error occurred while fetching the summary report'
    });
  }
}

  /**
   * Get resolution time report
   * GET /api/tickets/reports/resolution-time
   * Permissions: analytics.view
   */
  async getResolutionTimeReport(req, res) {
  try {
    if (!req.user.hasPermission('analytics.view')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'analytics.view',
        'resolution_time_report',
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to view reports'
      });
    }

    const { period = '30d' } = req.query;
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

    const tickets = await Ticket.query()
      .where('resolved_at', '>=', startDate.toISOString())
      .whereNotNull('resolved_at');

    const report = {
      total_resolved: tickets.length,
      by_category: {},
      average_resolution_time: 0,
      median_resolution_time: 0
    };

    const categories = ['cpd-points', 'license-management', 'performance-issues', 'payment-gateway', 'user-interface', 'data-inconsistencies', 'system-errors'];
    categories.forEach(category => {
      const categoryTickets = tickets.filter(t => t.category === category);
      report.by_category[category] = {
        count: categoryTickets.length,
        average_resolution_time: categoryTickets.length > 0
          ? Math.round(categoryTickets.reduce((a, t) => a + (t.actual_resolution_hours || 0), 0) / categoryTickets.length)
          : 0
      };
    });

    if (tickets.length > 0) {
      const resolutionTimes = tickets.map(t => t.actual_resolution_hours || 0);
      report.average_resolution_time = Math.round(
        resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
      );
      const sortedTimes = resolutionTimes.sort((a, b) => a - b);
      report.median_resolution_time = sortedTimes[Math.floor(sortedTimes.length / 2)];
    }

    logger.security.logDataAccess(
      req.user.id,
      'view_resolution_time_report',
      'tickets',
      period,
      req.ip
    );

    res.json({
      success: true,
      report,
      period,
      date_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    });
  } catch (error) {
    logger.error('Get resolution time report error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to retrieve resolution time report',
      message: 'An error occurred while fetching the resolution time report'
    });
  }
}

  /**
   * Get satisfaction report
   * GET /api/tickets/reports/satisfaction
   * Permissions: analytics.view
   */
  async getSatisfactionReport(req, res) {
  try {
    if (!req.user.hasPermission('analytics.view')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'analytics.view',
        'satisfaction_report',
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to view reports'
      });
    }

    const { period = '30d' } = req.query;
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

    const tickets = await Ticket.query()
      .where('closed_at', '>=', startDate.toISOString())
      .whereNotNull('satisfaction_rating');

    const report = {
      total_rated: tickets.length,
      average_satisfaction: 0,
      by_rating: {
        1: 0, 2: 0, 3: 0, 4: 0, 5: 0
      }
    };

    if (tickets.length > 0) {
      report.average_satisfaction = Math.round(
        tickets.reduce((a, t) => a + (t.satisfaction_rating || 0), 0) / tickets.length
      );
      report.by_rating = tickets.reduce((acc, t) => {
        acc[t.satisfaction_rating] = (acc[t.satisfaction_rating] || 0) + 1;
        return acc;
      }, report.by_rating);
    }

    logger.security.logDataAccess(
      req.user.id,
      'view_satisfaction_report',
      'tickets',
      period,
      req.ip
    );

    res.json({
      success: true,
      report,
      period,
      date_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    });
  } catch (error) {
    logger.error('Get satisfaction report error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to retrieve satisfaction report',
      message: 'An error occurred while fetching the satisfaction report'
    });
  }
}

  /**
   * Subscribe to ticket updates
   * POST /api/tickets/:id/subscribe
   * Permissions: tickets.view
   */
  async subscribeToTicket(req, res) {
  try {
    const { id } = req.params;

    const ticket = await Ticket.query().findById(id);
    if (!ticket) {
      return res.status(404).json({
        error: 'Ticket not found',
        message: 'The requested ticket does not exist'
      });
    }

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
        message: 'You can only subscribe to tickets you have access to'
      });
    }

    const subscriptions = ticket.metadata?.subscriptions || [];
    if (!subscriptions.includes(req.user.id)) {
      subscriptions.push(req.user.id);
      await ticket.$query().patch({
        metadata: { ...ticket.metadata, subscriptions }
      });
    }

    await TicketComment.query().insert({
      ticket_id: id,
      user_id: req.user.id,
      content: `User ${req.user.username} subscribed to ticket updates`,
      is_internal: true
    });

    logger.security.logDataAccess(
      req.user.id,
      'subscribe',
      'ticket',
      id,
      req.ip
    );

    res.json({
      success: true,
      message: 'Subscribed to ticket updates successfully'
    });
  } catch (error) {
    logger.error('Subscribe to ticket error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Subscription failed',
      message: 'An error occurred while subscribing to the ticket'
    });
  }
}

  /**
   * Unsubscribe from ticket updates
   * DELETE /api/tickets/:id/subscribe
   * Permissions: tickets.view
   */
  async unsubscribeFromTicket(req, res) {
  try {
    const { id } = req.params;

    const ticket = await Ticket.query().findById(id);
    if (!ticket) {
      return res.status(404).json({
        error: 'Ticket not found',
        message: 'The requested ticket does not exist'
      });
    }

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
        message: 'You can only unsubscribe from tickets you have access to'
      });
    }

    const subscriptions = ticket.metadata?.subscriptions || [];
    const updatedSubscriptions = subscriptions.filter(sub => sub !== req.user.id);
    await ticket.$query().patch({
      metadata: { ...ticket.metadata, subscriptions: updatedSubscriptions }
    });

    await TicketComment.query().insert({
      ticket_id: id,
      user_id: req.user.id,
      content: `User ${req.user.username} unsubscribed from ticket updates`,
      is_internal: true
    });

    logger.security.logDataAccess(
      req.user.id,
      'unsubscribe',
      'ticket',
      id,
      req.ip
    );

    res.json({
      success: true,
      message: 'Unsubscribed from ticket updates successfully'
    });
  } catch (error) {
    logger.error('Unsubscribe from ticket error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Unsubscription failed',
      message: 'An error occurred while unsubscribing from the ticket'
    });
  }
}

  /**
   * Get ticket history/audit trail
   * GET /api/tickets/:id/history
   * Permissions: tickets.view
   */
  async getTicketHistory(req, res) {
  try {
    const { id } = req.params;

    const ticket = await Ticket.query().findById(id);
    if (!ticket) {
      return res.status(404).json({
        error: 'Ticket not found',
        message: 'The requested ticket does not exist'
      });
    }

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
        message: 'You can only view history for tickets you have access to'
      });
    }

    const comments = await TicketComment.query()
  .where('ticket_id', id)
  .withGraphFetched('user(selectUserFields)')
  .modifiers({
    selectUserFields: builder => builder.select('id', 'username', 'email')
  })
  .orderBy('created_at', 'asc');

    logger.security.logDataAccess(
      req.user.id,
      'view_history',
      'ticket',
      id,
      req.ip
    );

    res.json({
      success: true,
      history: comments
    });
  } catch (error) {
    logger.error('Get ticket history error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to retrieve ticket history',
      message: 'An error occurred while fetching ticket history'
    });
  }
}

  /**
   * Get ticket timeline
   * GET /api/tickets/:id/timeline
   * Permissions: tickets.view
   */
  async getTicketTimeline(req, res) {
  try {
    const { id } = req.params;

    const ticket = await Ticket.query().findById(id);
    if (!ticket) {
      return res.status(404).json({
        error: 'Ticket not found',
        message: 'The requested ticket does not exist'
      });
    }

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
        message: 'You can only view timeline for tickets you have access to'
      });
    }

    const timeline = await TicketComment.query()
    .where('ticket_id', id)
    .where('is_internal', true)
    .withGraphFetched('user(selectUserFields)')
    .modifiers({
      selectUserFields: builder => builder.select('id', 'username', 'email')
    })
    .orderBy('created_at', 'asc');

    logger.security.logDataAccess(
      req.user.id,
      'view_timeline',
      'ticket',
      id,
      req.ip
    );

    res.json({
      success: true,
      timeline
    });
  } catch (error) {
    logger.error('Get ticket timeline error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to retrieve ticket timeline',
      message: 'An error occurred while fetching ticket timeline'
    });
  }
}

  /**
   * Quick close ticket
   * PUT /api/tickets/:id/quick-close
   * Permissions: tickets.close
   */
  async quickCloseTicket(req, res) {
  try {
    const { id } = req.params;
    const { reason = 'Quick close by admin' } = req.body;

    if (!req.user.hasPermission('tickets.close')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'tickets.close',
        `ticket_${id}`,
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to close tickets'
      });
    }

    const ticket = await Ticket.query().findById(id);
    if (!ticket) {
      return res.status(404).json({
        error: 'Ticket not found',
        message: 'The requested ticket does not exist'
      });
    }

    if (!this.isValidStatusTransition(ticket.status, 'closed')) {
      return res.status(400).json({
        error: 'Invalid status transition',
        message: `Cannot quick-close ticket from status ${ticket.status}`
      });
    }

    const updatedTicket = await ticket.$query().patchAndFetch({
      status: 'closed',
      closed_at: new Date().toISOString()
    });

    await TicketComment.query().insert({
      ticket_id: id,
      user_id: req.user.id,
      content: `Ticket quick-closed. Reason: ${reason}`,
      is_internal: true
    });

    logger.security.logAdminAction(
      req.user.id,
      'quick_close',
      id,
      { reason },
      req.ip
    );

    res.json({
      success: true,
      message: 'Ticket quick-closed successfully',
      ticket: updatedTicket
    });
  } catch (error) {
    logger.error('Quick close ticket error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Quick close failed',
      message: 'An error occurred while quick-closing the ticket'
    });
  }
}

  /**
   * Quick resolve ticket
   * PUT /api/tickets/:id/quick-resolve
   * Permissions: tickets.resolve
   */
  async quickResolveTicket(req, res) {
  try {
    const { id } = req.params;
    const { resolution_notes = 'Quick resolved by admin' } = req.body;

    if (!req.user.hasPermission('tickets.resolve')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'tickets.resolve',
        `ticket_${id}`,
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to resolve tickets'
      });
    }

    const ticket = await Ticket.query().findById(id);
    if (!ticket) {
      return res.status(404).json({
        error: 'Ticket not found',
        message: 'The requested ticket does not exist'
      });
    }

    if (!this.isValidStatusTransition(ticket.status, 'resolved')) {
      return res.status(400).json({
        error: 'Invalid status transition',
        message: `Cannot quick-resolve ticket from status ${ticket.status}`
      });
    }

    const createdAt = new Date(ticket.created_at);
    const resolvedAt = new Date();
    const updatedTicket = await ticket.$query().patchAndFetch({
      status: 'resolved',
      resolved_at: resolvedAt.toISOString(),
      resolution_notes,
      actual_resolution_hours: Math.round((resolvedAt - createdAt) / (1000 * 60 * 60))
    });

    await TicketComment.query().insert({
      ticket_id: id,
      user_id: req.user.id,
      content: `Ticket quick-resolved. Resolution: ${resolution_notes}`,
      is_internal: true
    });

    logger.security.logAdminAction(
      req.user.id,
      'quick_resolve',
      id,
      { resolution_notes },
      req.ip
    );

    res.json({
      success: true,
      message: 'Ticket quick-resolved successfully',
      ticket: updatedTicket
    });
  } catch (error) {
    logger.error('Quick resolve ticket error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Quick resolve failed',
      message: 'An error occurred while quick-resolving the ticket'
    });
  }
}

  /**
   * Reopen closed ticket
   * PUT /api/tickets/:id/reopen
   * Permissions: tickets.reopen
   */
  async reopenTicket(req, res) {
  try {
    const { id } = req.params;
    const { reason = 'Reopened by admin' } = req.body;

    if (!req.user.hasPermission('tickets.reopen')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'tickets.reopen',
        `ticket_${id}`,
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to reopen tickets'
      });
    }

    const ticket = await Ticket.query().findById(id);
    if (!ticket) {
      return res.status(404).json({
        error: 'Ticket not found',
        message: 'The requested ticket does not exist'
      });
    }

    if (!this.isValidStatusTransition(ticket.status, 'in-progress')) {
      return res.status(400).json({
        error: 'Invalid status transition',
        message: `Cannot reopen ticket from status ${ticket.status}`
      });
    }

    const updatedTicket = await ticket.$query().patchAndFetch({
      status: 'in-progress',
      closed_at: null,
      resolved_at: null,
      satisfaction_rating: null,
      satisfaction_comment: null
    });

    await TicketComment.query().insert({
      ticket_id: id,
      user_id: req.user.id,
      content: `Ticket reopened. Reason: ${reason}`,
      is_internal: true
    });

    logger.security.logAdminAction(
      req.user.id,
      'reopen',
      id,
      { reason },
      req.ip
    );

    res.json({
      success: true,
      message: 'Ticket reopened successfully',
      ticket: updatedTicket
    });
  } catch (error) {
    logger.error('Reopen ticket error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Reopen failed',
      message: 'An error occurred while reopening the ticket'
    });
  }
}

  /**
   * Get ticket templates
   * GET /api/tickets/templates
   * Permissions: tickets.templates
   */
  async getTicketTemplates(req, res) {
  try {
    if (!req.user.hasPermission('tickets.templates')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'tickets.templates',
        'view_templates',
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to view ticket templates'
      });
    }

    const templates = await Ticket.query()
  .where('is_template', true)
  .withGraphFetched('[user(selectUserFields)]')
  .modifiers({
    selectUserFields: builder => builder.select('id', 'username', 'email')
  });

    logger.security.logDataAccess(
      req.user.id,
      'view_templates',
      'tickets',
      'all_templates',
      req.ip
    );

    res.json({
      success: true,
      templates
    });
  } catch (error) {
    logger.error('Get ticket templates error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to retrieve ticket templates',
      message: 'An error occurred while fetching ticket templates'
    });
  }
}

  /**
   * Create ticket template
   * POST /api/tickets/templates
   * Permissions: tickets.templates.create
   */
  async createTicketTemplate(req, res) {
  try {
    if (!req.user.hasPermission('tickets.templates.create')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'tickets.templates.create',
        'create_template',
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to create ticket templates'
      });
    }

    const { error, value } = validateTicketCreate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        message: error.details[0].message,
        details: error.details
      });
    }

    const { title, description, category, urgency = 'medium' } = value;

    const template = await Ticket.query().insert({
      ticket_number: `TPL-${await this.generateTicketNumber()}`,
      title,
      description,
      category,
      urgency,
      is_template: true,
      user_id: req.user.id,
      status: 'open',
      metadata: {}
    });

    logger.security.logAdminAction(
      req.user.id,
      'create_template',
      template.id,
      { title, category },
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Ticket template created successfully',
      template
    });
  } catch (error) {
    logger.error('Create ticket template error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Template creation failed',
      message: 'An error occurred while creating the ticket template'
    });
  }
}

  /**
   * Check ticket system health
   * GET /api/tickets/health
   * Permissions: system.health
   */
  async getSystemHealth(req, res) {
  try {
    if (!req.user.hasPermission('system.health')) {
      logger.security.logPermissionDenied(
        req.user.id,
        'system.health',
        'system_health',
        req.ip,
        req.get('User-Agent')
      );
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to check system health'
      });
    }

    const ticketCount = await Ticket.query().count();
    const recentTickets = await Ticket.query()
      .where('created_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .count();

    const health = {
      status: 'operational',
      ticket_count: parseInt(ticketCount[0].count),
      tickets_last_24h: parseInt(recentTickets[0].count),
      last_checked: new Date().toISOString()
    };

    logger.security.logDataAccess(
      req.user.id,
      'view_system_health',
      'tickets',
      'system',
      req.ip
    );

    res.json({
      success: true,
      health
    });
  } catch (error) {
    logger.error('Get system health error:', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to check system health',
      message: 'An error occurred while checking ticket system health'
    });
  }
}

  // Helper methods

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

  async autoAssignTicket(ticket) {
  logger.info(`Auto-assignment check for ticket ${ticket.ticket_number}, category: ${ticket.category}`);
}

getAllowedUpdateFields(user, ticket) {
  const baseFields = ['title', 'description', 'urgency'];

  if (user.hasPermission('tickets.edit.all')) {
    return [...baseFields, 'category', 'status', 'assigned_to', 'resolution_notes'];
  }

  if (['resolved', 'closed'].includes(ticket.status)) {
    return [];
  }

  return baseFields;
}

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
 * Calculate SLA compliance based on response and resolution times
 */
calculateSLACompliance(avgFirstResponse, avgResolution) {
  const slaTargets = {
    first_response_hours: 4,
    resolution_hours: 48
  };

  const responseCompliance = avgFirstResponse <= slaTargets.first_response_hours ? 100 :
    (slaTargets.first_response_hours / avgFirstResponse) * 100;

  const resolutionCompliance = avgResolution <= slaTargets.resolution_hours ? 100 :
    (slaTargets.resolution_hours / avgResolution) * 100;

  return Number(((responseCompliance + resolutionCompliance) / 2).toFixed(1));
}

/**
 * Calculate escalation rate based on urgency changes
 */
calculateEscalationRate(tickets) {
  const totalTickets = tickets.length;
  if (totalTickets === 0) return 0;

  const escalatedTickets = tickets.filter(ticket => {
    // Consider a ticket escalated if it's high/critical urgency and still open/in-progress
    return ['high', 'critical'].includes(ticket.urgency) &&
      ['open', 'in-progress'].includes(ticket.status);
  }).length;

  return Number(((escalatedTickets / totalTickets) * 100).toFixed(1));
}

/**
 * Calculate satisfaction trend
 */
calculateSatisfactionTrend(currentSatisfactionData, prevTickets) {
  const currentAvg = currentSatisfactionData.length > 0
    ? currentSatisfactionData.reduce((sum, t) => sum + (t.satisfaction_rating || 0), 0) / currentSatisfactionData.length
    : 0;

  const prevSatisfactionTickets = prevTickets.filter(t => t.satisfaction_rating);
  const prevAvg = prevSatisfactionTickets.length > 0
    ? prevSatisfactionTickets.reduce((sum, t) => sum + t.satisfaction_rating, 0) / prevSatisfactionTickets.length
    : 0;

  if (prevAvg === 0) return 0;
  return Number(((currentAvg - prevAvg) / prevAvg * 100).toFixed(1));
}

/**
 * Validate UUID format with strict checking
 */
validateUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
}

module.exports = new TicketsController();