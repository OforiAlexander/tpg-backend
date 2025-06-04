// src/routes/api/users/users.routes.js - TPG User Management Routes
const express = require('express');
const router = express.Router();

// Import middleware
const { 
  authenticate, 
  requireRole, 
  requirePermission, 
  requireOwnership,
  authRateLimit 
} = require('../../../middleware/auth');
const { apiRateLimit } = require('../../../middleware/security');
const { auditUserAction } = require('../../../middleware/audit');

// Import controller
const usersController = require('./users.controller');

// Apply authentication to all routes
router.use(authenticate);

// Apply rate limiting
router.use(apiRateLimit);

/**
 * User listing and search routes
 */

// GET /api/users - List users with filtering and pagination (Admin+)
router.get('/', 
  requirePermission('users.view'),
  auditUserAction('list'),
  usersController.getUsers
);

// GET /api/users/pending - Get pending users for approval (Admin+)
router.get('/pending',
  requirePermission('users.view'),
  auditUserAction('list_pending'),
  usersController.getPendingUsers
);

// GET /api/users/search - Search users (Admin+)
router.get('/search',
  requirePermission('users.view'),
  auditUserAction('search'),
  usersController.searchUsers
);

/**
 * Individual user routes
 */

// GET /api/users/:id - Get user profile (Admin+ or own profile)
router.get('/:id',
  auditUserAction('view'),
  usersController.getUser
);

// GET /api/users/:id/permissions - Get user permissions (Admin+ or own profile)
router.get('/:id/permissions',
  auditUserAction('view_permissions'),
  usersController.getUserPermissions
);

/**
 * User management routes (Admin+)
 */

// POST /api/users - Create new user (Admin+)
router.post('/',
  requirePermission('users.create'),
  authRateLimit, // Additional rate limiting for user creation
  auditUserAction('create'),
  usersController.createUser
);

// PUT /api/users/:id - Update user profile (Admin+ or own profile with restrictions)
router.put('/:id',
  auditUserAction('update'),
  usersController.updateUser
);

// DELETE /api/users/:id - Deactivate/Suspend user (Admin+)
router.delete('/:id',
  requirePermission('users.delete'),
  auditUserAction('deactivate'),
  usersController.deactivateUser
);

/**
 * Special user action routes
 */

// PUT /api/users/:id/role - Update user role (Super Admin only)
router.put('/:id/role',
  requireRole('super_admin'),
  auditUserAction('role_change'),
  usersController.updateUserRole
);

// PUT /api/users/:id/approve - Approve pending user (Admin+)
router.put('/:id/approve',
  requirePermission('users.approve'),
  auditUserAction('approve'),
  usersController.approveUser
);

// PUT /api/users/:id/reactivate - Reactivate suspended user (Admin+)
router.put('/:id/reactivate',
  requirePermission('users.edit'),
  auditUserAction('reactivate'),
  usersController.reactivateUser
);

/**
 * Bulk operations routes (Future enhancement)
 */

// POST /api/users/bulk - Bulk user operations (Super Admin only)
// router.post('/bulk',
//   requireRole('super_admin'),
//   auditUserAction('bulk_operation'),
//   usersController.bulkUserOperation
// );

/**
 * Administrative routes
 */

// PUT /api/users/:id/reset-password - Admin password reset (Super Admin only)
// router.put('/:id/reset-password',
//   requireRole('super_admin'),
//   auditUserAction('admin_password_reset'),
//   usersController.adminPasswordReset
// );

// GET /api/users/:id/activity - Get user activity log (Admin+)
// router.get('/:id/activity',
//   requirePermission('users.view'),
//   auditUserAction('view_activity'),
//   usersController.getUserActivity
// );

/**
 * Route-specific error handling middleware
 */
router.use((error, req, res, next) => {
  // Log user management specific errors
  req.logger.error('Users API Error:', {
    error: error.message,
    stack: error.stack,
    user_id: req.user?.id,
    route: req.route?.path,
    method: req.method
  });

  // Handle specific validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: error.message,
      details: error.details
    });
  }

  // Handle permission errors
  if (error.message?.includes('permission')) {
    return res.status(403).json({
      error: 'Access Denied',
      message: 'You do not have permission to perform this action'
    });
  }

  // Handle user not found errors
  if (error.message?.includes('not found')) {
    return res.status(404).json({
      error: 'User Not Found',
      message: 'The requested user does not exist'
    });
  }

  // Pass to global error handler
  next(error);
});

module.exports = router;