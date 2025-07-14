const enhancedEmailService = require('./enhancedEmailService');
const User = require('../models/User');
const logger = require('../config/logger');

class TicketNotificationService {
  /**
   * Send all relevant notifications when a ticket is created
   * @param {Object} ticket - Ticket object with user relation
   */
  async notifyTicketCreated(ticket) {
    try {
      // Get all admins to notify
      const admins = await User.query()
        .where('role', 'admin')
        .orWhere('role', 'super_admin')
        .where('status', 'active');

      // Notify user who created the ticket
      await enhancedEmailService.sendTicketCreatedNotification(
        ticket,
        ticket.user,
        false // isAdminNotification
      );

      // Notify all admins
      if (admins.length > 0) {
        await enhancedEmailService.sendBulkTicketNotifications(
          'ticket-created',
          ticket,
          admins,
          { isAdminNotification: true }
        );
      }

    } catch (error) {
      logger.error('Failed to send ticket created notifications:', error);
    }
  }

  /**
   * Send notifications when a ticket is assigned
   * @param {Object} ticket - Ticket object
   * @param {Object} assignedTo - User assigned to the ticket
   * @param {Object} assignedBy - User who made the assignment
   */
  async notifyTicketAssigned(ticket, assignedTo, assignedBy) {
    try {
      // Notify the assigned user
      await enhancedEmailService.sendTicketAssignedNotification(
        ticket,
        assignedTo,
        assignedBy,
        assignedTo,
        false // isUserNotification
      );

      // Notify the ticket creator if they're different from assigned user
      if (ticket.user_id !== assignedTo.id) {
        await enhancedEmailService.sendTicketAssignedNotification(
          ticket,
          assignedTo,
          assignedBy,
          ticket.user,
          true // isUserNotification
        );
      }

    } catch (error) {
      logger.error('Failed to send ticket assignment notifications:', error);
    }
  }

  /**
   * Send notifications when ticket status changes
   * @param {Object} ticket - Ticket object with user relation
   * @param {string} oldStatus - Previous status
   * @param {Object} updatedBy - User who changed the status
   * @param {string} statusMessage - Optional message about the change
   */
  async notifyTicketStatusChanged(ticket, oldStatus, updatedBy, statusMessage = null) {
    try {
      const recipients = [ticket.user];

      // Add assigned user if different from ticket creator
      if (ticket.assigned_to && ticket.assigned_to !== ticket.user_id) {
        const assignedUser = await User.query().findById(ticket.assigned_to);
        if (assignedUser) {
          recipients.push(assignedUser);
        }
      }

      // Send notifications to all relevant users
      await enhancedEmailService.sendBulkTicketNotifications(
        'ticket-status-changed',
        ticket,
        recipients,
        { oldStatus, updatedBy, statusMessage }
      );

    } catch (error) {
      logger.error('Failed to send status change notifications:', error);
    }
  }

  /**
   * Send notifications when a comment is added
   * @param {Object} ticket - Ticket object with user relation
   * @param {Object} comment - Comment object with user relation
   */
  async notifyTicketComment(ticket, comment) {
    try {
      const recipients = [];

      // Add ticket creator if they didn't write the comment
      if (ticket.user_id !== comment.user_id) {
        recipients.push(ticket.user);
      }

      // Add assigned user if different from comment author and ticket creator
      if (ticket.assigned_to && 
          ticket.assigned_to !== comment.user_id && 
          ticket.assigned_to !== ticket.user_id) {
        const assignedUser = await User.query().findById(ticket.assigned_to);
        if (assignedUser) {
          recipients.push(assignedUser);
        }
      }

      // Don't send notifications for internal comments to regular users
      if (comment.is_internal) {
        // Only notify admins for internal comments
        const admins = await User.query()
          .where('role', 'admin')
          .orWhere('role', 'super_admin')
          .where('status', 'active')
          .whereNot('id', comment.user_id);

        recipients.push(...admins);
      }

      // Send notifications to all relevant users
      if (recipients.length > 0) {
        await enhancedEmailService.sendBulkTicketNotifications(
          'ticket-comment-added',
          ticket,
          recipients,
          { comment }
        );
      }

    } catch (error) {
      logger.error('Failed to send comment notifications:', error);
    }
  }

  /**
   * Send notifications when a ticket is resolved
   * @param {Object} ticket - Ticket object with user relation
   * @param {Object} resolution - Resolution details
   * @param {Object} resolvedBy - User who resolved the ticket
   */
  async notifyTicketResolved(ticket, resolution, resolvedBy) {
    try {
      const recipients = [ticket.user];

      // Add assigned user if different from ticket creator
      if (ticket.assigned_to && ticket.assigned_to !== ticket.user_id) {
        const assignedUser = await User.query().findById(ticket.assigned_to);
        if (assignedUser && assignedUser.id !== resolvedBy.id) {
          recipients.push(assignedUser);
        }
      }

      // Send notifications to all relevant users
      await enhancedEmailService.sendBulkTicketNotifications(
        'ticket-resolved',
        ticket,
        recipients,
        { resolution, resolvedBy }
      );

    } catch (error) {
      logger.error('Failed to send resolution notifications:', error);
    }
  }

  /**
   * Send digest notifications (daily/weekly summaries)
   * @param {Object} user - User to send digest to
   * @param {Object} digestData - Digest data
   */
  async sendTicketDigest(user, digestData) {
    try {
      // This would be implemented for digest notifications
      // For now, we'll just log it
      logger.info('Ticket digest notification requested', {
        user_id: user.id,
        digest_type: digestData.type
      });
    } catch (error) {
      logger.error('Failed to send ticket digest:', error);
    }
  }
}

module.exports = new TicketNotificationService();