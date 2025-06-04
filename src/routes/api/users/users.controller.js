// src/routes/api/users/users.controller.js - TPG User Management Controller
const User = require('../../../models/User');
const authService = require('../../../services/authService');
const logger = require('../../../config/logger');
const { validateUserCreate, validateUserUpdate, validateUserRoleUpdate } = require('./users.validation');

class UsersController {
  /**
   * Get all users with filtering and pagination
   * GET /api/users
   * Permissions: users.view (admin+)
   */
  async getUsers(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        role,
        status,
        search,
        sortBy = 'created_at',
        sortOrder = 'desc'
      } = req.query;

      // Build query with filters
      let query = User.query();

      // Search functionality
      if (search) {
        query = query.where(builder => {
          builder
            .where('username', 'ilike', `%${search}%`)
            .orWhere('email', 'ilike', `%${search}%`)
            .orWhere('pharmacy_name', 'ilike', `%${search}%`)
            .orWhere('tpg_license_number', 'ilike', `%${search}%`);
        });
      }

      // Role filter
      if (role && ['user', 'admin', 'super_admin'].includes(role)) {
        query = query.where('role', role);
      }

      // Status filter
      if (status && ['active', 'pending', 'suspended', 'locked'].includes(status)) {
        query = query.where('status', status);
      }

      // Sorting
      const validSortFields = ['created_at', 'updated_at', 'username', 'email', 'role', 'status', 'last_login'];
      if (validSortFields.includes(sortBy)) {
        query = query.orderBy(sortBy, sortOrder === 'asc' ? 'asc' : 'desc');
      }

      // Pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const totalQuery = query.clone().count();
      
      const [users, [{ count: total }]] = await Promise.all([
        query.offset(offset).limit(parseInt(limit)),
        totalQuery
      ]);

      // Remove sensitive data
      const safeUsers = users.map(user => user.getPublicData());

      // Log admin access
      logger.security.logDataAccess(
        req.user.id,
        'list',
        'users',
        'all',
        req.ip
      );

      res.json({
        success: true,
        users: safeUsers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit)
        },
        filters: { role, status, search, sortBy, sortOrder }
      });
    } catch (error) {
      logger.error('Get users error:', error);
      res.status(500).json({
        error: 'Failed to retrieve users',
        message: 'An error occurred while fetching users'
      });
    }
  }

  /**
   * Get single user by ID
   * GET /api/users/:id
   * Permissions: users.view (admin+) or own profile
   */
  async getUser(req, res) {
    try {
      const { id } = req.params;
      const requestingUser = req.user;

      // Check if user is accessing their own profile
      const isOwnProfile = requestingUser.id === id;
      
      // Non-admins can only access their own profile
      if (!isOwnProfile && !requestingUser.hasPermission('users.view')) {
        logger.security.logPermissionDenied(
          requestingUser.id,
          'users.view',
          `user_${id}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only access your own profile'
        });
      }

      const user = await User.query()
        .findById(id)
        .withGraphFetched('[tickets(orderByCreated), assignedTickets(orderByCreated)]')
        .modifiers({
          orderByCreated: builder => builder.orderBy('created_at', 'desc').limit(10)
        });

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The requested user does not exist'
        });
      }

      // For own profile, get full safe data. For admin viewing others, get public data
      const userData = isOwnProfile ? user.getSafeData() : user.getPublicData();

      // Add statistics for admins or own profile
      const statistics = {
        total_tickets: user.tickets?.length || 0,
        assigned_tickets: user.assignedTickets?.length || 0,
        account_age_days: Math.floor((new Date() - new Date(user.created_at)) / (1000 * 60 * 60 * 24))
      };

      // Log access
      logger.security.logDataAccess(
        requestingUser.id,
        'view',
        'user',
        id,
        req.ip
      );

      res.json({
        success: true,
        user: userData,
        statistics,
        recent_tickets: user.tickets?.slice(0, 5) || [],
        recent_assigned: user.assignedTickets?.slice(0, 5) || []
      });
    } catch (error) {
      logger.error('Get user error:', error);
      res.status(500).json({
        error: 'Failed to retrieve user',
        message: 'An error occurred while fetching user details'
      });
    }
  }

  /**
   * Create new user (Admin only)
   * POST /api/users
   * Permissions: users.create (admin+)
   */
  async createUser(req, res) {
    try {
      // Validate input
      const { error, value } = validateUserCreate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const {
        username,
        email,
        password,
        role = 'user',
        tpg_license_number,
        pharmacy_name,
        phone_number,
        address,
        status = 'pending'
      } = value;

      // Only super_admin can create admin or super_admin users
      if ((role === 'admin' || role === 'super_admin') && req.user.role !== 'super_admin') {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'Only super administrators can create admin users'
        });
      }

      // Check if user already exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({
          error: 'User already exists',
          message: 'A user with this email address already exists'
        });
      }

      // Validate TPG email domain
      if (!authService.isValidTPGEmail(email)) {
        return res.status(400).json({
          error: 'Invalid email domain',
          message: 'Only @tpg.gov.gh email addresses are allowed'
        });
      }

      // Create user
      const user = await User.query().insert({
        username,
        email: email.toLowerCase(),
        password, // Will be hashed in $beforeInsert
        role,
        status,
        tpg_license_number,
        pharmacy_name,
        phone_number,
        address
      });

      // Generate email verification token
      const verificationToken = await user.generateEmailVerificationToken();

      // Log admin action
      logger.security.logAdminAction(
        req.user.id,
        'user_created',
        user.id,
        {
          email: user.email,
          role: user.role,
          status: user.status
        },
        req.ip
      );

      // TODO: Send welcome email with verification token
      // await emailService.sendWelcomeEmail(user, verificationToken);

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        user: user.getPublicData(),
        verification_required: true
      });
    } catch (error) {
      logger.error('Create user error:', error);
      res.status(500).json({
        error: 'User creation failed',
        message: 'An error occurred while creating the user'
      });
    }
  }

  /**
   * Update user profile
   * PUT /api/users/:id
   * Permissions: users.edit (admin+) or own profile (limited fields)
   */
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const requestingUser = req.user;

      // Validate input
      const { error, value } = validateUserUpdate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      // Check if user exists
      const user = await User.query().findById(id);
      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The requested user does not exist'
        });
      }

      const isOwnProfile = requestingUser.id === id;
      const canEditOthers = requestingUser.hasPermission('users.edit');

      // Check permissions
      if (!isOwnProfile && !canEditOthers) {
        logger.security.logPermissionDenied(
          requestingUser.id,
          'users.edit',
          `user_${id}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only edit your own profile'
        });
      }

      // Define allowed fields based on permissions
      let allowedFields;
      if (isOwnProfile) {
        // Own profile - can edit personal info but not role/status
        allowedFields = [
          'username',
          'phone_number',
          'address',
          'pharmacy_name',
          'preferences'
        ];
      } else if (requestingUser.role === 'super_admin') {
        // Super admin can edit all fields
        allowedFields = [
          'username',
          'email',
          'role',
          'status',
          'tpg_license_number',
          'pharmacy_name',
          'phone_number',
          'address',
          'preferences'
        ];
      } else {
        // Regular admin - can edit most fields except role
        allowedFields = [
          'username',
          'status',
          'tpg_license_number',
          'pharmacy_name',
          'phone_number',
          'address'
        ];
      }

      // Filter updates to only allowed fields
      const updates = {};
      for (const field of allowedFields) {
        if (value[field] !== undefined) {
          updates[field] = value[field];
        }
      }

      // Special validation for role changes
      if (updates.role && updates.role !== user.role) {
        if (requestingUser.role !== 'super_admin') {
          return res.status(403).json({
            error: 'Insufficient permissions',
            message: 'Only super administrators can change user roles'
          });
        }

        // Log role change
        logger.security.logAdminAction(
          requestingUser.id,
          'role_changed',
          user.id,
          {
            old_role: user.role,
            new_role: updates.role,
            user_email: user.email
          },
          req.ip
        );
      }

      // Validate email domain if email is being updated
      if (updates.email && !authService.isValidTPGEmail(updates.email)) {
        return res.status(400).json({
          error: 'Invalid email domain',
          message: 'Only @tpg.gov.gh email addresses are allowed'
        });
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          error: 'No valid updates provided',
          message: 'Please provide valid fields to update'
        });
      }

      // Update user
      const updatedUser = await user.$query().patchAndFetch(updates);

      // Log the update
      logger.security.logDataAccess(
        requestingUser.id,
        'update',
        'user',
        id,
        req.ip
      );

      res.json({
        success: true,
        message: 'User updated successfully',
        user: updatedUser.getPublicData()
      });
    } catch (error) {
      logger.error('Update user error:', error);
      res.status(500).json({
        error: 'User update failed',
        message: 'An error occurred while updating the user'
      });
    }
  }

  /**
   * Update user role (Super Admin only)
   * PUT /api/users/:id/role
   * Permissions: users.role.edit (super_admin only)
   */
  async updateUserRole(req, res) {
    try {
      const { id } = req.params;
      const { role } = req.body;

      // Validate input
      const { error, value } = validateUserRoleUpdate({ role });
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      // Only super admin can change roles
      if (req.user.role !== 'super_admin') {
        logger.security.logPermissionDenied(
          req.user.id,
          'users.role.edit',
          `user_${id}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'Only super administrators can change user roles'
        });
      }

      // Prevent self-demotion
      if (req.user.id === id && value.role !== 'super_admin') {
        return res.status(400).json({
          error: 'Invalid operation',
          message: 'You cannot change your own role'
        });
      }

      // Check if user exists
      const user = await User.query().findById(id);
      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The requested user does not exist'
        });
      }

      const oldRole = user.role;
      
      // Update role
      const updatedUser = await user.$query().patchAndFetch({
        role: value.role
      });

      // Log role change
      logger.security.logAdminAction(
        req.user.id,
        'role_changed',
        user.id,
        {
          old_role: oldRole,
          new_role: value.role,
          user_email: user.email
        },
        req.ip
      );

      res.json({
        success: true,
        message: 'User role updated successfully',
        user: updatedUser.getPublicData(),
        role_change: {
          from: oldRole,
          to: value.role
        }
      });
    } catch (error) {
      logger.error('Update user role error:', error);
      res.status(500).json({
        error: 'Role update failed',
        message: 'An error occurred while updating the user role'
      });
    }
  }

  /**
   * Deactivate/Suspend user (Admin only)
   * DELETE /api/users/:id
   * Permissions: users.delete (admin+)
   */
  async deactivateUser(req, res) {
    try {
      const { id } = req.params;
      const { reason = 'Administrative action' } = req.body;

      // Prevent self-deactivation
      if (req.user.id === id) {
        return res.status(400).json({
          error: 'Invalid operation',
          message: 'You cannot deactivate your own account'
        });
      }

      // Check if user exists
      const user = await User.query().findById(id);
      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The requested user does not exist'
        });
      }

      // Prevent deactivating other super admins unless requester is super admin
      if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'Only super administrators can deactivate other super administrators'
        });
      }

      // Update user status to suspended
      const updatedUser = await user.$query().patchAndFetch({
        status: 'suspended'
      });

      // Log admin action
      logger.security.logAdminAction(
        req.user.id,
        'user_deactivated',
        user.id,
        {
          user_email: user.email,
          user_role: user.role,
          reason
        },
        req.ip
      );

      res.json({
        success: true,
        message: 'User deactivated successfully',
        user: updatedUser.getPublicData()
      });
    } catch (error) {
      logger.error('Deactivate user error:', error);
      res.status(500).json({
        error: 'User deactivation failed',
        message: 'An error occurred while deactivating the user'
      });
    }
  }

  /**
   * Reactivate suspended user (Admin only)
   * PUT /api/users/:id/reactivate
   * Permissions: users.edit (admin+)
   */
  async reactivateUser(req, res) {
    try {
      const { id } = req.params;

      // Check if user exists
      const user = await User.query().findById(id);
      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The requested user does not exist'
        });
      }

      if (user.status !== 'suspended') {
        return res.status(400).json({
          error: 'Invalid operation',
          message: 'User is not currently suspended'
        });
      }

      // Reactivate user
      const updatedUser = await user.$query().patchAndFetch({
        status: 'active',
        locked_until: null,
        failed_login_attempts: 0
      });

      // Log admin action
      logger.security.logAdminAction(
        req.user.id,
        'user_reactivated',
        user.id,
        {
          user_email: user.email,
          user_role: user.role
        },
        req.ip
      );

      res.json({
        success: true,
        message: 'User reactivated successfully',
        user: updatedUser.getPublicData()
      });
    } catch (error) {
      logger.error('Reactivate user error:', error);
      res.status(500).json({
        error: 'User reactivation failed',
        message: 'An error occurred while reactivating the user'
      });
    }
  }

  /**
   * Get pending users for approval (Admin only)
   * GET /api/users/pending
   * Permissions: users.view (admin+)
   */
  async getPendingUsers(req, res) {
    try {
      const pendingUsers = await User.query()
        .where('status', 'pending')
        .orderBy('created_at', 'desc');

      // Log admin access
      logger.security.logDataAccess(
        req.user.id,
        'list',
        'pending_users',
        'all',
        req.ip
      );

      res.json({
        success: true,
        users: pendingUsers.map(user => user.getPublicData()),
        count: pendingUsers.length
      });
    } catch (error) {
      logger.error('Get pending users error:', error);
      res.status(500).json({
        error: 'Failed to retrieve pending users',
        message: 'An error occurred while fetching pending users'
      });
    }
  }

  /**
   * Approve pending user (Admin only)
   * PUT /api/users/:id/approve
   * Permissions: users.approve (admin+)
   */
  async approveUser(req, res) {
    try {
      const { id } = req.params;

      // Check if user exists
      const user = await User.query().findById(id);
      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The requested user does not exist'
        });
      }

      if (user.status !== 'pending') {
        return res.status(400).json({
          error: 'Invalid operation',
          message: 'User is not pending approval'
        });
      }

      // Approve user
      const updatedUser = await user.$query().patchAndFetch({
        status: 'active'
      });

      // Log admin action
      logger.security.logAdminAction(
        req.user.id,
        'user_approved',
        user.id,
        {
          user_email: user.email,
          approved_by: req.user.email
        },
        req.ip
      );

      // TODO: Send approval email notification
      // await emailService.sendApprovalEmail(user);

      res.json({
        success: true,
        message: 'User approved successfully',
        user: updatedUser.getPublicData()
      });
    } catch (error) {
      logger.error('Approve user error:', error);
      res.status(500).json({
        error: 'User approval failed',
        message: 'An error occurred while approving the user'
      });
    }
  }

  /**
   * Get user permissions
   * GET /api/users/:id/permissions
   * Permissions: users.view (admin+) or own profile
   */
  async getUserPermissions(req, res) {
    try {
      const { id } = req.params;
      const requestingUser = req.user;

      // Check if user is accessing their own permissions
      const isOwnProfile = requestingUser.id === id;
      
      // Non-admins can only access their own permissions
      if (!isOwnProfile && !requestingUser.hasPermission('users.view')) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only access your own permissions'
        });
      }

      // Check if user exists
      const user = await User.query().findById(id);
      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The requested user does not exist'
        });
      }

      const permissions = authService.getRolePermissions(user.role);

      res.json({
        success: true,
        user_id: user.id,
        role: user.role,
        permissions,
        permission_count: permissions.length
      });
    } catch (error) {
      logger.error('Get user permissions error:', error);
      res.status(500).json({
        error: 'Failed to retrieve permissions',
        message: 'An error occurred while fetching user permissions'
      });
    }
  }

  /**
   * Search users (Admin only)
   * GET /api/users/search?q=query
   * Permissions: users.view (admin+)
   */
  async searchUsers(req, res) {
    try {
      const { q: query, limit = 10 } = req.query;

      if (!query || query.length < 2) {
        return res.status(400).json({
          error: 'Invalid search query',
          message: 'Search query must be at least 2 characters long'
        });
      }

      const users = await User.search(query, parseInt(limit));

      // Log search action
      logger.security.logDataAccess(
        req.user.id,
        'search',
        'users',
        query,
        req.ip
      );

      res.json({
        success: true,
        query,
        users: users.map(user => user.getPublicData()),
        count: users.length
      });
    } catch (error) {
      logger.error('Search users error:', error);
      res.status(500).json({
        error: 'Search failed',
        message: 'An error occurred while searching users'
      });
    }
  }
}

module.exports = new UsersController();