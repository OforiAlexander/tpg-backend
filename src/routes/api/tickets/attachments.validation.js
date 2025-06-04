// src/routes/api/tickets/attachments.validation.js - TPG Attachments Validation
const Joi = require('joi');

/**
 * Validation schema for attachment upload
 */
const validateAttachmentUpload = (data) => {
  const schema = Joi.object({
    comment_id: Joi.string()
      .uuid()
      .allow(null)
      .messages({
        'string.uuid': 'Comment ID must be a valid UUID'
      }),

    description: Joi.string()
      .trim()
      .max(500)
      .allow('')
      .messages({
        'string.max': 'Description cannot exceed 500 characters'
      }),

    tags: Joi.array()
      .items(Joi.string().trim().min(2).max(50))
      .max(5)
      .default([])
      .messages({
        'array.max': 'Cannot have more than 5 tags',
        'string.min': 'Each tag must be at least 2 characters long',
        'string.max': 'Each tag cannot exceed 50 characters'
      }),

    is_public: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Is public must be a boolean value'
      }),

    metadata: Joi.object({
      category: Joi.string().valid('screenshot', 'document', 'log', 'other').default('other'),
      related_to: Joi.string().max(200),
      privacy_level: Joi.string().valid('public', 'internal', 'confidential').default('public'),
      retention_days: Joi.number().integer().min(30).max(2555) // 7 years max
    }).default({})
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for attachment search and filtering
 */
const validateAttachmentSearch = (data) => {
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

    file_type: Joi.string()
      .valid('image', 'document', 'text', 'video', 'audio', 'archive', 'other')
      .messages({
        'any.only': 'File type must be one of: image, document, text, video, audio, archive, other'
      }),

    mime_type: Joi.string()
      .max(100)
      .pattern(/^[a-zA-Z0-9][a-zA-Z0-9!#$&\-\^_]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-\^_.+=]*$/)
      .messages({
        'string.pattern.base': 'Invalid MIME type format',
        'string.max': 'MIME type cannot exceed 100 characters'
      }),

    min_size: Joi.number()
      .integer()
      .min(0)
      .messages({
        'number.min': 'Minimum size must be at least 0',
        'number.integer': 'Minimum size must be an integer'
      }),

    max_size: Joi.number()
      .integer()
      .min(Joi.ref('min_size'))
      .messages({
        'number.min': 'Maximum size must be greater than minimum size',
        'number.integer': 'Maximum size must be an integer'
      }),

    user_id: Joi.string()
      .uuid()
      .messages({
        'string.uuid': 'User ID must be a valid UUID'
      }),

    comment_id: Joi.string()
      .uuid()
      .messages({
        'string.uuid': 'Comment ID must be a valid UUID'
      }),

    virus_scan_status: Joi.string()
      .valid('pending', 'clean', 'infected', 'error')
      .messages({
        'any.only': 'Virus scan status must be one of: pending, clean, infected, error'
      }),

    uploaded_after: Joi.date()
      .iso()
      .messages({
        'date.format': 'Uploaded after date must be in ISO format'
      }),

    uploaded_before: Joi.date()
      .iso()
      .min(Joi.ref('uploaded_after'))
      .messages({
        'date.format': 'Uploaded before date must be in ISO format',
        'date.min': 'Uploaded before date must be after uploaded after date'
      }),

    sort_by: Joi.string()
      .valid('created_at', 'file_size', 'filename', 'download_count', 'mime_type')
      .default('created_at')
      .messages({
        'any.only': 'Sort by must be one of: created_at, file_size, filename, download_count, mime_type'
      }),

    sort_order: Joi.string()
      .valid('asc', 'desc')
      .default('desc')
      .messages({
        'any.only': 'Sort order must be either asc or desc'
      }),

    include_metadata: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include metadata must be a boolean value'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for bulk attachment operations
 */
const validateBulkAttachmentOperation = (data) => {
  const schema = Joi.object({
    attachment_ids: Joi.array()
      .items(Joi.string().uuid())
      .min(1)
      .max(20)
      .required()
      .messages({
        'array.min': 'At least one attachment ID is required',
        'array.max': 'Cannot process more than 20 attachments at once',
        'any.required': 'Attachment IDs are required'
      }),

    operation: Joi.string()
      .valid('delete', 'scan', 'quarantine', 'change_privacy', 'update_tags')
      .required()
      .messages({
        'any.only': 'Operation must be one of: delete, scan, quarantine, change_privacy, update_tags',
        'any.required': 'Operation is required'
      }),

    reason: Joi.string()
      .trim()
      .max(500)
      .when('operation', {
        is: Joi.valid('delete', 'quarantine'),
        then: Joi.required(),
        otherwise: Joi.optional()
      })
      .messages({
        'string.max': 'Reason cannot exceed 500 characters',
        'any.required': 'Reason is required for delete and quarantine operations'
      }),

    privacy_level: Joi.string()
      .valid('public', 'internal', 'confidential')
      .when('operation', {
        is: 'change_privacy',
        then: Joi.required(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'any.only': 'Privacy level must be one of: public, internal, confidential',
        'any.required': 'Privacy level is required for change_privacy operation',
        'any.forbidden': 'Privacy level can only be provided for change_privacy operation'
      }),

    tags: Joi.array()
      .items(Joi.string().trim().min(2).max(50))
      .max(10)
      .when('operation', {
        is: 'update_tags',
        then: Joi.required(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'array.max': 'Cannot have more than 10 tags',
        'string.min': 'Each tag must be at least 2 characters long',
        'string.max': 'Each tag cannot exceed 50 characters',
        'any.required': 'Tags are required for update_tags operation',
        'any.forbidden': 'Tags can only be provided for update_tags operation'
      }),

    force: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Force must be a boolean value'
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
 * Validation schema for attachment virus scan
 */
const validateVirusScan = (data) => {
  const schema = Joi.object({
    scan_type: Joi.string()
      .valid('quick', 'full', 'custom')
      .default('quick')
      .messages({
        'any.only': 'Scan type must be one of: quick, full, custom'
      }),

    force_rescan: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Force rescan must be a boolean value'
      }),

    quarantine_infected: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Quarantine infected must be a boolean value'
      }),

    notify_on_completion: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Notify on completion must be a boolean value'
      }),

    scan_options: Joi.object({
      include_archives: Joi.boolean().default(true),
      include_packed: Joi.boolean().default(true),
      max_scan_time: Joi.number().integer().min(30).max(3600).default(300), // 5 minutes default
      scan_memory: Joi.boolean().default(false)
    })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for attachment metadata update
 */
const validateAttachmentMetadataUpdate = (data) => {
  const schema = Joi.object({
    description: Joi.string()
      .trim()
      .max(500)
      .allow('')
      .messages({
        'string.max': 'Description cannot exceed 500 characters'
      }),

    tags: Joi.array()
      .items(Joi.string().trim().min(2).max(50))
      .max(10)
      .messages({
        'array.max': 'Cannot have more than 10 tags',
        'string.min': 'Each tag must be at least 2 characters long',
        'string.max': 'Each tag cannot exceed 50 characters'
      }),

    privacy_level: Joi.string()
      .valid('public', 'internal', 'confidential')
      .messages({
        'any.only': 'Privacy level must be one of: public, internal, confidential'
      }),

    category: Joi.string()
      .valid('screenshot', 'document', 'log', 'evidence', 'reference', 'other')
      .messages({
        'any.only': 'Category must be one of: screenshot, document, log, evidence, reference, other'
      }),

    retention_days: Joi.number()
      .integer()
      .min(30)
      .max(2555) // 7 years
      .messages({
        'number.min': 'Retention period must be at least 30 days',
        'number.max': 'Retention period cannot exceed 2555 days (7 years)',
        'number.integer': 'Retention period must be a whole number'
      }),

    custom_metadata: Joi.object()
      .pattern(Joi.string().min(1).max(50), Joi.alternatives().try(
        Joi.string().max(200),
        Joi.number(),
        Joi.boolean()
      ))
      .max(10)
      .messages({
        'object.max': 'Cannot have more than 10 custom metadata fields'
      })
  }).min(1); // At least one field must be provided for update

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for attachment statistics requests
 */
const validateAttachmentStats = (data) => {
  const schema = Joi.object({
    period: Joi.string()
      .valid('7d', '30d', '90d', '1y', 'all')
      .default('30d')
      .messages({
        'any.only': 'Period must be one of: 7d, 30d, 90d, 1y, all'
      }),

    group_by: Joi.string()
      .valid('day', 'week', 'month', 'mime_type', 'size_range', 'user', 'ticket')
      .default('day')
      .messages({
        'any.only': 'Group by must be one of: day, week, month, mime_type, size_range, user, ticket'
      }),

    ticket_id: Joi.string()
      .uuid()
      .messages({
        'string.uuid': 'Ticket ID must be a valid UUID'
      }),

    user_id: Joi.string()
      .uuid()
      .messages({
        'string.uuid': 'User ID must be a valid UUID'
      }),

    include_size_breakdown: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include size breakdown must be a boolean value'
      }),

    include_download_stats: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include download stats must be a boolean value'
      }),

    include_scan_stats: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include scan stats must be a boolean value'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation for file upload constraints
 */
const validateUploadConstraints = () => {
  const TicketAttachment = require('../../../models/TicketAttachment');
  
  return {
    maxFileSize: TicketAttachment.getMaxFileSize(),
    allowedTypes: TicketAttachment.getAllowedFileTypes(),
    allowedMimeTypes: Object.values(TicketAttachment.getAllowedMimeTypes()),
    maxFiles: 5
  };
};

module.exports = {
  validateAttachmentUpload,
  validateAttachmentSearch,
  validateBulkAttachmentOperation,
  validateVirusScan,
  validateAttachmentMetadataUpdate,
  validateAttachmentStats,
  validateUploadConstraints
};