// src/routes/api/users/users.validation.js - TPG User Management Validation
const Joi = require('joi');

/**
 * Validation schema for user creation
 */
const validateUserCreate = (data) => {
  const schema = Joi.object({
    username: Joi.string()
      .trim()
      .min(2)
      .max(255)
      .required()
      .messages({
        'string.empty': 'Username is required',
        'string.min': 'Username must be at least 2 characters long',
        'string.max': 'Username cannot exceed 255 characters'
      }),

    email: Joi.string()
      .email()
      .lowercase()
      .pattern(/^[a-zA-Z0-9._%+-]+@tpg\.gov\.gh$/)
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'string.pattern.base': 'Email must be a valid @tpg.gov.gh address',
        'string.empty': 'Email is required'
      }),

    password: Joi.string()
      .min(8)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'string.max': 'Password cannot exceed 128 characters',
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        'string.empty': 'Password is required'
      }),

    role: Joi.string()
      .valid('user', 'admin', 'super_admin')
      .default('user')
      .messages({
        'any.only': 'Role must be one of: user, admin, super_admin'
      }),

    status: Joi.string()
      .valid('active', 'pending', 'suspended')
      .default('pending')
      .messages({
        'any.only': 'Status must be one of: active, pending, suspended'
      }),

    tpg_license_number: Joi.string()
      .trim()
      .max(50)
      .allow(null, '')
      .messages({
        'string.max': 'TPG license number cannot exceed 50 characters'
      }),

    pharmacy_name: Joi.string()
      .trim()
      .max(255)
      .allow(null, '')
      .messages({
        'string.max': 'Pharmacy name cannot exceed 255 characters'
      }),

    phone_number: Joi.string()
      .trim()
      .pattern(/^\+?[1-9]\d{1,14}$/)
      .allow(null, '')
      .messages({
        'string.pattern.base': 'Please provide a valid phone number'
      }),

    address: Joi.string()
      .trim()
      .max(1000)
      .allow(null, '')
      .messages({
        'string.max': 'Address cannot exceed 1000 characters'
      }),

    preferences: Joi.object({
      email_notifications: Joi.boolean().default(true),
      dashboard_layout: Joi.string().valid('default', 'compact', 'expanded').default('default'),
      theme: Joi.string().valid('light', 'dark', 'auto').default('light'),
      language: Joi.string().valid('en', 'tw').default('en')
    }).default({})
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for user updates
 */
const validateUserUpdate = (data) => {
  const schema = Joi.object({
    username: Joi.string()
      .trim()
      .min(2)
      .max(255)
      .messages({
        'string.min': 'Username must be at least 2 characters long',
        'string.max': 'Username cannot exceed 255 characters'
      }),

    email: Joi.string()
      .email()
      .lowercase()
      .pattern(/^[a-zA-Z0-9._%+-]+@tpg\.gov\.gh$/)
      .messages({
        'string.email': 'Please provide a valid email address',
        'string.pattern.base': 'Email must be a valid @tpg.gov.gh address'
      }),

    role: Joi.string()
      .valid('user', 'admin', 'super_admin')
      .messages({
        'any.only': 'Role must be one of: user, admin, super_admin'
      }),

    status: Joi.string()
      .valid('active', 'pending', 'suspended', 'locked')
      .messages({
        'any.only': 'Status must be one of: active, pending, suspended, locked'
      }),

    tpg_license_number: Joi.string()
      .trim()
      .max(50)
      .allow(null, '')
      .messages({
        'string.max': 'TPG license number cannot exceed 50 characters'
      }),

    pharmacy_name: Joi.string()
      .trim()
      .max(255)
      .allow(null, '')
      .messages({
        'string.max': 'Pharmacy name cannot exceed 255 characters'
      }),

    phone_number: Joi.string()
      .trim()
      .pattern(/^\+?[1-9]\d{1,14}$/)
      .allow(null, '')
      .messages({
        'string.pattern.base': 'Please provide a valid phone number'
      }),

    address: Joi.string()
      .trim()
      .max(1000)
      .allow(null, '')
      .messages({
        'string.max': 'Address cannot exceed 1000 characters'
      }),

    preferences: Joi.object({
      email_notifications: Joi.boolean(),
      dashboard_layout: Joi.string().valid('default', 'compact', 'expanded'),
      theme: Joi.string().valid('light', 'dark', 'auto'),
      language: Joi.string().valid('en', 'tw'),
      notification_frequency: Joi.string().valid('immediate', 'daily', 'weekly', 'none').default('immediate'),
      timezone: Joi.string().default('Africa/Accra')
    })
  }).min(1); // At least one field must be provided for update

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for role updates
 */
const validateUserRoleUpdate = (data) => {
  const schema = Joi.object({
    role: Joi.string()
      .valid('user', 'admin', 'super_admin')
      .required()
      .messages({
        'any.only': 'Role must be one of: user, admin, super_admin',
        'any.required': 'Role is required'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for bulk operations
 */
const validateBulkOperation = (data) => {
  const schema = Joi.object({
    user_ids: Joi.array()
      .items(Joi.string().uuid())
      .min(1)
      .max(50)
      .required()
      .messages({
        'array.min': 'At least one user ID is required',
        'array.max': 'Cannot process more than 50 users at once',
        'any.required': 'User IDs are required'
      }),

    action: Joi.string()
      .valid('activate', 'suspend', 'delete', 'approve')
      .required()
      .messages({
        'any.only': 'Action must be one of: activate, suspend, delete, approve',
        'any.required': 'Action is required'
      }),

    reason: Joi.string()
      .trim()
      .max(500)
      .allow('')
      .messages({
        'string.max': 'Reason cannot exceed 500 characters'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for password reset by admin
 */
const validatePasswordReset = (data) => {
  const schema = Joi.object({
    new_password: Joi.string()
      .min(8)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'string.max': 'Password cannot exceed 128 characters',
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        'string.empty': 'New password is required'
      }),

    force_change: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Force change must be a boolean value'
      }),

    reason: Joi.string()
      .trim()
      .max(500)
      .allow('')
      .messages({
        'string.max': 'Reason cannot exceed 500 characters'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for user search
 */
const validateUserSearch = (data) => {
  const schema = Joi.object({
    q: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .required()
      .messages({
        'string.min': 'Search query must be at least 2 characters long',
        'string.max': 'Search query cannot exceed 100 characters',
        'string.empty': 'Search query is required'
      }),

    limit: Joi.number()
      .integer()
      .min(1)
      .max(50)
      .default(10)
      .messages({
        'number.min': 'Limit must be at least 1',
        'number.max': 'Limit cannot exceed 50',
        'number.integer': 'Limit must be an integer'
      }),

    role: Joi.string()
      .valid('user', 'admin', 'super_admin')
      .messages({
        'any.only': 'Role filter must be one of: user, admin, super_admin'
      }),

    status: Joi.string()
      .valid('active', 'pending', 'suspended', 'locked')
      .messages({
        'any.only': 'Status filter must be one of: active, pending, suspended, locked'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for user listing with filters
 */
const validateUserList = (data) => {
  const schema = Joi.object({
    page: Joi.number()
      .integer()
      .min(1)
      .default(1)
      .messages({
        'number.min': 'Page must be at least 1',
        'number.integer': 'Page must be an integer'
      }),

    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(20)
      .messages({
        'number.min': 'Limit must be at least 1',
        'number.max': 'Limit cannot exceed 100',
        'number.integer': 'Limit must be an integer'
      }),

    role: Joi.string()
      .valid('user', 'admin', 'super_admin')
      .messages({
        'any.only': 'Role filter must be one of: user, admin, super_admin'
      }),

    status: Joi.string()
      .valid('active', 'pending', 'suspended', 'locked')
      .messages({
        'any.only': 'Status filter must be one of: active, pending, suspended, locked'
      }),

    search: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .messages({
        'string.min': 'Search term must be at least 2 characters long',
        'string.max': 'Search term cannot exceed 100 characters'
      }),

    sortBy: Joi.string()
      .valid('created_at', 'updated_at', 'username', 'email', 'role', 'status', 'last_login')
      .default('created_at')
      .messages({
        'any.only': 'Sort field must be one of: created_at, updated_at, username, email, role, status, last_login'
      }),

    sortOrder: Joi.string()
      .valid('asc', 'desc')
      .default('desc')
      .messages({
        'any.only': 'Sort order must be either asc or desc'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

module.exports = {
  validateUserCreate,
  validateUserUpdate,
  validateUserRoleUpdate,
  validateBulkOperation,
  validatePasswordReset,
  validateUserSearch,
  validateUserList
};