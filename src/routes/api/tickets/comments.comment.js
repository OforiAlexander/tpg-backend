// src/routes/api/tickets/comments.controller.js - TPG Ticket Comments Controller
const TicketComment = require('../../../models/TicketComment');
const Ticket = require('../../../models/Ticket');
const User = require('../../../models/User');
const logger = require('../../../config/logger');
const { validateCommentCreate, validateCommentUpdate } = require('./comments.validation');

class CommentsController {
  /**
   * Get comments for a ticket
   * GET /api/tickets/:ticketId/comments
   * Permissions: tickets.view.own or tickets.view.all
   */
  async getComments(req, res) {
    try {
      const { ticketId } = req.params;
      const { 
        page = 1, 
        limit = 50, 
        include_internal = false,
        order = 'asc'
      } = req.query;

      // Check if ticket exists and user has permission to view it
      const ticket = await Ticket.query().findById(ticketId);
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
          `ticket_${ticketId}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only view comments on your own tickets'
        });
      }

      // Build query
      let query = TicketComment.query()
        .where('ticket_id', ticketId)
        .withGraphFetched('[user.[select(id, username, email, role)], attachments]');

      // Filter internal comments for non-admin users
      if (!req.user.hasPermission('tickets.view.all') || include_internal !== 'true') {
        query = query.where('is_internal', false);
      }

      // Apply ordering
      query = query.orderBy('created_at', order === 'desc' ? 'desc' : 'asc');

      // Get total count for pagination
      const totalQuery = query.clone().count();
      
      // Apply pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      query = query.offset(offset).limit(parseInt(limit));

      const [comments, [{ count: total }]] = await Promise.all([
        query,
        totalQuery
      ]);

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'ticket_comments',
        ticketId,
        req.ip
      );

      res.json({
        success: true,
        comments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Get comments error:', error);
      res.status(500).json({
        error: 'Failed to retrieve comments',
        message: 'An error occurred while fetching comments'
      });
    }
  }

  /**
   * Add comment to ticket
   * POST /api/tickets/:ticketId/comments
   * Permissions: tickets.view.own or tickets.view.all
   */
  async addComment(req, res) {
    try {
      const { ticketId } = req.params;

      // Validate input
      const { error, value } = validateCommentCreate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const { content, is_internal = false } = value;

      // Check if ticket exists and user has permission to comment
      const ticket = await Ticket.query().findById(ticketId);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      // Check permissions
      const canComment = req.user.hasPermission('tickets.view.all') || 
                        (req.user.hasPermission('tickets.view.own') && ticket.user_id === req.user.id);

      if (!canComment) {
        logger.security.logPermissionDenied(
          req.user.id,
          'tickets.comment',
          `ticket_${ticketId}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only comment on your own tickets'
        });
      }

      // Only admins can create internal comments
      const finalIsInternal = is_internal && req.user.hasPermission('tickets.view.all');

      // Prevent commenting on closed tickets (unless admin)
      if (ticket.status === 'closed' && !req.user.hasPermission('tickets.view.all')) {
        return res.status(400).json({
          error: 'Cannot comment',
          message: 'Comments cannot be added to closed tickets'
        });
      }

      // Create comment
      const comment = await TicketComment.query().insert({
        ticket_id: ticketId,
        user_id: req.user.id,
        content,
        is_internal: finalIsInternal
      });

      // Fetch the created comment with relations
      const createdComment = await TicketComment.query()
        .findById(comment.id)
        .withGraphFetched('[user.[select(id, username, email, role)]]');

      // Update ticket's updated_at timestamp
      await ticket.$query().patch({ updated_at: new Date().toISOString() });

      // If this is the first response from an admin, mark first_response_at
      if (req.user.hasPermission('tickets.view.all') && !ticket.first_response_at) {
        await ticket.$query().patch({ 
          first_response_at: new Date().toISOString() 
        });
      }

      // Auto-update ticket status if needed
      await this.autoUpdateTicketStatus(ticket, req.user, finalIsInternal);

      // Log comment creation
      logger.security.logDataAccess(
        req.user.id,
        'create',
        'ticket_comment',
        comment.id,
        req.ip
      );

      // TODO: Send notification emails to relevant parties
      // await emailService.sendCommentNotification(ticket, createdComment);

      res.status(201).json({
        success: true,
        message: 'Comment added successfully',
        comment: createdComment
      });
    } catch (error) {
      logger.error('Add comment error:', error);
      res.status(500).json({
        error: 'Comment creation failed',
        message: 'An error occurred while adding the comment'
      });
    }
  }

  /**
   * Update comment
   * PUT /api/tickets/:ticketId/comments/:commentId
   * Permissions: Own comment or admin
   */
  async updateComment(req, res) {
    try {
      const { ticketId, commentId } = req.params;

      // Validate input
      const { error, value } = validateCommentUpdate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { content } = value;

      // Check if comment exists
      const comment = await TicketComment.query()
        .findById(commentId)
        .where('ticket_id', ticketId)
        .withGraphFetched('[user, ticket]');

      if (!comment) {
        return res.status(404).json({
          error: 'Comment not found',
          message: 'The requested comment does not exist'
        });
      }

      // Check permissions - user can edit their own comments, admins can edit any
      const canEdit = comment.user_id === req.user.id || req.user.hasPermission('tickets.edit.all');

      if (!canEdit) {
        logger.security.logPermissionDenied(
          req.user.id,
          'comments.edit',
          `comment_${commentId}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only edit your own comments'
        });
      }

      // Prevent editing after 24 hours (unless admin)
      const commentAge = new Date() - new Date(comment.created_at);
      const maxEditTime = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      
      if (commentAge > maxEditTime && !req.user.hasPermission('tickets.edit.all')) {
        return res.status(400).json({
          error: 'Edit time expired',
          message: 'Comments can only be edited within 24 hours of creation'
        });
      }

      // Update comment
      const updatedComment = await comment.$query().patchAndFetch({
        content,
        is_edited: true,
        edited_at: new Date().toISOString()
      });

      // Log comment update
      logger.security.logDataAccess(
        req.user.id,
        'update',
        'ticket_comment',
        commentId,
        req.ip
      );

      res.json({
        success: true,
        message: 'Comment updated successfully',
        comment: updatedComment
      });
    } catch (error) {
      logger.error('Update comment error:', error);
      res.status(500).json({
        error: 'Comment update failed',
        message: 'An error occurred while updating the comment'
      });
    }
  }

  /**
   * Delete comment
   * DELETE /api/tickets/:ticketId/comments/:commentId
   * Permissions: Own comment or admin
   */
  async deleteComment(req, res) {
    try {
      const { ticketId, commentId } = req.params;
      const { reason = 'User requested deletion' } = req.body;

      // Check if comment exists
      const comment = await TicketComment.query()
        .findById(commentId)
        .where('ticket_id', ticketId)
        .withGraphFetched('[user, ticket]');

      if (!comment) {
        return res.status(404).json({
          error: 'Comment not found',
          message: 'The requested comment does not exist'
        });
      }

      // Check permissions
      const canDelete = comment.user_id === req.user.id || req.user.hasPermission('tickets.delete.all');

      if (!canDelete) {
        logger.security.logPermissionDenied(
          req.user.id,
          'comments.delete',
          `comment_${commentId}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only delete your own comments'
        });
      }

      // Soft delete by updating content and marking as deleted
      await comment.$query().patch({
        content: '[Comment deleted]',
        is_edited: true,
        edited_at: new Date().toISOString(),
        metadata: {
          ...comment.metadata,
          deleted: true,
          deleted_by: req.user.id,
          deleted_at: new Date().toISOString(),
          deletion_reason: reason,
          original_content_hash: require('crypto').createHash('md5').update(comment.content).digest('hex')
        }
      });

      // Log comment deletion
      logger.security.logAdminAction(
        req.user.id,
        'comment_deleted',
        commentId,
        {
          ticket_id: ticketId,
          reason
        },
        req.ip
      );

      res.json({
        success: true,
        message: 'Comment deleted successfully'
      });
    } catch (error) {
      logger.error('Delete comment error:', error);
      res.status(500).json({
        error: 'Comment deletion failed',
        message: 'An error occurred while deleting the comment'
      });
    }
  }

  /**
   * Get comment by ID
   * GET /api/tickets/:ticketId/comments/:commentId
   * Permissions: tickets.view.own or tickets.view.all
   */
  async getComment(req, res) {
    try {
      const { ticketId, commentId } = req.params;

      // Check if ticket exists and user has permission
      const ticket = await Ticket.query().findById(ticketId);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      const canView = req.user.hasPermission('tickets.view.all') || 
                     (req.user.hasPermission('tickets.view.own') && ticket.user_id === req.user.id);

      if (!canView) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only view comments on your own tickets'
        });
      }

      // Get comment
      const comment = await TicketComment.query()
        .findById(commentId)
        .where('ticket_id', ticketId)
        .withGraphFetched('[user.[select(id, username, email, role)], attachments]');

      if (!comment) {
        return res.status(404).json({
          error: 'Comment not found',
          message: 'The requested comment does not exist'
        });
      }

      // Filter internal comments for non-admin users
      if (comment.is_internal && !req.user.hasPermission('tickets.view.all')) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You cannot view internal comments'
        });
      }

      res.json({
        success: true,
        comment
      });
    } catch (error) {
      logger.error('Get comment error:', error);
      res.status(500).json({
        error: 'Failed to retrieve comment',
        message: 'An error occurred while fetching the comment'
      });
    }
  }

  /**
   * Toggle internal status of comment (Admin only)
   * PUT /api/tickets/:ticketId/comments/:commentId/internal
   * Permissions: tickets.edit.all
   */
  async toggleInternalStatus(req, res) {
    try {
      const { ticketId, commentId } = req.params;
      const { is_internal } = req.body;

      // Validate is_internal is boolean
      if (typeof is_internal !== 'boolean') {
        return res.status(400).json({
          error: 'Invalid input',
          message: 'is_internal must be a boolean value'
        });
      }

      // Check if comment exists
      const comment = await TicketComment.query()
        .findById(commentId)
        .where('ticket_id', ticketId);

      if (!comment) {
        return res.status(404).json({
          error: 'Comment not found',
          message: 'The requested comment does not exist'
        });
      }

      // Update internal status
      const updatedComment = await comment.$query().patchAndFetch({
        is_internal
      });

      // Log the change
      logger.security.logAdminAction(
        req.user.id,
        'comment_internal_status_changed',
        commentId,
        {
          ticket_id: ticketId,
          old_status: comment.is_internal,
          new_status: is_internal
        },
        req.ip
      );

      res.json({
        success: true,
        message: `Comment ${is_internal ? 'marked as internal' : 'made public'}`,
        comment: updatedComment
      });
    } catch (error) {
      logger.error('Toggle internal status error:', error);
      res.status(500).json({
        error: 'Status update failed',
        message: 'An error occurred while updating comment status'
      });
    }
  }

  /**
   * Get comment statistics for a ticket
   * GET /api/tickets/:ticketId/comments/stats
   * Permissions: tickets.view.own or tickets.view.all
   */
  async getCommentStats(req, res) {
    try {
      const { ticketId } = req.params;

      // Check if ticket exists and user has permission
      const ticket = await Ticket.query().findById(ticketId);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      const canView = req.user.hasPermission('tickets.view.all') || 
                     (req.user.hasPermission('tickets.view.own') && ticket.user_id === req.user.id);

      if (!canView) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only view statistics for your own tickets'
        });
      }

      // Get comment statistics
      const comments = await TicketComment.query()
        .where('ticket_id', ticketId)
        .withGraphFetched('[user]');

      const stats = {
        total_comments: comments.length,
        public_comments: comments.filter(c => !c.is_internal).length,
        internal_comments: comments.filter(c => c.is_internal).length,
        edited_comments: comments.filter(c => c.is_edited).length,
        unique_commenters: [...new Set(comments.map(c => c.user_id))].length,
        first_comment_at: comments.length > 0 ? comments[0].created_at : null,
        last_comment_at: comments.length > 0 ? comments[comments.length - 1].created_at : null,
        average_response_time: this.calculateAverageResponseTime(comments, ticket),
        comments_by_role: this.groupCommentsByRole(comments)
      };

      res.json({
        success: true,
        ticket_id: ticketId,
        statistics: stats
      });
    } catch (error) {
      logger.error('Get comment stats error:', error);
      res.status(500).json({
        error: 'Failed to retrieve statistics',
        message: 'An error occurred while fetching comment statistics'
      });
    }
  }

  // Helper methods

  /**
   * Auto-update ticket status based on comment activity
   */
  async autoUpdateTicketStatus(ticket, user, isInternal) {
    try {
      // If an admin comments on an open ticket, move it to in-progress
      if (ticket.status === 'open' && user.hasPermission('tickets.view.all') && !isInternal) {
        await ticket.$query().patch({
          status: 'in-progress',
          assigned_to: ticket.assigned_to || user.id
        });
        
        logger.info(`Ticket ${ticket.ticket_number} auto-updated to in-progress due to admin comment`);
      }
    } catch (error) {
      logger.error('Auto-update ticket status error:', error);
    }
  }

  /**
   * Calculate average response time between comments
   */
  calculateAverageResponseTime(comments, ticket) {
    if (comments.length < 2) return null;

    const responseTimes = [];
    let lastTimestamp = new Date(ticket.created_at);

    comments.forEach(comment => {
      const commentTime = new Date(comment.created_at);
      const responseTime = commentTime - lastTimestamp;
      responseTimes.push(responseTime);
      lastTimestamp = commentTime;
    });

    const averageMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    return Math.round(averageMs / (1000 * 60 * 60)); // Convert to hours
  }

  /**
   * Group comments by user role
   */
  groupCommentsByRole(comments) {
    const grouped = {
      user: 0,
      admin: 0,
      super_admin: 0
    };

    comments.forEach(comment => {
      if (comment.user) {
        grouped[comment.user.role] = (grouped[comment.user.role] || 0) + 1;
      }
    });

    return grouped;
  }
}

module.exports = new CommentsController();