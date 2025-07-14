// src/routes/api/settings/settings.validation.js - TPG Settings Validation
const Joi = require('joi');

/**
 * Validation schema for updating settings
 */
const validateSettingsUpdate = (data) => {
  const schema = Joi.object({
    key: Joi.string()
      .trim()
      .min(1)
      .max(100)
      .required()
      .messages({
        'string.empty': 'Setting key is required',
        'string.min': 'Setting key must be at least 1 character long',
        'string.max': 'Setting key cannot exceed 100 characters'
      }),

    value: Joi.alternatives()
      .try(
        Joi.string(),
        Joi.number(),
        Joi.boolean(),
        Joi.object(),
        Joi.array()
      )
      .required()
      .messages({
        'any.required': 'Setting value is required'
      })
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Validation schema for creating new settings
 */
const validateSettingsCreate = (data) => {
  const schema = Joi.object({
    key: Joi.string()
      .trim()
      .min(1)
      .max(100)
      .pattern(/^[a-z0-9_]+$/)
      .required()
      .messages({
        'string.empty': 'Setting key is required',
        'string.min': 'Setting key must be at least 1 character long',
        'string.max': 'Setting key cannot exceed 100 characters',
        'string.pattern.base': 'Setting key can only contain lowercase letters, numbers, and underscores'
      }),

    value: Joi.alternatives()
      .try(
        Joi.string(),
        Joi.number(),
        Joi.boolean(),
        Joi.object(),
        Joi.array()
      )
      .required()
      .messages({
        'any.required': 'Setting value is required'
      }),

    description: Joi.string()
      .trim()
      .max(500)
      .allow('')
      .messages({
        'string.max': 'Description cannot exceed 500 characters'
      }),

    type: Joi.string()
      .valid('string', 'number', 'boolean', 'json')
      .default('string')
      .messages({
        'any.only': 'Type must be one of: string, number, boolean, json'
      }),

    category: Joi.string()
      .trim()
      .max(50)
      .default('general')
      .messages({
        'string.max': 'Category cannot exceed 50 characters'
      }),

    is_public: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'is_public must be a boolean value'
      }),

    sort_order: Joi.number()
      .integer()
      .min(0)
      .max(9999)
      .default(0)
      .messages({
        'number.min': 'Sort order must be 0 or greater',
        'number.max': 'Sort order cannot exceed 9999',
        'number.integer': 'Sort order must be an integer'
      })
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Validation schema for bulk settings update
 */
const validateBulkSettingsUpdate = (data) => {
  const schema = Joi.object({
    settings: Joi.array()
      .items(
        Joi.object({
          key: Joi.string()
            .trim()
            .min(1)
            .max(100)
            .required(),
          value: Joi.alternatives()
            .try(
              Joi.string(),
              Joi.number(),
              Joi.boolean(),
              Joi.object(),
              Joi.array()
            )
            .required()
        })
      )
      .min(1)
      .max(50)
      .required()
      .messages({
        'array.min': 'At least one setting is required',
        'array.max': 'Cannot update more than 50 settings at once',
        'any.required': 'Settings array is required'
      })
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Validation schema for backup requests
 */
const validateBackupRequest = (data) => {
  const schema = Joi.object({
    include_files: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'include_files must be a boolean value'
      }),

    include_logs: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'include_logs must be a boolean value'
      }),

    include_settings: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'include_settings must be a boolean value'
      }),

    compression: Joi.string()
      .valid('none', 'gzip', 'zip')
      .default('gzip')
      .messages({
        'any.only': 'Compression must be one of: none, gzip, zip'
      }),

    description: Joi.string()
      .trim()
      .max(200)
      .allow('')
      .messages({
        'string.max': 'Description cannot exceed 200 characters'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for settings import
 */
const validateSettingsImport = (data) => {
  const schema = Joi.object({
    settings: Joi.object({
      export_date: Joi.string().isoDate().required(),
      total_settings: Joi.number().integer().min(0).required(),
      settings: Joi.array()
        .items(
          Joi.object({
            key: Joi.string().trim().min(1).max(100).required(),
            value: Joi.alternatives().try(
              Joi.string(),
              Joi.number(),
              Joi.boolean(),
              Joi.object(),
              Joi.array()
            ).required(),
            description: Joi.string().max(500).allow(''),
            type: Joi.string().valid('string', 'number', 'boolean', 'json').required(),
            category: Joi.string().max(50).allow(''),
            is_public: Joi.boolean().required(),
            sort_order: Joi.number().integer().min(0).max(9999).required()
          })
        )
        .required()
    }).required(),

    options: Joi.object({
      overwrite: Joi.boolean().default(false),
      validate_only: Joi.boolean().default(false),
      backup_existing: Joi.boolean().default(true)
    }).default({})
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Validation schema for test email
 */
const validateTestEmail = (data) => {
  const schema = Joi.object({
    to_email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Test email address is required'
      }),

    test_type: Joi.string()
      .valid('configuration', 'template', 'notification')
      .default('configuration')
      .messages({
        'any.only': 'Test type must be one of: configuration, template, notification'
      }),

    template: Joi.string()
      .when('test_type', {
        is: 'template',
        then: Joi.required(),
        otherwise: Joi.optional()
      })
      .messages({
        'any.required': 'Template is required when test_type is template'
      })
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Validation schema for cache operations
 */
const validateCacheOperation = (data) => {
  const schema = Joi.object({
    cache_type: Joi.string()
      .valid('all', 'settings', 'users', 'tickets', 'sessions', 'files')
      .default('all')
      .messages({
        'any.only': 'Cache type must be one of: all, settings, users, tickets, sessions, files'
      }),

    force: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Force must be a boolean value'
      })
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Validation schema for system maintenance
 */
const validateMaintenanceMode = (data) => {
  const schema = Joi.object({
    enabled: Joi.boolean()
      .required()
      .messages({
        'boolean.base': 'Enabled must be a boolean value',
        'any.required': 'Enabled status is required'
      }),

    message: Joi.string()
      .trim()
      .max(500)
      .when('enabled', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional()
      })
      .messages({
        'string.max': 'Maintenance message cannot exceed 500 characters',
        'any.required': 'Maintenance message is required when enabling maintenance mode'
      }),

    estimated_duration: Joi.number()
      .integer()
      .min(1)
      .max(1440) // Max 24 hours
      .when('enabled', {
        is: true,
        then: Joi.optional(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'number.min': 'Estimated duration must be at least 1 minute',
        'number.max': 'Estimated duration cannot exceed 1440 minutes (24 hours)',
        'number.integer': 'Estimated duration must be an integer'
      }),

    allowed_ips: Joi.array()
      .items(
        Joi.string().ip({
          version: ['ipv4', 'ipv6'],
          cidr: 'optional'
        })
      )
      .max(10)
      .when('enabled', {
        is: true,
        then: Joi.optional(),
        otherwise: Joi.forbidden()
      })
      .messages({
        'array.max': 'Cannot specify more than 10 allowed IP addresses'
      })
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Validation schema for settings search
 */
const validateSettingsSearch = (data) => {
  const schema = Joi.object({
    q: Joi.string()
      .trim()
      .min(1)
      .max(100)
      .required()
      .messages({
        'string.min': 'Search query must be at least 1 character long',
        'string.max': 'Search query cannot exceed 100 characters',
        'string.empty': 'Search query is required'
      }),

    category: Joi.string()
      .trim()
      .max(50)
      .messages({
        'string.max': 'Category cannot exceed 50 characters'
      }),

    type: Joi.string()
      .valid('string', 'number', 'boolean', 'json')
      .messages({
        'any.only': 'Type must be one of: string, number, boolean, json'
      }),

    is_public: Joi.boolean()
      .messages({
        'boolean.base': 'is_public must be a boolean value'
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
      })
  });

  return schema.validate(data, { abortEarly: false });
};

module.exports = {
  validateSettingsUpdate,
  validateSettingsCreate,
  validateBulkSettingsUpdate,
  validateBackupRequest,
  validateSettingsImport,
  validateTestEmail,
  validateCacheOperation,
  validateMaintenanceMode,
  validateSettingsSearch
};