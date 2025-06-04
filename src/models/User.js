// src/models/User.js - TPG User Model with Objection.js
const { Model } = require('objection');
const bcrypt = require('bcryptjs');
const logger = require('../config/logger');

class User extends Model {
  static get tableName() {
    return 'users';
  }

  static get idColumn() {
    return 'id';
  }

  // Define the JSON schema for validation
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['username', 'email', 'password_hash'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        username: { type: 'string', minLength: 2, maxLength: 255 },
        email: { 
          type: 'string', 
          format: 'email',
          pattern: '^[a-zA-Z0-9._%+-]+@tpg\\.gov\\.gh$' // TPG email validation
        },
        password_hash: { type: 'string' },
        role: { 
          type: 'string', 
          enum: ['user', 'admin', 'super_admin'],
          default: 'user'
        },
        status: { 
          type: 'string', 
          enum: ['active', 'pending', 'suspended', 'locked'],
          default: 'pending'
        },
        tpg_license_number: { type: ['string', 'null'], maxLength: 50 },
        pharmacy_name: { type: ['string', 'null'], maxLength: 255 },
        phone_number: { type: ['string', 'null'], maxLength: 20 },
        address: { type: ['string', 'null'] },
        failed_login_attempts: { type: 'integer', minimum: 0, default: 0 },
        locked_until: { type: ['string', 'null'], format: 'date-time' },
        email_verified_at: { type: ['string', 'null'], format: 'date-time' },
        email_verification_token: { type: ['string', 'null'] },
        password_reset_token: { type: ['string', 'null'] },
        password_reset_expires: { type: ['string', 'null'], format: 'date-time' },
        last_login: { type: ['string', 'null'], format: 'date-time' },
        last_login_ip: { type: ['string', 'null'] },
        last_user_agent: { type: ['string', 'null'] },
        profile_data: { type: ['object', 'null'] },
        preferences: { type: 'object', default: {} }
      }
    };
  }

  // Define relationships
  static get relationMappings() {
    const Ticket = require('./Ticket');
    const TicketComment = require('./TicketComment');
    const AuditLog = require('./AuditLog');

    return {
      // User's tickets
      tickets: {
        relation: Model.HasManyRelation,
        modelClass: Ticket,
        join: {
          from: 'users.id',
          to: 'tickets.user_id'
        }
      },

      // Tickets assigned to user (for admins)
      assignedTickets: {
        relation: Model.HasManyRelation,
        modelClass: Ticket,
        join: {
          from: 'users.id',
          to: 'tickets.assigned_to'
        }
      },

      // User's comments
      comments: {
        relation: Model.HasManyRelation,
        modelClass: TicketComment,
        join: {
          from: 'users.id',
          to: 'ticket_comments.user_id'
        }
      },

      // Audit logs for this user
      auditLogs: {
        relation: Model.HasManyRelation,
        modelClass: AuditLog,
        join: {
          from: 'users.id',
          to: 'audit_logs.user_id'
        }
      }
    };
  }

  // Hooks - called before insert
  async $beforeInsert(context) {
    await super.$beforeInsert(context);
    
    const now = new Date().toISOString();
    this.created_at = now;
    this.updated_at = now;
    
    // Generate UUID if not provided
    if (!this.id) {
      this.id = require('uuid').v4();
    }

    // Set default preferences
    if (!this.preferences) {
      this.preferences = {
        email_notifications: true,
        dashboard_layout: 'default',
        theme: 'light',
        language: 'en'
      };
    }

    // Hash password if it's being set
    if (this.password && !this.password_hash) {
      this.password_hash = await this.hashPassword(this.password);
      delete this.password; // Remove plain password
    }
  }

  // Hooks - called before update
  async $beforeUpdate(context) {
    await super.$beforeUpdate(context);
    this.updated_at = new Date().toISOString();

    // Hash password if it's being updated
    if (this.password) {
      this.password_hash = await this.hashPassword(this.password);
      delete this.password; // Remove plain password
    }
  }

  // Instance methods

  /**
   * Hash password using bcrypt
   */
  async hashPassword(password) {
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    return await bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password) {
    return await bcrypt.compare(password, this.password_hash);
  }

  /**
   * Check if user is locked
   */
  isLocked() {
    if (!this.locked_until) return false;
    return new Date() < new Date(this.locked_until);
  }

  /**
   * Lock user account
   */
  async lockAccount(durationMs = 15 * 60 * 1000) { // 15 minutes default
    const lockUntil = new Date(Date.now() + durationMs);
    
    await this.$query().patch({
      locked_until: lockUntil.toISOString(),
      failed_login_attempts: this.failed_login_attempts + 1,
      updated_at: new Date().toISOString()
    });

    logger.security.logAuth('account_locked', this.email, null, null, false, {
      lock_duration: durationMs,
      failed_attempts: this.failed_login_attempts + 1
    });
  }

  /**
   * Unlock user account
   */
  async unlockAccount() {
    await this.$query().patch({
      locked_until: null,
      failed_login_attempts: 0,
      updated_at: new Date().toISOString()
    });

    logger.security.logAuth('account_unlocked', this.email, null, null, true);
  }

  /**
   * Increment failed login attempts
   */
  async incrementFailedLogins() {
    const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
    const newAttempts = this.failed_login_attempts + 1;

    if (newAttempts >= maxAttempts) {
      await this.lockAccount();
    } else {
      await this.$query().patch({
        failed_login_attempts: newAttempts,
        updated_at: new Date().toISOString()
      });
    }

    return newAttempts;
  }

  /**
   * Reset failed login attempts (on successful login)
   */
  async resetFailedLogins() {
    if (this.failed_login_attempts > 0) {
      await this.$query().patch({
        failed_login_attempts: 0,
        updated_at: new Date().toISOString()
      });
    }
  }

  /**
   * Update last login information
   */
  async updateLastLogin(ip, userAgent) {
    await this.$query().patch({
      last_login: new Date().toISOString(),
      last_login_ip: ip,
      last_user_agent: userAgent,
      updated_at: new Date().toISOString()
    });

    logger.security.logAuth('login_success', this.email, ip, userAgent, true);
  }

  /**
   * Generate email verification token
   */
  async generateEmailVerificationToken() {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    
    await this.$query().patch({
      email_verification_token: token,
      updated_at: new Date().toISOString()
    });

    return token;
  }

  /**
   * Verify email using token
   */
  async verifyEmail(token) {
    if (this.email_verification_token !== token) {
      return false;
    }

    await this.$query().patch({
      email_verified_at: new Date().toISOString(),
      email_verification_token: null,
      status: this.status === 'pending' ? 'active' : this.status,
      updated_at: new Date().toISOString()
    });

    logger.security.logAuth('email_verified', this.email, null, null, true);
    return true;
  }

  /**
   * Generate password reset token
   */
  async generatePasswordResetToken() {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.$query().patch({
      password_reset_token: token,
      password_reset_expires: expires.toISOString(),
      updated_at: new Date().toISOString()
    });

    logger.security.logAuth('password_reset_requested', this.email, null, null, true);
    return token;
  }

  /**
   * Reset password using token
   */
  async resetPassword(token, newPassword) {
    if (!this.password_reset_token || this.password_reset_token !== token) {
      return false;
    }

    if (!this.password_reset_expires || new Date() > new Date(this.password_reset_expires)) {
      return false;
    }

    const hashedPassword = await this.hashPassword(newPassword);

    await this.$query().patch({
      password_hash: hashedPassword,
      password_reset_token: null,
      password_reset_expires: null,
      failed_login_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString()
    });

    logger.security.logAuth('password_reset_completed', this.email, null, null, true);
    return true;
  }

  /**
   * Check if user has permission
   */
  hasPermission(permission) {
    const rolePermissions = {
      user: [
        'tickets.create',
        'tickets.view.own',
        'tickets.edit.own',
        'tickets.delete.own'
      ],
      admin: [
        'tickets.create',
        'tickets.view.own',
        'tickets.view.all',
        'tickets.edit.own',
        'tickets.edit.all',
        'tickets.assign',
        'tickets.close',
        'users.view',
        'analytics.view'
      ],
      super_admin: [
        'tickets.*',
        'users.*',
        'analytics.*',
        'system.admin',
        'categories.manage'
      ]
    };

    const userPermissions = rolePermissions[this.role] || [];
    
    // Check for exact match
    if (userPermissions.includes(permission)) {
      return true;
    }

    // Check for wildcard permissions
    const wildcardPermissions = userPermissions.filter(p => p.endsWith('*'));
    return wildcardPermissions.some(wildcard => {
      const prefix = wildcard.slice(0, -1);
      return permission.startsWith(prefix);
    });
  }

  /**
   * Get safe user data (without sensitive fields)
   */
  getSafeData() {
    const { password_hash, email_verification_token, password_reset_token, ...safeData } = this;
    return safeData;
  }

  /**
   * Get public user data (for API responses)
   */
  getPublicData() {
    return {
      id: this.id,
      username: this.username,
      email: this.email,
      role: this.role,
      status: this.status,
      tpg_license_number: this.tpg_license_number,
      pharmacy_name: this.pharmacy_name,
      email_verified_at: this.email_verified_at,
      last_login: this.last_login,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  // Static methods

  /**
   * Find user by email
   */
  static async findByEmail(email) {
    return await this.query().findOne({ email: email.toLowerCase() });
  }

  /**
   * Find user by verification token
   */
  static async findByVerificationToken(token) {
    return await this.query().findOne({ email_verification_token: token });
  }

  /**
   * Find user by password reset token
   */
  static async findByPasswordResetToken(token) {
    return await this.query()
      .findOne({ password_reset_token: token })
      .where('password_reset_expires', '>', new Date().toISOString());
  }

  /**
   * Get users by role
   */
  static async findByRole(role) {
    return await this.query().where({ role });
  }

  /**
   * Get active users
   */
  static async getActiveUsers() {
    return await this.query().where({ status: 'active' });
  }

  /**
   * Get pending users (for admin approval)
   */
  static async getPendingUsers() {
    return await this.query().where({ status: 'pending' });
  }

  /**
   * Search users by name or email
   */
  static async search(query, limit = 50) {
    return await this.query()
      .where('username', 'ilike', `%${query}%`)
      .orWhere('email', 'ilike', `%${query}%`)
      .limit(limit);
  }
}

module.exports = User;