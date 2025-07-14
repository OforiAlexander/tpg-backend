// tickets.controller.js - Production-Ready getTicketStats Method

const Ticket = require('./src/models/Tickets');
const TicketComment = require('./src/models/TicketComment');
const User = require('./src/models/User');
const logger = require('./src/config/logger');
const { transaction } = require('objection');
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

class TicketsController {
  /**
   * Get comprehensive ticket statistics with performance optimization
   * GET /api/tickets/stats?period=month&user_id=uuid
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
            .where('ticket_comments.user_id', '!=', Ticket.query(trx).select('user_id').from('tickets').where('id', commentQuery.ref('ticket.id')))
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
            sla_compliance: this.calculateSLACompliance(averageFirstResponseTime, averageResolutionTime),
            escalation_rate: this.calculateEscalationRate(tickets),
            customer_satisfaction_trend: this.calculateSatisfactionTrend(satisfactionData, prevTickets)
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

    } catch (error) {
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
        redis.del(cacheKey).catch(() => {}); // Silent fail on cache clear
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

}

module.exports = new TicketsController();