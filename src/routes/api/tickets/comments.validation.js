// src/routes/api/tickets/comments.validation.js - TPG Comments Validation
const Joi = require('joi');

/**
 * Validation schema for comment creation
 */
const validateCommentCreate = (data) => {
  const schema = Joi.object({
    content: Joi.string()
      .trim()
      .min(3)
      .max(3000)
      .required()
      .messages({
        'string.empty': 'Comment content is required',
        'string.min': 'Comment must be at least 3 characters long',
        'string.max': 'Comment cannot exceed 3000 characters'
      }),

    is_internal: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Internal flag must be a boolean value'
      }),

    parent_comment_id: Joi.string()
      .uuid()
      .allow(null)
      .messages({
        'string.uuid': 'Parent comment ID must be a valid UUID'
      }),

    metadata: Joi.object({
      mentioned_users: Joi.array().items(Joi.string().uuid()).max(10),
      attachments_count: Joi.number().integer().min(0).max(10),
      formatting: Joi.object({
        has_code: Joi.boolean(),
        has_links: Joi.boolean(),
        has_mentions: Joi.boolean()
      }),
      client_info: Joi.object({
        browser: Joi.string().max(100),
        platform: Joi.string().max(50),
        timestamp: Joi.date().iso()
      })
    }).default({})
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for comment updates
 */
const validateCommentUpdate = (data) => {
  const schema = Joi.object({
    content: Joi.string()
      .trim()
      .min(3)
      .max(3000)
      .required()
      .messages({
        'string.empty': 'Comment content is required',
        'string.min': 'Comment must be at least 3 characters long',
        'string.max': 'Comment cannot exceed 3000 characters'
      }),

    edit_reason: Joi.string()
      .trim()
      .max(200)
      .allow('')
      .messages({
        'string.max': 'Edit reason cannot exceed 200 characters'
      }),

    metadata: Joi.object({
      mentioned_users: Joi.array().items(Joi.string().uuid()).max(10),
      formatting: Joi.object({
        has_code: Joi.boolean(),
        has_links: Joi.boolean(),
        has_mentions: Joi.boolean()
      }),
      edit_info: Joi.object({
        browser: Joi.string().max(100),
        platform: Joi.string().max(50),
        timestamp: Joi.date().iso()
      })
    })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for comment search and filtering
 */
const validateCommentSearch = (data) => {
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
      .default(50)
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

    user_id: Joi.string()
      .uuid()
      .messages({
        'string.uuid': 'User ID must be a valid UUID'
      }),

    include_internal: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include internal must be a boolean value'
      }),

    is_edited: Joi.boolean()
      .messages({
        'boolean.base': 'Is edited must be a boolean value'
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

    order: Joi.string()
      .valid('asc', 'desc')
      .default('asc')
      .messages({
        'any.only': 'Order must be either asc or desc'
      }),

    sort_by: Joi.string()
      .valid('created_at', 'updated_at', 'content_length', 'user')
      .default('created_at')
      .messages({
        'any.only': 'Sort by must be one of: created_at, updated_at, content_length, user'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for bulk comment operations
 */
const validateBulkCommentOperation = (data) => {
  const schema = Joi.object({
    comment_ids: Joi.array()
      .items(Joi.string().uuid())
      .min(1)
      .max(25)
      .required()
      .messages({
        'array.min': 'At least one comment ID is required',
        'array.max': 'Cannot process more than 25 comments at once',
        'any.required': 'Comment IDs are required'
      }),

    operation: Joi.string()
      .valid('delete', 'make_internal', 'make_public', 'moderate')
      .required()
      .messages({
        'any.only': 'Operation must be one of: delete, make_internal, make_public, moderate',
        'any.required': 'Operation is required'
      }),

    reason: Joi.string()
      .trim()
      .max(500)
      .when('operation', {
        is: Joi.valid('delete', 'moderate'),
        then: Joi.required(),
        otherwise: Joi.optional()
      })
      .messages({
        'string.max': 'Reason cannot exceed 500 characters',
        'any.required': 'Reason is required for delete and moderate operations'
      }),

    moderation_action: Joi.string()
      .valid('hide', 'flag', 'warn_user', 'edit_content')
      .when('operation', {
        is: 'moderate',
        then: Joi.required(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'any.only': 'Moderation action must be one of: hide, flag, warn_user, edit_content',
        'any.required': 'Moderation action is required for moderate operation',
        'any.forbidden': 'Moderation action can only be provided for moderate operation'
      }),

    replacement_content: Joi.string()
      .trim()
      .min(3)
      .max(3000)
      .when('moderation_action', {
        is: 'edit_content',
        then: Joi.required(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'string.min': 'Replacement content must be at least 3 characters long',
        'string.max': 'Replacement content cannot exceed 3000 characters',
        'any.required': 'Replacement content is required for edit_content moderation',
        'any.forbidden': 'Replacement content can only be provided for edit_content moderation'
      }),

    notify_users: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Notify users must be a boolean value'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for comment internal status toggle
 */
const validateInternalStatusToggle = (data) => {
  const schema = Joi.object({
    is_internal: Joi.boolean()
      .required()
      .messages({
        'boolean.base': 'Internal status must be a boolean value',
        'any.required': 'Internal status is required'
      }),

    reason: Joi.string()
      .trim()
      .max(200)
      .allow('')
      .messages({
        'string.max': 'Reason cannot exceed 200 characters'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for comment reporting/flagging
 */
const validateCommentReport = (data) => {
  const schema = Joi.object({
    reason: Joi.string()
      .valid(
        'inappropriate_content',
        'spam',
        'harassment',
        'false_information',
        'privacy_violation',
        'terms_violation',
        'other'
      )
      .required()
      .messages({
        'any.only': 'Report reason must be one of: inappropriate_content, spam, harassment, false_information, privacy_violation, terms_violation, other',
        'any.required': 'Report reason is required'
      }),

    description: Joi.string()
      .trim()
      .max(1000)
      .when('reason', {
        is: 'other',
        then: Joi.required(),
        otherwise: Joi.optional()
      })
      .messages({
        'string.max': 'Description cannot exceed 1000 characters',
        'any.required': 'Description is required when reason is "other"'
      }),

    evidence: Joi.object({
        screenshot_urls: Joi.array().items(Joi.string().uri()).max(5),
        additional_context: Joi.string().max(500),
        related_comment_ids: Joi.array().items(Joi.string().uuid()).max(10)
    })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for comment threading/replies
 */
const validateCommentReply = (data) => {
  const schema = Joi.object({
    parent_comment_id: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.uuid': 'Parent comment ID must be a valid UUID',
        'any.required': 'Parent comment ID is required for replies'
      }),

    content: Joi.string()
      .trim()
      .min(3)
      .max(3000)
      .required()
      .messages({
        'string.empty': 'Reply content is required',
        'string.min': 'Reply must be at least 3 characters long',
        'string.max': 'Reply cannot exceed 3000 characters'
      }),

    is_internal: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Internal flag must be a boolean value'
      }),

    quote_parent: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Quote parent must be a boolean value'
      }),

    mentioned_users: Joi.array()
      .items(Joi.string().uuid())
      .max(5)
      .default([])
      .messages({
        'array.max': 'Cannot mention more than 5 users in a reply'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for comment statistics requests
 */
const validateCommentStats = (data) => {
  const schema = Joi.object({
    period: Joi.string()
      .valid('7d', '30d', '90d', '1y', 'all')
      .default('30d')
      .messages({
        'any.only': 'Period must be one of: 7d, 30d, 90d, 1y, all'
      }),

    group_by: Joi.string()
      .valid('day', 'week', 'month', 'user', 'ticket')
      .default('day')
      .messages({
        'any.only': 'Group by must be one of: day, week, month, user, ticket'
      }),

    include_internal: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include internal must be a boolean value'
      }),

    user_id: Joi.string()
      .uuid()
      .messages({
        'string.uuid': 'User ID must be a valid UUID'
      }),

    include_response_times: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include response times must be a boolean value'
      }),

    include_sentiment: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include sentiment must be a boolean value'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

module.exports = {
  validateCommentCreate,
  validateCommentUpdate,
  validateCommentSearch,
  validateBulkCommentOperation,
  validateInternalStatusToggle,
  validateCommentReport,
  validateCommentReply,
  validateCommentStats
};