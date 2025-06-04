// src/services/emailService.js - TPG Email Service
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.enabled = process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true';
    this.initialize();
  }

  /**
   * Initialize email transporter
   */
  async initialize() {
    if (!this.enabled) {
      logger.info('Email service disabled');
      return;
    }

    try {
      // Configure SMTP transporter
      this.transporter = nodemailer.createTransporter({
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
        logger.info('✅ Email service initialized successfully');
      }
    } catch (error) {
      logger.error('Email service initialization failed:', error);
      this.enabled = false;
    }
  }

  /**
   * Send welcome email to new user
   */
  async sendWelcomeEmail(user, verificationToken) {
    if (!this.enabled) {
      logger.info(`Welcome email skipped for ${user.email} (email service disabled)`);
      return { success: true, skipped: true };
    }

    try {
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
      
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'TPG Support <noreply@tpg.gov.gh>',
        to: user.email,
        subject: 'Welcome to TPG State Portal',
        html: this.getWelcomeEmailTemplate(user, verificationUrl),
        text: this.getWelcomeEmailText(user, verificationUrl)
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info(`Welcome email sent to ${user.email}`, {
        messageId: result.messageId,
        userId: user.id
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error(`Failed to send welcome email to ${user.email}:`, error);
      throw error;
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(user, resetToken) {
    if (!this.enabled) {
      logger.info(`Password reset email skipped for ${user.email} (email service disabled)`);
      return { success: true, skipped: true };
    }

    try {
      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
      
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'TPG Support <noreply@tpg.gov.gh>',
        to: user.email,
        subject: 'Password Reset Request - TPG State Portal',
        html: this.getPasswordResetEmailTemplate(user, resetUrl),
        text: this.getPasswordResetEmailText(user, resetUrl)
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info(`Password reset email sent to ${user.email}`, {
        messageId: result.messageId,
        userId: user.id
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error(`Failed to send password reset email to ${user.email}:`, error);
      throw error;
    }
  }

  /**
   * Send ticket created notification
   */
  async sendTicketCreatedEmail(ticket) {
    if (!this.enabled) {
      logger.info(`Ticket created email skipped for ticket ${ticket.ticket_number} (email service disabled)`);
      return { success: true, skipped: true };
    }

    try {
      const ticketUrl = `${process.env.FRONTEND_URL}/tickets/${ticket.id}`;
      
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'TPG Support <noreply@tpg.gov.gh>',
        to: ticket.user.email,
        subject: `New Support Ticket Created - ${ticket.ticket_number}`,
        html: this.getTicketCreatedEmailTemplate(ticket, ticketUrl),
        text: this.getTicketCreatedEmailText(ticket, ticketUrl)
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info(`Ticket created email sent for ${ticket.ticket_number}`, {
        messageId: result.messageId,
        ticketId: ticket.id,
        userEmail: ticket.user.email
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error(`Failed to send ticket created email for ${ticket.ticket_number}:`, error);
      throw error;
    }
  }

  /**
   * Send ticket assigned notification
   */
  async sendTicketAssignedEmail(ticket, assignee) {
    if (!this.enabled) {
      logger.info(`Ticket assigned email skipped for ticket ${ticket.ticket_number} (email service disabled)`);
      return { success: true, skipped: true };
    }

    try {
      const ticketUrl = `${process.env.FRONTEND_URL}/tickets/${ticket.id}`;
      
      // Send to assignee
      const assigneeMailOptions = {
        from: process.env.EMAIL_FROM || 'TPG Support <noreply@tpg.gov.gh>',
        to: assignee.email,
        subject: `Ticket Assigned to You - ${ticket.ticket_number}`,
        html: this.getTicketAssignedEmailTemplate(ticket, assignee, ticketUrl),
        text: this.getTicketAssignedEmailText(ticket, assignee, ticketUrl)
      };

      // Send to ticket creator
      const creatorMailOptions = {
        from: process.env.EMAIL_FROM || 'TPG Support <noreply@tpg.gov.gh>',
        to: ticket.user.email,
        subject: `Your Ticket Has Been Assigned - ${ticket.ticket_number}`,
        html: this.getTicketAssignmentNotificationTemplate(ticket, assignee, ticketUrl),
        text: this.getTicketAssignmentNotificationText(ticket, assignee, ticketUrl)
      };

      const [assigneeResult, creatorResult] = await Promise.all([
        this.transporter.sendMail(assigneeMailOptions),
        this.transporter.sendMail(creatorMailOptions)
      ]);
      
      logger.info(`Ticket assignment emails sent for ${ticket.ticket_number}`, {
        assigneeMessageId: assigneeResult.messageId,
        creatorMessageId: creatorResult.messageId,
        ticketId: ticket.id
      });

      return { 
        success: true, 
        assigneeMessageId: assigneeResult.messageId,
        creatorMessageId: creatorResult.messageId
      };
    } catch (error) {
      logger.error(`Failed to send ticket assignment emails for ${ticket.ticket_number}:`, error);
      throw error;
    }
  }

  /**
   * Send ticket status update notification
   */
  async sendTicketStatusUpdateEmail(ticket) {
    if (!this.enabled) {
      logger.info(`Ticket status email skipped for ticket ${ticket.ticket_number} (email service disabled)`);
      return { success: true, skipped: true };
    }

    try {
      const ticketUrl = `${process.env.FRONTEND_URL}/tickets/${ticket.id}`;
      
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'TPG Support <noreply@tpg.gov.gh>',
        to: ticket.user.email,
        subject: `Ticket Status Updated - ${ticket.ticket_number}`,
        html: this.getTicketStatusUpdateEmailTemplate(ticket, ticketUrl),
        text: this.getTicketStatusUpdateEmailText(ticket, ticketUrl)
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info(`Ticket status update email sent for ${ticket.ticket_number}`, {
        messageId: result.messageId,
        ticketId: ticket.id,
        status: ticket.status
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error(`Failed to send ticket status update email for ${ticket.ticket_number}:`, error);
      throw error;
    }
  }

  /**
   * Send comment notification
   */
  async sendCommentNotification(ticket, comment) {
    if (!this.enabled) {
      logger.info(`Comment notification skipped for ticket ${ticket.ticket_number} (email service disabled)`);
      return { success: true, skipped: true };
    }

    try {
      const ticketUrl = `${process.env.FRONTEND_URL}/tickets/${ticket.id}`;
      const recipients = [];

      // Notify ticket creator if comment is not from them
      if (comment.user_id !== ticket.user_id && !comment.is_internal) {
        recipients.push({
          email: ticket.user.email,
          type: 'creator'
        });
      }

      // Notify assigned user if comment is not from them
      if (ticket.assigned_to && comment.user_id !== ticket.assigned_to) {
        const assignee = await require('../models/User').query().findById(ticket.assigned_to);
        if (assignee) {
          recipients.push({
            email: assignee.email,
            type: 'assignee'
          });
        }
      }

      const results = [];
      for (const recipient of recipients) {
        const mailOptions = {
          from: process.env.EMAIL_FROM || 'TPG Support <noreply@tpg.gov.gh>',
          to: recipient.email,
          subject: `New Comment on Ticket - ${ticket.ticket_number}`,
          html: this.getCommentNotificationEmailTemplate(ticket, comment, ticketUrl),
          text: this.getCommentNotificationEmailText(ticket, comment, ticketUrl)
        };

        const result = await this.transporter.sendMail(mailOptions);
        results.push({ ...recipient, messageId: result.messageId });
      }
      
      logger.info(`Comment notification emails sent for ${ticket.ticket_number}`, {
        ticketId: ticket.id,
        commentId: comment.id,
        recipients: results.length
      });

      return { success: true, results };
    } catch (error) {
      logger.error(`Failed to send comment notification for ticket ${ticket.ticket_number}:`, error);
      throw error;
    }
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
        message: 'Email service is operational'
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Email service is not available',
        error: error.message
      };
    }
  }

  // Email template methods (simplified versions)

  getWelcomeEmailTemplate(user, verificationUrl) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Welcome to TPG State Portal</h2>
        <p>Dear ${user.username},</p>
        <p>Your account has been created successfully. Please verify your email address to complete the registration process.</p>
        <div style="margin: 20px 0;">
          <a href="${verificationUrl}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Verify Email Address</a>
        </div>
        <p><strong>Account Details:</strong></p>
        <ul>
          <li>Email: ${user.email}</li>
          <li>TPG License: ${user.tpg_license_number || 'Not provided'}</li>
          <li>Pharmacy: ${user.pharmacy_name || 'Not provided'}</li>
        </ul>
        <p>If you have any questions, please contact our support team.</p>
        <p>Best regards,<br>TPG Support Team</p>
      </div>
    `;
  }

  getWelcomeEmailText(user, verificationUrl) {
    return `
      Welcome to TPG State Portal
      
      Dear ${user.username},
      
      Your account has been created successfully. Please verify your email address to complete the registration process.
      
      Click here to verify your email: ${verificationUrl}
      
      Account Details:
      - Email: ${user.email}
      - TPG License: ${user.tpg_license_number || 'Not provided'}
      - Pharmacy: ${user.pharmacy_name || 'Not provided'}
      
      If you have any questions, please contact our support team.
      
      Best regards,
      TPG Support Team
    `;
  }

  getPasswordResetEmailTemplate(user, resetUrl) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Password Reset Request</h2>
        <p>Dear ${user.username},</p>
        <p>You have requested to reset your password for TPG State Portal.</p>
        <div style="margin: 20px 0;">
          <a href="${resetUrl}" style="background-color: #dc2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Reset Password</a>
        </div>
        <p><strong>Important:</strong> This link will expire in 1 hour for security reasons.</p>
        <p>If you did not request this reset, please ignore this email or contact support if you have concerns.</p>
        <p>Best regards,<br>TPG Support Team</p>
      </div>
    `;
  }

  getPasswordResetEmailText(user, resetUrl) {
    return `
      Password Reset Request
      
      Dear ${user.username},
      
      You have requested to reset your password for TPG State Portal.
      
      Click here to reset your password: ${resetUrl}
      
      Important: This link will expire in 1 hour for security reasons.
      
      If you did not request this reset, please ignore this email or contact support if you have concerns.
      
      Best regards,
      TPG Support Team
    `;
  }

  getTicketCreatedEmailTemplate(ticket, ticketUrl) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Support Ticket Created</h2>
        <p>Dear ${ticket.user.username},</p>
        <p>Your support ticket has been created successfully and our team has been notified.</p>
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 4px; margin: 15px 0;">
          <p><strong>Ticket Number:</strong> ${ticket.ticket_number}</p>
          <p><strong>Category:</strong> ${ticket.category}</p>
          <p><strong>Priority:</strong> ${ticket.urgency}</p>
          <p><strong>Title:</strong> ${ticket.title}</p>
        </div>
        <div style="margin: 20px 0;">
          <a href="${ticketUrl}" style="background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">View Ticket</a>
        </div>
        <p>Our team will review your request and respond within the expected timeframe based on the priority level.</p>
        <p>Best regards,<br>TPG Support Team</p>
      </div>
    `;
  }

  getTicketCreatedEmailText(ticket, ticketUrl) {
    return `
      Support Ticket Created
      
      Dear ${ticket.user.username},
      
      Your support ticket has been created successfully and our team has been notified.
      
      Ticket Details:
      - Ticket Number: ${ticket.ticket_number}
      - Category: ${ticket.category}
      - Priority: ${ticket.urgency}
      - Title: ${ticket.title}
      
      View your ticket: ${ticketUrl}
      
      Our team will review your request and respond within the expected timeframe based on the priority level.
      
      Best regards,
      TPG Support Team
    `;
  }

  // Additional template methods would follow the same pattern...
  // For brevity, I'm including stubs for the remaining methods

  getTicketAssignedEmailTemplate(ticket, assignee, ticketUrl) {
    return `<div>Ticket ${ticket.ticket_number} has been assigned to you. <a href="${ticketUrl}">View Ticket</a></div>`;
  }

  getTicketAssignedEmailText(ticket, assignee, ticketUrl) {
    return `Ticket ${ticket.ticket_number} has been assigned to you. View: ${ticketUrl}`;
  }

  getTicketAssignmentNotificationTemplate(ticket, assignee, ticketUrl) {
    return `<div>Your ticket ${ticket.ticket_number} has been assigned to ${assignee.username}. <a href="${ticketUrl}">View Ticket</a></div>`;
  }

  getTicketAssignmentNotificationText(ticket, assignee, ticketUrl) {
    return `Your ticket ${ticket.ticket_number} has been assigned to ${assignee.username}. View: ${ticketUrl}`;
  }

  getTicketStatusUpdateEmailTemplate(ticket, ticketUrl) {
    return `<div>Ticket ${ticket.ticket_number} status updated to: ${ticket.status}. <a href="${ticketUrl}">View Ticket</a></div>`;
  }

  getTicketStatusUpdateEmailText(ticket, ticketUrl) {
    return `Ticket ${ticket.ticket_number} status updated to: ${ticket.status}. View: ${ticketUrl}`;
  }

  getCommentNotificationEmailTemplate(ticket, comment, ticketUrl) {
    return `<div>New comment on ticket ${ticket.ticket_number}. <a href="${ticketUrl}">View Ticket</a></div>`;
  }

  getCommentNotificationEmailText(ticket, comment, ticketUrl) {
    return `New comment on ticket ${ticket.ticket_number}. View: ${ticketUrl}`;
  }
}

module.exports = new EmailService();