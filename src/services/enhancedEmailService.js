// src/services/enhancedEmailService.js - Enhanced TPG Email Service with Security Notifications
const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const juice = require('juice');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../config/logger');

class EnhancedEmailService {
  constructor() {
    this.transporter = null;
    this.enabled = process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true';
    this.templatesPath = path.join(__dirname, '../mail/templates');
    this.compiledTemplates = new Map();
    this.initialize();
  }

  /**
   * Initialize email transporter and templates
   */
  async initialize() {
    if (!this.enabled) {
      logger.info('Email service disabled');
      return;
    }

    try {
      // Configure SMTP transporter
      this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'localhost',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: process.env.EMAIL_SECURE === 'true',
        auth: process.env.EMAIL_USER ? {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD
        } : undefined,
        tls: {
          rejectUnauthorized: process.env.NODE_ENV === 'production'
        }
      });

      // Verify connection
      if (process.env.NODE_ENV !== 'test') {
        await this.transporter.verify();
        logger.info('✅ Enhanced Email service initialized successfully');
      }

      // Load and compile templates
      await this.loadTemplates();
    } catch (error) {
      logger.error('Enhanced Email service initialization failed:', error);
      this.enabled = false;
    }
  }

  /**
   * Load and compile Handlebars templates
   */
  async loadTemplates() {
    try {
      const templateFiles = [
        'welcome.hbs',
        'password-reset.hbs', 
        'password-reset-confirmation.hbs',
        'account-locked.hbs',
        'security-alert.hbs',
        'login-notification.hbs',
        'email-verification.hbs',
        'password-changed.hbs',

        // tickets
        'ticket-created.hbs',
  'ticket-assigned.hbs',
  'ticket-status-changed.hbs',
  'ticket-comment-added.hbs',
  'ticket-resolved.hbs'
      ];

      for (const file of templateFiles) {
        const templatePath = path.join(this.templatesPath, file);
        try {
          const templateContent = await fs.readFile(templatePath, 'utf8');
          const compiled = handlebars.compile(templateContent);
          this.compiledTemplates.set(file.replace('.hbs', ''), compiled);
        } catch (error) {
          logger.warn(`Template ${file} not found, using fallback`);
        }
      }

      logger.info(`✅ Loaded ${this.compiledTemplates.size} email templates`);
    } catch (error) {
      logger.error('Failed to load email templates:', error);
    }
  }

  /**
   * Send templated email
   */
  async sendTemplatedEmail(templateName, to, subject, data = {}) {
    if (!this.enabled) {
      logger.info(`Email skipped: ${templateName} to ${to} (service disabled)`);
      return { success: true, skipped: true };
    }

    try {
      const template = this.compiledTemplates.get(templateName);
      if (!template) {
        throw new Error(`Template ${templateName} not found`);
      }

      // Add common template variables
      const templateData = {
        ...data,
        frontendUrl: process.env.FRONTEND_URL,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@upsamail.edu.gh',
        companyName: 'Univerisity of Professional Studies, Accra',
        year: new Date().getFullYear(),
        timestamp: new Date().toLocaleString('en-GH', { 
          timeZone: 'GMT',
          dateStyle: 'full',
          timeStyle: 'medium'
        })
      };

      const htmlContent = template(templateData);
      const inlinedHtml = juice(htmlContent); // Inline CSS for better email client support

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'TPG Support <noreply@upsamail.edu.gh>',
        to,
        subject,
        html: inlinedHtml,
        text: this.htmlToText(htmlContent) // Fallback text version
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info(`Email sent: ${templateName} to ${to}`, {
        messageId: result.messageId,
        template: templateName
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error(`Failed to send ${templateName} email to ${to}:`, error);
      throw error;
    }
  }

  /**
   * Send welcome email with verification
   */
  async sendWelcomeEmail(user, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    
    return await this.sendTemplatedEmail('welcome', user.email, 'Welcome to UPSA State Portal', {
      user,
      verificationUrl,
      verificationToken
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const expiryTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    
    return await this.sendTemplatedEmail('password-reset', user.email, 'Password Reset Request - TPG Portal', {
      user,
      resetUrl,
      resetToken,
      expiryTime: expiryTime.toLocaleString('en-GH', { timeZone: 'GMT' })
    });
  }

  /**
   * Send password reset confirmation
   */
  async sendPasswordResetConfirmation(user, ipAddress, userAgent) {
    return await this.sendTemplatedEmail('password-reset-confirmation', user.email, 'Password Successfully Reset - TPG Portal', {
      user,
      ipAddress,
      userAgent,
      loginUrl: `${process.env.FRONTEND_URL}/login`
    });
  }

  /**
   * Send account locked notification
   */
  async sendAccountLockedEmail(user, reason, lockDuration) {
    const unlockTime = new Date(Date.now() + lockDuration * 60 * 1000);
    
    return await this.sendTemplatedEmail('account-locked', user.email, 'Account Security Alert - Account Locked', {
      user,
      reason,
      unlockTime: unlockTime.toLocaleString('en-GH', { timeZone: 'GMT' }),
      supportUrl: `${process.env.FRONTEND_URL}/support`
    });
  }

  /**
   * Send security alert for suspicious activity
   */
  async sendSecurityAlert(user, alertType, details) {
    const alertMessages = {
      'login_from_new_device': 'Login from new device detected',
      'login_from_new_location': 'Login from unusual location detected', 
      'multiple_failed_logins': 'Multiple failed login attempts detected',
      'password_change_attempt': 'Unauthorized password change attempt',
      'suspicious_activity': 'Suspicious account activity detected'
    };

    return await this.sendTemplatedEmail('security-alert', user.email, `Security Alert - ${alertMessages[alertType]}`, {
      user,
      alertType,
      alertMessage: alertMessages[alertType],
      details,
      securityUrl: `${process.env.FRONTEND_URL}/security`,
      changePasswordUrl: `${process.env.FRONTEND_URL}/change-password`
    });
  }

  /**
   * Send login notification for new device/location
   */
  async sendLoginNotification(user, loginDetails) {
    return await this.sendTemplatedEmail('login-notification', user.email, 'New Login to Your TPG Account', {
      user,
      loginDetails,
      securityUrl: `${process.env.FRONTEND_URL}/security`
    });
  }

  /**
   * Send email verification
   */
  async sendEmailVerification(user, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    
    return await this.sendTemplatedEmail('email-verification', user.email, 'Verify Your Email Address - TPG Portal', {
      user,
      verificationUrl,
      verificationToken
    });
  }

  /**
 * Send new ticket created notification
 * @param {Object} ticket - Ticket object with relations
 * @param {Object} recipient - User object receiving the notification
 * @param {boolean} isAdminNotification - Whether this is for admin or user
 */
async sendTicketCreatedNotification(ticket, recipient, isAdminNotification = false) {
  try {
    const templateData = {
      ticket: {
        ticket_number: ticket.ticket_number,
        subject: ticket.subject,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        created_at: this.formatDate(ticket.created_at),
        user: {
          username: ticket.user.username,
          email: ticket.user.email
        }
      },
      ticketUrl: this.generateTicketUrl(ticket.ticket_number),
      isAdminNotification,
      timestamp: this.formatDate(new Date()),
      companyName: process.env.ORG_NAME || 'TPG Portal',
      year: new Date().getFullYear()
    };

    const subject = isAdminNotification 
      ? `[${ticket.ticket_number}] New Ticket: ${ticket.subject}`
      : `Ticket Created: ${ticket.ticket_number}`;

    await this.sendTemplatedEmail(
      'ticket-created',
      recipient.email,
      subject,
      templateData
    );

    logger.info(`Ticket created notification sent to ${recipient.email}`, {
      ticket_id: ticket.id,
      recipient_email: recipient.email,
      is_admin: isAdminNotification
    });

  } catch (error) {
    logger.error('Failed to send ticket created notification:', error);
    throw error;
  }
}

/**
 * Send ticket assignment notification
 * @param {Object} ticket - Ticket object with relations
 * @param {Object} assignedTo - User assigned to the ticket
 * @param {Object} assignedBy - User who made the assignment
 * @param {Object} recipient - User receiving the notification
 * @param {boolean} isUserNotification - Whether this is for the ticket creator
 */
async sendTicketAssignedNotification(ticket, assignedTo, assignedBy, recipient, isUserNotification = false) {
  try {
    const templateData = {
      ticket: {
        ticket_number: ticket.ticket_number,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status
      },
      assignedTo: {
        username: assignedTo.username,
        email: assignedTo.email
      },
      assignedBy: {
        username: assignedBy.username,
        email: assignedBy.email
      },
      ticketUrl: this.generateTicketUrl(ticket.ticket_number),
      isUserNotification,
      timestamp: this.formatDate(new Date()),
      companyName: process.env.ORG_NAME || 'TPG Portal',
      year: new Date().getFullYear()
    };

    const subject = isUserNotification
      ? `[${ticket.ticket_number}] Ticket Assigned to ${assignedTo.username}`
      : `[${ticket.ticket_number}] Ticket Assigned to You`;

    await this.sendTemplatedEmail(
      'ticket-assigned',
      recipient.email,
      subject,
      templateData
    );

    logger.info(`Ticket assignment notification sent to ${recipient.email}`, {
      ticket_id: ticket.id,
      assigned_to: assignedTo.id,
      assigned_by: assignedBy.id,
      recipient_email: recipient.email,
      is_user_notification: isUserNotification
    });

  } catch (error) {
    logger.error('Failed to send ticket assignment notification:', error);
    throw error;
  }
}

/**
 * Send ticket status change notification
 * @param {Object} ticket - Ticket object with relations
 * @param {string} oldStatus - Previous status
 * @param {Object} updatedBy - User who changed the status
 * @param {Object} recipient - User receiving the notification
 * @param {string} statusMessage - Optional message about the status change
 */
async sendTicketStatusChangedNotification(ticket, oldStatus, updatedBy, recipient, statusMessage = null) {
  try {
    const templateData = {
      ticket: {
        ticket_number: ticket.ticket_number,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status
      },
      oldStatus,
      updatedBy: {
        username: updatedBy.username,
        email: updatedBy.email
      },
      statusMessage,
      ticketUrl: this.generateTicketUrl(ticket.ticket_number),
      timestamp: this.formatDate(new Date()),
      companyName: process.env.ORG_NAME || 'TPG Portal',
      year: new Date().getFullYear()
    };

    const subject = `[${ticket.ticket_number}] Status Changed: ${oldStatus} → ${ticket.status}`;

    await this.sendTemplatedEmail(
      'ticket-status-changed',
      recipient.email,
      subject,
      templateData
    );

    logger.info(`Status change notification sent to ${recipient.email}`, {
      ticket_id: ticket.id,
      old_status: oldStatus,
      new_status: ticket.status,
      updated_by: updatedBy.id,
      recipient_email: recipient.email
    });

  } catch (error) {
    logger.error('Failed to send status change notification:', error);
    throw error;
  }
}

/**
 * Send new comment notification
 * @param {Object} ticket - Ticket object with relations
 * @param {Object} comment - Comment object with user relation
 * @param {Object} recipient - User receiving the notification
 */
async sendTicketCommentNotification(ticket, comment, recipient) {
  try {
    const templateData = {
      ticket: {
        ticket_number: ticket.ticket_number,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        updated_at: this.formatDate(ticket.updated_at)
      },
      comment: {
        content: comment.content,
        is_internal: comment.is_internal,
        created_at: this.formatDate(comment.created_at),
        user: {
          username: comment.user.username,
          email: comment.user.email,
          role: comment.user.role
        }
      },
      ticketUrl: this.generateTicketUrl(ticket.ticket_number),
      timestamp: this.formatDate(new Date()),
      companyName: process.env.ORG_NAME || 'TPG Portal',
      year: new Date().getFullYear()
    };

    const subject = `[${ticket.ticket_number}] New Comment from ${comment.user.username}`;
    await this.sendTemplatedEmail(

      'ticket-comment-added',
      recipient.email,
      subject,
      templateData
    );

    logger.info(`Comment notification sent to ${recipient.email}`, {
      ticket_id: ticket.id,
      comment_id: comment.id,
      comment_author: comment.user.id,
      recipient_email: recipient.email
    });

  } catch (error) {
    logger.error('Failed to send comment notification:', error);
    throw error;
  }
}

/**
 * Send ticket resolved notification
 * @param {Object} ticket - Ticket object with relations
 * @param {Object} resolution - Resolution details
 * @param {Object} resolvedBy - User who resolved the ticket
 * @param {Object} recipient - User receiving the notification
 */
async sendTicketResolvedNotification(ticket, resolution, resolvedBy, recipient) {
  try {
    const templateData = {
      ticket: {
        ticket_number: ticket.ticket_number,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status
      },
      resolution: {
        content: resolution.content,
        totalTime: this.calculateTotalTime(ticket.created_at, new Date())
      },
      resolvedBy: {
        username: resolvedBy.username,
        email: resolvedBy.email
      },
      ticketUrl: this.generateTicketUrl(ticket.ticket_number),
      feedbackUrl: this.generateFeedbackUrl(ticket.ticket_number),
      timestamp: this.formatDate(new Date()),
      companyName: process.env.ORG_NAME || 'TPG Portal',
      year: new Date().getFullYear()
    };

    const subject = `[${ticket.ticket_number}] Ticket Resolved: ${ticket.subject}`;

    await this.sendTemplatedEmail(
      'ticket-resolved',
      recipient.email,
      subject,
      templateData
    );

    logger.info(`Resolution notification sent to ${recipient.email}`, {
      ticket_id: ticket.id,
      resolved_by: resolvedBy.id,
      recipient_email: recipient.email
    });

  } catch (error) {
    logger.error('Failed to send resolution notification:', error);
    throw error;
  }
}

/**
 * Send bulk ticket notifications (for multiple recipients)
 * @param {string} notificationType - Type of notification
 * @param {Object} ticket - Ticket object
 * @param {Array} recipients - Array of recipient objects
 * @param {Object} additionalData - Additional data specific to notification type
 */
async sendBulkTicketNotifications(notificationType, ticket, recipients, additionalData = {}) {
  try {
    const notifications = recipients.map(recipient => {
      switch (notificationType) {
        case 'ticket-created':
          return this.sendTicketCreatedNotification(
            ticket, 
            recipient, 
            additionalData.isAdminNotification || false
          );
        
        case 'ticket-assigned':
          return this.sendTicketAssignedNotification(
            ticket,
            additionalData.assignedTo,
            additionalData.assignedBy,
            recipient,
            additionalData.isUserNotification || false
          );
        
        case 'ticket-status-changed':
          return this.sendTicketStatusChangedNotification(
            ticket,
            additionalData.oldStatus,
            additionalData.updatedBy,
            recipient,
            additionalData.statusMessage
          );
        
        case 'ticket-comment-added':
          return this.sendTicketCommentNotification(
            ticket,
            additionalData.comment,
            recipient
          );
        
        case 'ticket-resolved':
          return this.sendTicketResolvedNotification(
            ticket,
            additionalData.resolution,
            additionalData.resolvedBy,
            recipient
          );
        
        default:
          throw new Error(`Unknown notification type: ${notificationType}`);
      }
    });

    await Promise.allSettled(notifications);

    logger.info(`Bulk ${notificationType} notifications sent`, {
      ticket_id: ticket.id,
      recipient_count: recipients.length,
      notification_type: notificationType
    });

  } catch (error) {
    logger.error(`Failed to send bulk ${notificationType} notifications:`, error);
    throw error;
  }
}

/**
 * Helper method to generate ticket URL
 * @param {string} ticketNumber - Ticket number
 * @returns {string} Full ticket URL
 */
generateTicketUrl(ticketNumber) {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${baseUrl}/tickets/${ticketNumber}`;
}

/**
 * Helper method to generate feedback URL
 * @param {string} ticketNumber - Ticket number
 * @returns {string} Full feedback URL
 */
generateFeedbackUrl(ticketNumber) {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${baseUrl}/feedback/${ticketNumber}`;
}

/**
 * Helper method to calculate total time between dates
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {string} Formatted time difference
 */
calculateTotalTime(startDate, endDate) {
  const diffMs = new Date(endDate) - new Date(startDate);
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''}, ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''}, ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;
  } else {
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;
  }
}

/**
 * Helper method to format dates consistently
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
formatDate(date) {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

  /**
   * Send password changed confirmation
   */
  async sendPasswordChangedNotification(user, ipAddress, userAgent) {
    return await this.sendTemplatedEmail('password-changed', user.email, 'Password Changed Successfully - TPG Portal', {
      user,
      ipAddress,
      userAgent,
      securityUrl: `${process.env.FRONTEND_URL}/security`
    });
  }

  /**
   * Convert HTML to plain text (simple implementation)
   */
  htmlToText(html) {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check email service health
   */
  async healthCheck() {
    if (!this.enabled) {
      return {
        status: 'disabled',
        message: 'Email service is disabled'
      };
    }

    try {
      await this.transporter.verify();
      return {
        status: 'healthy',
        message: 'Email service is operational',
        templatesLoaded: this.compiledTemplates.size
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Email service is not available',
        error: error.message
      };
    }
  }
}

module.exports = new EnhancedEmailService();