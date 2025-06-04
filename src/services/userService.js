// src/services/userService.js - TPG User Management Service
const User = require('../models/User');
const logger = require('../config/logger');
const authService = require('./authService');

class UserService {
  /**
   * Get users with advanced filtering and pagination
   */
  async getUsers(filters = {}, pagination = {}) {
    try {
      const {
        role,
        status,
        search,
        sortBy = 'created_at',
        sortOrder = 'desc',
        includeInactive = false
      } = filters;

      const {
        page = 1,
        limit = 20
      } = pagination;

      let query = User.query();

      // Apply search filter
      if (search) {
        query = query.where(builder => {
          builder
            .where('username', 'ilike', `%${search}%`)
            .orWhere('email', 'ilike', `%${search}%`)
            .orWhere('pharmacy_name', 'ilike', `%${search}%`)
            .orWhere('tpg_license_number', 'ilike', `%${search}%`);
        });
      }

      // Apply role filter
      if (role) {
        query = query.where('role', role);
      }

      // Apply status filter
      if (status) {
        query = query.where('status', status);
      } else if (!includeInactive) {
        // By default, exclude suspended users unless explicitly requested
        query = query.whereNot('status', 'suspended');
      }

      // Apply sorting
      const validSortFields = [
        'created_at', 'updated_at', 'username', 'email', 'role', 
        'status', 'last_login', 'pharmacy_name', 'tpg_license_number'
      ];
      
      if (validSortFields.includes(sortBy)) {
        query = query.orderBy(sortBy, sortOrder === 'asc' ? 'asc' : 'desc');
      }

      // Get total count for pagination
      const totalQuery = query.clone().count();
      
      // Apply pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      query = query.offset(offset).limit(parseInt(limit));

      const [users, [{ count: total }]] = await Promise.all([
        query,
        totalQuery
      ]);

      return {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('UserService.getUsers error:', error);
      throw error;
    }
  }

  /**
   * Get user by ID with optional relations
   */
  async getUserById(id, options = {}) {
    try {
      const { includeRelations = false, includeStats = false } = options;

      let query = User.query().findById(id);

      if (includeRelations) {
        query = query.withGraphFetched(`[
          tickets(orderByCreated).[category, comments(latest)],
          assignedTickets(orderByCreated).[category, comments(latest)]
        ]`).modifiers({
          orderByCreated: builder => builder.orderBy('created_at', 'desc').limit(10),
          latest: builder => builder.orderBy('created_at', 'desc').limit(1)
        });
      }

      const user = await query;

      if (!user) {
        throw new Error('User not found');
      }

      let result = { user };

      if (includeStats) {
        result.statistics = await this.getUserStatistics(id);
      }

      return result;
    } catch (error) {
      logger.error('UserService.getUserById error:', error);
      throw error;
    }
  }

  /**
   * Create new user with validation
   */
  async createUser(userData, createdBy) {
    try {
      // Validate TPG email domain
      if (!authService.isValidTPGEmail(userData.email)) {
        throw new Error('Only @tpg.gov.gh email addresses are allowed');
      }

      // Check if user already exists
      const existingUser = await User.findByEmail(userData.email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Create user
      const user = await User.query().insert({
        username: userData.username,
        email: userData.email.toLowerCase(),
        password: userData.password, // Will be hashed in $beforeInsert
        role: userData.role || 'user',
        status: userData.status || 'pending',
        tpg_license_number: userData.tpg_license_number,
        pharmacy_name: userData.pharmacy_name,
        phone_number: userData.phone_number,
        address: userData.address,
        preferences: userData.preferences || {}
      });

      // Generate email verification token
      const verificationToken = await user.generateEmailVerificationToken();

      // Log creation
      logger.security.logAdminAction(
        createdBy,
        'user_created',
        user.id,
        {
          email: user.email,
          role: user.role,
          status: user.status
        },
        null
      );

      return { user, verificationToken };
    } catch (error) {
      logger.error('UserService.createUser error:', error);
      throw error;
    }
  }

  /**
   * Update user with field-level permissions
   */
  async updateUser(id, updates, updatedBy) {
    try {
      const user = await User.query().findById(id);
      if (!user) {
        throw new Error('User not found');
      }

      // Store old values for audit
      const oldValues = {
        role: user.role,
        status: user.status,
        email: user.email
      };

      // Update user
      const updatedUser = await user.$query().patchAndFetch(updates);

      // Log significant changes
      if (updates.role && updates.role !== oldValues.role) {
        logger.security.logAdminAction(
          updatedBy,
          'role_changed',
          user.id,
          {
            old_role: oldValues.role,
            new_role: updates.role,
            user_email: user.email
          },
          null
        );
      }

      if (updates.status && updates.status !== oldValues.status) {
        logger.security.logAdminAction(
          updatedBy,
          'status_changed',
          user.id,
          {
            old_status: oldValues.status,
            new_status: updates.status,
            user_email: user.email
          },
          null
        );
      }

      return updatedUser;
    } catch (error) {
      logger.error('UserService.updateUser error:', error);
      throw error;
    }
  }

  /**
   * Get user statistics
   */
  async getUserStatistics(userId) {
    try {
      const user = await User.query()
        .findById(userId)
        .withGraphFetched('[tickets, assignedTickets]');

      if (!user) {
        throw new Error('User not found');
      }

      const tickets = user.tickets || [];
      const assignedTickets = user.assignedTickets || [];

      // Calculate ticket statistics
      const ticketStats = {
        total: tickets.length,
        open: tickets.filter(t => t.status === 'open').length,
        in_progress: tickets.filter(t => t.status === 'in-progress').length,
        resolved: tickets.filter(t => t.status === 'resolved').length,
        closed: tickets.filter(t => t.status === 'closed').length
      };

      // Calculate assigned ticket statistics (for admins)
      const assignedStats = {
        total: assignedTickets.length,
        open: assignedTickets.filter(t => t.status === 'open').length,
        in_progress: assignedTickets.filter(t => t.status === 'in-progress').length,
        resolved: assignedTickets.filter(t => t.status === 'resolved').length,
        closed: assignedTickets.filter(t => t.status === 'closed').length
      };

      // Calculate account age
      const accountAgeDays = Math.floor(
        (new Date() - new Date(user.created_at)) / (1000 * 60 * 60 * 24)
      );

      // Calculate activity metrics
      const lastLoginDays = user.last_login 
        ? Math.floor((new Date() - new Date(user.last_login)) / (1000 * 60 * 60 * 24))
        : null;

      return {
        tickets: ticketStats,
        assigned_tickets: assignedStats,
        account_age_days: accountAgeDays,
        last_login_days: lastLoginDays,
        email_verified: !!user.email_verified_at,
        failed_login_attempts: user.failed_login_attempts,
        is_locked: user.isLocked()
      };
    } catch (error) {
      logger.error('UserService.getUserStatistics error:', error);
      throw error;
    }
  }

  /**
   * Get pending users for approval
   */
  async getPendingUsers() {
    try {
      const users = await User.query()
        .where('status', 'pending')
        .orderBy('created_at', 'desc');

      return users;
    } catch (error) {
      logger.error('UserService.getPendingUsers error:', error);
      throw error;
    }
  }

  /**
   * Approve pending user
   */
  async approveUser(id, approvedBy) {
    try {
      const user = await User.query().findById(id);
      if (!user) {
        throw new Error('User not found');
      }

      if (user.status !== 'pending') {
        throw new Error('User is not pending approval');
      }

      const updatedUser = await user.$query().patchAndFetch({
        status: 'active'
      });

      // Log approval
      logger.security.logAdminAction(
        approvedBy,
        'user_approved',
        user.id,
        {
          user_email: user.email,
          approved_by_id: approvedBy
        },
        null
      );

      return updatedUser;
    } catch (error) {
      logger.error('UserService.approveUser error:', error);
      throw error;
    }
  }

  /**
   * Suspend user account
   */
  async suspendUser(id, reason, suspendedBy) {
    try {
      const user = await User.query().findById(id);
      if (!user) {
        throw new Error('User not found');
      }

      if (user.status === 'suspended') {
        throw new Error('User is already suspended');
      }

      const updatedUser = await user.$query().patchAndFetch({
        status: 'suspended'
      });

      // Log suspension
      logger.security.logAdminAction(
        suspendedBy,
        'user_suspended',
        user.id,
        {
          user_email: user.email,
          reason,
          suspended_by_id: suspendedBy
        },
        null
      );

      return updatedUser;
    } catch (error) {
      logger.error('UserService.suspendUser error:', error);
      throw error;
    }
  }

  /**
   * Reactivate suspended user
   */
  async reactivateUser(id, reactivatedBy) {
    try {
      const user = await User.query().findById(id);
      if (!user) {
        throw new Error('User not found');
      }

      if (user.status !== 'suspended') {
        throw new Error('User is not currently suspended');
      }

      const updatedUser = await user.$query().patchAndFetch({
        status: 'active',
        locked_until: null,
        failed_login_attempts: 0
      });

      // Log reactivation
      logger.security.logAdminAction(
        reactivatedBy,
        'user_reactivated',
        user.id,
        {
          user_email: user.email,
          reactivated_by_id: reactivatedBy
        },
        null
      );

      return updatedUser;
    } catch (error) {
      logger.error('UserService.reactivateUser error:', error);
      throw error;
    }
  }

  /**
   * Search users
   */
  async searchUsers(query, limit = 10, filters = {}) {
    try {
      if (!query || query.length < 2) {
        throw new Error('Search query must be at least 2 characters long');
      }

      let searchQuery = User.query()
        .where(builder => {
          builder
            .where('username', 'ilike', `%${query}%`)
            .orWhere('email', 'ilike', `%${query}%`)
            .orWhere('pharmacy_name', 'ilike', `%${query}%`)
            .orWhere('tpg_license_number', 'ilike', `%${query}%`);
        })
        .limit(parseInt(limit));

      // Apply additional filters
      if (filters.role) {
        searchQuery = searchQuery.where('role', filters.role);
      }

      if (filters.status) {
        searchQuery = searchQuery.where('status', filters.status);
      }

      const users = await searchQuery;
      return users;
    } catch (error) {
      logger.error('UserService.searchUsers error:', error);
      throw error;
    }
  }

  /**
   * Get user activity summary
   */
  async getUserActivity(userId, limit = 20) {
    try {
      // This would typically query an audit log table
      // For now, we'll return basic activity based on user data
      const user = await User.query()
        .findById(userId)
        .withGraphFetched('[tickets(recent), assignedTickets(recent)]')
        .modifiers({
          recent: builder => builder.orderBy('created_at', 'desc').limit(limit)
        });

      if (!user) {
        throw new Error('User not found');
      }

      const activity = [];

      // Add ticket creation activities
      user.tickets?.forEach(ticket => {
        activity.push({
          type: 'ticket_created',
          timestamp: ticket.created_at,
          details: {
            ticket_id: ticket.id,
            ticket_number: ticket.ticket_number,
            title: ticket.title,
            category: ticket.category
          }
        });
      });

      // Add ticket assignment activities (for admins)
      user.assignedTickets?.forEach(ticket => {
        activity.push({
          type: 'ticket_assigned',
          timestamp: ticket.created_at,
          details: {
            ticket_id: ticket.id,
            ticket_number: ticket.ticket_number,
            title: ticket.title,
            category: ticket.category
          }
        });
      });

      // Sort by timestamp (most recent first)
      activity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return activity.slice(0, limit);
    } catch (error) {
      logger.error('UserService.getUserActivity error:', error);
      throw error;
    }
  }

  /**
   * Validate user permissions for action
   */
  validateUserPermissions(user, action, targetUser = null) {
    // Check if user has the required permission
    if (!user.hasPermission(action)) {
      return false;
    }

    // Additional checks for specific actions
    if (targetUser) {
      // Prevent self-deactivation
      if (action.includes('delete') && user.id === targetUser.id) {
        return false;
      }

      // Only super_admin can modify other super_admins
      if (targetUser.role === 'super_admin' && user.role !== 'super_admin') {
        return false;
      }

      // Only super_admin can create/modify admin roles
      if (action.includes('role') && targetUser.role === 'admin' && user.role !== 'super_admin') {
        return false;
      }
    }

    return true;
  }
}

module.exports = new UserService();