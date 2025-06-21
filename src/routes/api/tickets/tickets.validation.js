// src/routes/api/tickets/tickets.validation.js - TPG Ticket Management Validation
const Joi = require('joi');

/**
 * Validation schema for ticket creation
 */
const validateTicketCreate = (data) => {
  const schema = Joi.object({
    title: Joi.string()
      .trim()
      .min(10)
      .max(500)
      .required()
      .messages({
        'string.empty': 'Title is required',
        'string.min': 'Title must be at least 10 characters long',
        'string.max': 'Title cannot exceed 500 characters'
      }),

    description: Joi.string()
      .trim()
      .min(20)
      .max(5000)
      .required()
      .messages({
        'string.empty': 'Description is required',
        'string.min': 'Description must be at least 20 characters long',
        'string.max': 'Description cannot exceed 5000 characters'
      }),

    category: Joi.string()
      .valid(
        'cpd-points',
        'license-management', 
        'performance-issues',
        'payment-gateway',
        'user-interface',
        'data-inconsistencies',
        'system-errors'
      )
      .required()
      .messages({
        'any.only': 'Please select a valid category',
        'any.required': 'Category is required'
      }),

    urgency: Joi.string()
      .valid('low', 'medium', 'high', 'critical')
      .default('medium')
      .messages({
        'any.only': 'Urgency must be one of: low, medium, high, critical'
      }),

    metadata: Joi.object({
      browser_info: Joi.string().max(500),
      screen_resolution: Joi.string().max(50),
      additional_context: Joi.string().max(1000),
      affected_urls: Joi.array().items(Joi.string().uri()).max(10),
      error_messages: Joi.array().items(Joi.string().max(500)).max(5),
      steps_to_reproduce: Joi.array().items(Joi.string().max(200)).max(10),
      expected_behavior: Joi.string().max(1000),
      actual_behavior: Joi.string().max(1000)
    }).default({})
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for ticket updates
 */
const validateTicketUpdate = (data) => {
  const schema = Joi.object({
    title: Joi.string()
      .trim()
      .min(10)
      .max(500)
      .messages({
        'string.min': 'Title must be at least 10 characters long',
        'string.max': 'Title cannot exceed 500 characters'
      }),

    description: Joi.string()
      .trim()
      .min(20)
      .max(5000)
      .messages({
        'string.min': 'Description must be at least 20 characters long',
        'string.max': 'Description cannot exceed 5000 characters'
      }),

    category: Joi.string()
      .valid(
        'cpd-points',
        'license-management', 
        'performance-issues',
        'payment-gateway',
        'user-interface',
        'data-inconsistencies',
        'system-errors'
      )
      .messages({
        'any.only': 'Please select a valid category'
      }),

    urgency: Joi.string()
      .valid('low', 'medium', 'high', 'critical')
      .messages({
        'any.only': 'Urgency must be one of: low, medium, high, critical'
      }),

    status: Joi.string()
      .valid('open', 'in-progress', 'resolved', 'closed')
      .messages({
        'any.only': 'Status must be one of: open, in-progress, resolved, closed'
      }),

    assigned_to: Joi.string()
      .uuid()
      .allow(null)
      .messages({
        'string.uuid': 'Assigned user must be a valid user ID'
      }),

    resolution_notes: Joi.string()
      .trim()
      .max(2000)
      .allow('')
      .messages({
        'string.max': 'Resolution notes cannot exceed 2000 characters'
      }),

    estimated_resolution_hours: Joi.number()
      .integer()
      .min(1)
      .max(720) // 30 days
      .messages({
        'number.min': 'Estimated resolution time must be at least 1 hour',
        'number.max': 'Estimated resolution time cannot exceed 720 hours (30 days)',
        'number.integer': 'Estimated resolution time must be a whole number'
      }),

    tags: Joi.array()
      .items(Joi.string().trim().min(2).max(50))
      .max(10)
      .messages({
        'array.max': 'Cannot have more than 10 tags',
        'string.min': 'Each tag must be at least 2 characters long',
        'string.max': 'Each tag cannot exceed 50 characters'
      }),

    metadata: Joi.object({
      browser_info: Joi.string().max(500),
      screen_resolution: Joi.string().max(50),
      additional_context: Joi.string().max(1000),
      affected_urls: Joi.array().items(Joi.string().uri()).max(10),
      error_messages: Joi.array().items(Joi.string().max(500)).max(5),
      steps_to_reproduce: Joi.array().items(Joi.string().max(200)).max(10),
      expected_behavior: Joi.string().max(1000),
      actual_behavior: Joi.string().max(1000)
    })
  }).min(1); // At least one field must be provided for update

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for ticket assignment
 */
const validateTicketAssign = (data) => {
  const schema = Joi.object({
    assigned_to: Joi.string()
      .uuid()
      .allow(null)
      .required()
      .messages({
        'string.uuid': 'Assigned user must be a valid user ID',
        'any.required': 'Assignment target is required (use null to unassign)'
      }),

    reason: Joi.string()
      .trim()
      .max(500)
      .allow('')
      .messages({
        'string.max': 'Assignment reason cannot exceed 500 characters'
      }),

    priority_change: Joi.string()
      .valid('low', 'medium', 'high', 'critical')
      .messages({
        'any.only': 'Priority must be one of: low, medium, high, critical'
      }),

    estimated_hours: Joi.number()
      .integer()
      .min(1)
      .max(720)
      .messages({
        'number.min': 'Estimated hours must be at least 1',
        'number.max': 'Estimated hours cannot exceed 720 (30 days)',
        'number.integer': 'Estimated hours must be a whole number'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for ticket status updates
 */
const validateTicketStatusUpdate = (data) => {
  const schema = Joi.object({
    status: Joi.string()
      .valid('open', 'in-progress', 'resolved', 'closed')
      .required()
      .messages({
        'any.only': 'Status must be one of: open, in-progress, resolved, closed',
        'any.required': 'Status is required'
      }),

    resolution_notes: Joi.string()
      .trim()
      .max(2000)
      .when('status', {
        is: 'resolved',
        then: Joi.required(),
        otherwise: Joi.optional()
      })
      .messages({
        'string.max': 'Resolution notes cannot exceed 2000 characters',
        'any.required': 'Resolution notes are required when resolving a ticket'
      }),

    satisfaction_rating: Joi.number()
      .integer()
      .min(1)
      .max(5)
      .when('status', {
        is: 'closed',
        then: Joi.optional(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'number.min': 'Satisfaction rating must be between 1 and 5',
        'number.max': 'Satisfaction rating must be between 1 and 5',
        'number.integer': 'Satisfaction rating must be a whole number',
        'any.forbidden': 'Satisfaction rating can only be provided when closing a ticket'
      }),

    satisfaction_comment: Joi.string()
      .trim()
      .max(1000)
      .allow('')
      .when('satisfaction_rating', {
        is: Joi.exist(),
        then: Joi.optional(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'string.max': 'Satisfaction comment cannot exceed 1000 characters',
        'any.forbidden': 'Satisfaction comment can only be provided with a satisfaction rating'
      }),

    reopen_reason: Joi.string()
      .trim()
      .max(500)
      .when('status', {
        is: Joi.valid('open', 'in-progress'),
        then: Joi.optional(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'string.max': 'Reopen reason cannot exceed 500 characters',
        'any.forbidden': 'Reopen reason can only be provided when reopening a ticket'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for ticket search and filtering
 */
const validateTicketSearch = (data) => {
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

    search: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .messages({
        'string.min': 'Search term must be at least 2 characters long',
        'string.max': 'Search term cannot exceed 100 characters'
      }),

    status: Joi.alternatives().try(
      Joi.string().valid('open', 'in-progress', 'resolved', 'closed'),
      Joi.array().items(Joi.string().valid('open', 'in-progress', 'resolved', 'closed')).max(4)
    ).messages({
      'any.only': 'Status must be one of: open, in-progress, resolved, closed',
      'array.max': 'Cannot filter by more than 4 statuses'
    }),

    category: Joi.alternatives().try(
      Joi.string().valid(
        'cpd-points',
        'license-management', 
        'performance-issues',
        'payment-gateway',
        'user-interface',
        'data-inconsistencies',
        'system-errors'
      ),
      Joi.array().items(Joi.string().valid(
        'cpd-points',
        'license-management', 
        'performance-issues',
        'payment-gateway',
        'user-interface',
        'data-inconsistencies',
        'system-errors'
      )).max(7)
    ).messages({
      'any.only': 'Invalid category specified',
      'array.max': 'Cannot filter by more than 7 categories'
    }),

    urgency: Joi.alternatives().try(
      Joi.string().valid('low', 'medium', 'high', 'critical'),
      Joi.array().items(Joi.string().valid('low', 'medium', 'high', 'critical')).max(4)
    ).messages({
      'any.only': 'Urgency must be one of: low, medium, high, critical',
      'array.max': 'Cannot filter by more than 4 urgency levels'
    }),

    assigned_to: Joi.alternatives().try(
      Joi.string().uuid(),
      Joi.string().valid('me', 'unassigned')
    ).messages({
      'string.uuid': 'Assigned user must be a valid user ID',
      'any.only': 'Assigned filter must be a user ID, "me", or "unassigned"'
    }),

    user_id: Joi.string()
      .uuid()
      .messages({
        'string.uuid': 'User ID must be a valid UUID'
      }),

    created_after: Joi.date()
      .iso()
      .messages({
        'date.format': 'Created after date must be in ISO format'
      }),

    created_before: Joi.date()
      .iso()
      .messages({
        'date.format': 'Created before date must be in ISO format'
      }),

    sortBy: Joi.string()
      .valid('created_at', 'updated_at', 'title', 'status', 'urgency', 'category', 'resolved_at', 'ticket_number')
      .default('created_at')
      .messages({
        'any.only': 'Sort field must be one of: created_at, updated_at, title, status, urgency, category, resolved_at, ticket_number'
      }),

    sortOrder: Joi.string()
      .valid('asc', 'desc')
      .default('desc')
      .messages({
        'any.only': 'Sort order must be either asc or desc'
      }),

    my_tickets: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'My tickets filter must be a boolean value'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for bulk ticket operations
 */
const validateBulkTicketOperation = (data) => {
  const schema = Joi.object({
    ticket_ids: Joi.array()
      .items(Joi.string().uuid())
      .min(1)
      .max(50)
      .required()
      .messages({
        'array.min': 'At least one ticket ID is required',
        'array.max': 'Cannot process more than 50 tickets at once',
        'any.required': 'Ticket IDs are required'
      }),

    operation: Joi.string()
      .valid('assign', 'close', 'reopen', 'change_priority', 'change_category', 'delete')
      .required()
      .messages({
        'any.only': 'Operation must be one of: assign, close, reopen, change_priority, change_category, delete',
        'any.required': 'Operation is required'
      }),

    // Fields for assignment operation
    assigned_to: Joi.string()
      .uuid()
      .allow(null)
      .when('operation', {
        is: 'assign',
        then: Joi.required(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'string.uuid': 'Assigned user must be a valid user ID',
        'any.required': 'Assigned user is required for assignment operation',
        'any.forbidden': 'Assigned user can only be provided for assignment operation'
      }),

    // Fields for priority change
    urgency: Joi.string()
      .valid('low', 'medium', 'high', 'critical')
      .when('operation', {
        is: 'change_priority',
        then: Joi.required(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'any.only': 'Urgency must be one of: low, medium, high, critical',
        'any.required': 'Urgency is required for priority change operation',
        'any.forbidden': 'Urgency can only be provided for priority change operation'
      }),

    // Fields for category change
    category: Joi.string()
      .valid(
        'cpd-points',
        'license-management', 
        'performance-issues',
        'payment-gateway',
        'user-interface',
        'data-inconsistencies',
        'system-errors'
      )
      .when('operation', {
        is: 'change_category',
        then: Joi.required(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'any.only': 'Invalid category specified',
        'any.required': 'Category is required for category change operation',
        'any.forbidden': 'Category can only be provided for category change operation'
      }),

    reason: Joi.string()
      .trim()
      .max(500)
      .allow('')
      .messages({
        'string.max': 'Reason cannot exceed 500 characters'
      }),

    notify_users: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Notify users must be a boolean value'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for ticket statistics requests
 */
const validateTicketStats = (data) => {
  const schema = Joi.object({
    period: Joi.string()
      .valid('7d', '30d', '90d', '1y', 'all')
      .default('30d')
      .messages({
        'any.only': 'Period must be one of: 7d, 30d, 90d, 1y, all'
      }),

    user_id: Joi.string()
      .uuid()
      .messages({
        'string.uuid': 'User ID must be a valid UUID'
      }),

    category: Joi.string()
      .valid(
        'cpd-points',
        'license-management', 
        'performance-issues',
        'payment-gateway',
        'user-interface',
        'data-inconsistencies',
        'system-errors'
      )
      .messages({
        'any.only': 'Invalid category specified'
      }),

    group_by: Joi.string()
      .valid('day', 'week', 'month', 'category', 'status', 'urgency', 'user')
      .default('day')
      .messages({
        'any.only': 'Group by must be one of: day, week, month, category, status, urgency, user'
      }),

    include_resolution_time: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include resolution time must be a boolean value'
      }),

    include_satisfaction: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include satisfaction must be a boolean value'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

module.exports = {
  validateTicketCreate,
  validateTicketUpdate,
  validateTicketAssign,
  validateTicketStatusUpdate,
  validateTicketSearch,
  validateBulkTicketOperation,
  validateTicketStats
};