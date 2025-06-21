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
        'password-changed.hbs'
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
        companyName: 'Traditional and Complementary Medicine Practice Council',
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
    
    return await this.sendTemplatedEmail('welcome', user.email, 'Welcome to TPG State Portal', {
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