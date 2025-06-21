// src/routes/api/analytics/analytics.validation.js - TPG Analytics Validation
const Joi = require('joi');

/**
 * Validation schema for general analytics queries
 */
const validateAnalyticsQuery = (data) => {
  const schema = Joi.object({
    period: Joi.string()
      .valid('1d', '7d', '30d', '90d', '180d', '1y', 'all')
      .default('30d')
      .messages({
        'any.only': 'Period must be one of: 1d, 7d, 30d, 90d, 180d, 1y, all'
      }),

    group_by: Joi.string()
      .valid('hour', 'day', 'week', 'month', 'quarter', 'year', 'category', 'status', 'urgency', 'user', 'assigned_to')
      .default('day')
      .messages({
        'any.only': 'Group by must be one of: hour, day, week, month, quarter, year, category, status, urgency, user, assigned_to'
      }),

    start_date: Joi.date()
      .iso()
      .messages({
        'date.format': 'Start date must be in ISO format (YYYY-MM-DD)'
      }),

    end_date: Joi.date()
      .iso()
      .min(Joi.ref('start_date'))
      .messages({
        'date.format': 'End date must be in ISO format (YYYY-MM-DD)',
        'date.min': 'End date must be after start date'
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

    status: Joi.alternatives().try(
      Joi.string().valid('open', 'in-progress', 'resolved', 'closed'),
      Joi.array().items(Joi.string().valid('open', 'in-progress', 'resolved', 'closed')).max(4)
    ).messages({
      'any.only': 'Status must be one of: open, in-progress, resolved, closed',
      'array.max': 'Cannot filter by more than 4 statuses'
    }),

    urgency: Joi.alternatives().try(
      Joi.string().valid('low', 'medium', 'high', 'critical'),
      Joi.array().items(Joi.string().valid('low', 'medium', 'high', 'critical')).max(4)
    ).messages({
      'any.only': 'Urgency must be one of: low, medium, high, critical',
      'array.max': 'Cannot filter by more than 4 urgency levels'
    }),

    assigned_to: Joi.string()
      .uuid()
      .messages({
        'string.uuid': 'Assigned to must be a valid user ID'
      }),

    user_id: Joi.string()
      .uuid()
      .messages({
        'string.uuid': 'User ID must be a valid UUID'
      }),

    role: Joi.string()
      .valid('user', 'admin', 'super_admin')
      .messages({
        'any.only': 'Role must be one of: user, admin, super_admin'
      }),

    include_trends: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include trends must be a boolean value'
      }),

    include_forecasts: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include forecasts must be a boolean value'
      }),

    include_activity: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include activity must be a boolean value'
      }),

    include_performance: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include performance must be a boolean value'
      }),

    timezone: Joi.string()
      .pattern(/^[A-Za-z_\/]+$/)
      .default('Africa/Accra')
      .messages({
        'string.pattern.base': 'Invalid timezone format'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for dashboard queries
 */
const validateDashboardQuery = (data) => {
  const schema = Joi.object({
    period: Joi.string()
      .valid('1d', '7d', '30d', '90d')
      .default('30d')
      .messages({
        'any.only': 'Dashboard period must be one of: 1d, 7d, 30d, 90d'
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

    include_trends: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include trends must be a boolean value'
      }),

    include_comparisons: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include comparisons must be a boolean value'
      }),

    include_forecasts: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include forecasts must be a boolean value'
      }),

    refresh: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Refresh must be a boolean value'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for report generation
 */
const validateReportQuery = (data) => {
  const schema = Joi.object({
    report_type: Joi.string()
      .valid(
        'summary',
        'detailed_tickets',
        'user_activity',
        'performance_metrics',
        'satisfaction_analysis',
        'category_breakdown',
        'sla_compliance',
        'trend_analysis',
        'executive_summary',
        'operational_report'
      )
      .required()
      .messages({
        'any.only': 'Report type must be one of: summary, detailed_tickets, user_activity, performance_metrics, satisfaction_analysis, category_breakdown, sla_compliance, trend_analysis, executive_summary, operational_report',
        'any.required': 'Report type is required'
      }),

    period: Joi.string()
      .valid('1d', '7d', '30d', '90d', '180d', '1y')
      .default('30d')
      .messages({
        'any.only': 'Report period must be one of: 1d, 7d, 30d, 90d, 180d, 1y'
      }),

    format: Joi.string()
      .valid('json', 'pdf', 'csv', 'excel')
      .default('json')
      .messages({
        'any.only': 'Format must be one of: json, pdf, csv, excel'
      }),

    filters: Joi.object({
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
        ))
      ),
      status: Joi.alternatives().try(
        Joi.string().valid('open', 'in-progress', 'resolved', 'closed'),
        Joi.array().items(Joi.string().valid('open', 'in-progress', 'resolved', 'closed'))
      ),
      urgency: Joi.alternatives().try(
        Joi.string().valid('low', 'medium', 'high', 'critical'),
        Joi.array().items(Joi.string().valid('low', 'medium', 'high', 'critical'))
      ),
      user_id: Joi.string().uuid(),
      assigned_to: Joi.string().uuid(),
      created_after: Joi.date().iso(),
      created_before: Joi.date().iso(),
      min_satisfaction: Joi.number().min(1).max(5),
      max_resolution_hours: Joi.number().positive()
    }).default({}),

    include_charts: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include charts must be a boolean value'
      }),

    include_raw_data: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include raw data must be a boolean value'
      }),

    email_recipients: Joi.array()
      .items(Joi.string().email())
      .max(10)
      .default([])
      .messages({
        'array.max': 'Cannot send report to more than 10 email addresses',
        'string.email': 'All email recipients must be valid email addresses'
      }),

    schedule: Joi.object({
      frequency: Joi.string().valid('once', 'daily', 'weekly', 'monthly'),
      day_of_week: Joi.when('frequency', {
        is: 'weekly',
        then: Joi.number().min(0).max(6).required(),
        otherwise: Joi.forbidden()
      }),
      day_of_month: Joi.when('frequency', {
        is: 'monthly',
        then: Joi.number().min(1).max(31).required(),
        otherwise: Joi.forbidden()
      }),
      time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    }),

    custom_fields: Joi.array()
      .items(Joi.string().max(50))
      .max(20)
      .messages({
        'array.max': 'Cannot include more than 20 custom fields'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for trend analysis
 */
const validateTrendQuery = (data) => {
  const schema = Joi.object({
    metric: Joi.string()
      .valid(
        'tickets_created',
        'tickets_resolved',
        'tickets_closed',
        'resolution_time',
        'first_response_time',
        'user_satisfaction',
        'user_activity',
        'comment_volume',
        'attachment_volume',
        'category_distribution',
        'urgency_distribution'
      )
      .default('tickets_created')
      .messages({
        'any.only': 'Metric must be one of: tickets_created, tickets_resolved, tickets_closed, resolution_time, first_response_time, user_satisfaction, user_activity, comment_volume, attachment_volume, category_distribution, urgency_distribution'
      }),

    period: Joi.string()
      .valid('7d', '30d', '90d', '180d', '1y', '2y')
      .default('90d')
      .messages({
        'any.only': 'Trend period must be one of: 7d, 30d, 90d, 180d, 1y, 2y'
      }),

    granularity: Joi.string()
      .valid('hour', 'day', 'week', 'month')
      .default('day')
      .messages({
        'any.only': 'Granularity must be one of: hour, day, week, month'
      }),

    compare_period: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Compare period must be a boolean value'
      }),

    include_forecast: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include forecast must be a boolean value'
      }),

    forecast_days: Joi.number()
      .integer()
      .min(1)
      .max(90)
      .default(30)
      .when('include_forecast', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional()
      })
      .messages({
        'number.min': 'Forecast days must be at least 1',
        'number.max': 'Forecast days cannot exceed 90',
        'number.integer': 'Forecast days must be an integer'
      }),

    moving_average: Joi.number()
      .integer()
      .min(1)
      .max(30)
      .messages({
        'number.min': 'Moving average window must be at least 1',
        'number.max': 'Moving average window cannot exceed 30',
        'number.integer': 'Moving average window must be an integer'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for export requests
 */
const validateExportQuery = (data) => {
  const schema = Joi.object({
    data_type: Joi.string()
      .valid('tickets', 'users', 'comments', 'attachments', 'analytics', 'all')
      .required()
      .messages({
        'any.only': 'Data type must be one of: tickets, users, comments, attachments, analytics, all',
        'any.required': 'Data type is required'
      }),

    period: Joi.string()
      .valid('1d', '7d', '30d', '90d', '180d', '1y', 'all')
      .default('30d')
      .messages({
        'any.only': 'Export period must be one of: 1d, 7d, 30d, 90d, 180d, 1y, all'
      }),

    format: Joi.string()
      .valid('csv', 'excel', 'json', 'xml')
      .default('csv')
      .messages({
        'any.only': 'Export format must be one of: csv, excel, json, xml'
      }),

    filters: Joi.object({
      category: Joi.array().items(Joi.string()),
      status: Joi.array().items(Joi.string()),
      urgency: Joi.array().items(Joi.string()),
      user_id: Joi.string().uuid(),
      assigned_to: Joi.string().uuid(),
      created_after: Joi.date().iso(),
      created_before: Joi.date().iso()
    }).default({}),

    include_metadata: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include metadata must be a boolean value'
      }),

    include_attachments_info: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include attachments info must be a boolean value'
      }),

    include_comments: Joi.boolean()
      .default(false)
      .messages({
        'boolean.base': 'Include comments must be a boolean value'
      }),

    max_records: Joi.number()
      .integer()
      .min(1)
      .max(100000)
      .default(10000)
      .messages({
        'number.min': 'Max records must be at least 1',
        'number.max': 'Max records cannot exceed 100,000',
        'number.integer': 'Max records must be an integer'
      }),

    fields: Joi.array()
      .items(Joi.string().max(100))
      .max(50)
      .messages({
        'array.max': 'Cannot specify more than 50 fields',
        'string.max': 'Field names cannot exceed 100 characters'
      }),

    sort_by: Joi.string()
      .valid('created_at', 'updated_at', 'id', 'status', 'urgency', 'category')
      .default('created_at')
      .messages({
        'any.only': 'Sort by must be one of: created_at, updated_at, id, status, urgency, category'
      }),

    sort_order: Joi.string()
      .valid('asc', 'desc')
      .default('desc')
      .messages({
        'any.only': 'Sort order must be either asc or desc'
      })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for real-time analytics queries
 */
const validateRealtimeQuery = (data) => {
  const schema = Joi.object({
    metrics: Joi.alternatives().try(
      Joi.string().valid('all', 'tickets', 'users', 'performance', 'system'),
      Joi.array().items(Joi.string().valid(
        'active_users',
        'open_tickets',
        'pending_tickets',
        'overdue_tickets',
        'response_time',
        'resolution_rate',
        'satisfaction_score',
        'system_load',
        'error_rate'
      )).min(1).max(10)
    ).default('all')
    .messages({
      'any.only': 'Invalid metrics specified',
      'array.min': 'At least one metric must be specified',
      'array.max': 'Cannot request more than 10 metrics'
    }),

    refresh_interval: Joi.number()
      .integer()
      .min(10)
      .max(300)
      .default(30)
      .messages({
        'number.min': 'Refresh interval must be at least 10 seconds',
        'number.max': 'Refresh interval cannot exceed 300 seconds (5 minutes)',
        'number.integer': 'Refresh interval must be an integer'
      }),

    include_alerts: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Include alerts must be a boolean value'
      }),

    alert_threshold: Joi.object({
      overdue_tickets: Joi.number().min(0).max(1000),
      response_time: Joi.number().min(0).max(86400), // 24 hours in seconds
      error_rate: Joi.number().min(0).max(100),
      system_load: Joi.number().min(0).max(100)
    })
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validation schema for custom analytics queries
 */
const validateCustomQuery = (data) => {
  const schema = Joi.object({
    query_name: Joi.string()
      .trim()
      .min(3)
      .max(100)
      .required()
      .messages({
        'string.min': 'Query name must be at least 3 characters long',
        'string.max': 'Query name cannot exceed 100 characters',
        'any.required': 'Query name is required'
      }),

    dimensions: Joi.array()
      .items(Joi.string().valid(
        'date', 'category', 'status', 'urgency', 'user', 'assigned_to',
        'resolution_time', 'satisfaction', 'hour', 'day_of_week', 'month'
      ))
      .min(1)
      .max(5)
      .required()
      .messages({
        'array.min': 'At least one dimension is required',
        'array.max': 'Cannot specify more than 5 dimensions',
        'any.required': 'Dimensions are required'
      }),

    metrics: Joi.array()
      .items(Joi.string().valid(
        'count', 'avg_resolution_time', 'avg_satisfaction', 'sum_comments',
        'sum_attachments', 'first_response_time', 'escalation_rate'
      ))
      .min(1)
      .max(10)
      .required()
      .messages({
        'array.min': 'At least one metric is required',
        'array.max': 'Cannot specify more than 10 metrics',
        'any.required': 'Metrics are required'
      }),

    filters: Joi.object().pattern(
      Joi.string(),
      Joi.alternatives().try(
        Joi.string(),
        Joi.number(),
        Joi.boolean(),
        Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.number()))
      )
    ),

    time_range: Joi.object({
      start: Joi.date().iso().required(),
      end: Joi.date().iso().min(Joi.ref('start')).required()
    }).required(),

    grouping: Joi.string()
      .valid('hour', 'day', 'week', 'month')
      .default('day'),

    limit: Joi.number()
      .integer()
      .min(1)
      .max(10000)
      .default(1000)
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};

module.exports = {
  validateAnalyticsQuery,
  validateDashboardQuery,
  validateReportQuery,
  validateTrendQuery,
  validateExportQuery,
  validateRealtimeQuery,
  validateCustomQuery
};