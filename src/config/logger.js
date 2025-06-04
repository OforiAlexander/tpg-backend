// src/config/logger.js - TPG Logging Configuration
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, ...meta }) => {
  let log = `${timestamp} [${level}]: ${message}`;
  
  // Add metadata if present
  if (Object.keys(meta).length > 0) {
    log += `\n${JSON.stringify(meta, null, 2)}`;
  }
  
  return log;
});

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
require('fs').mkdirSync(logsDir, { recursive: true });

// Transport configurations
const transports = [];

// Console transport for development
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        consoleFormat
      ),
      level: 'debug'
    })
  );
}

// File transports for all environments
transports.push(
  // General application logs
  new DailyRotateFile({
    filename: path.join(logsDir, 'tpg-app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    format: combine(
      timestamp(),
      errors({ stack: true }),
      json()
    ),
    level: 'info'
  }),

  // Error logs
  new DailyRotateFile({
    filename: path.join(logsDir, 'tpg-error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '90d',
    format: combine(
      timestamp(),
      errors({ stack: true }),
      json()
    ),
    level: 'error'
  }),

  // Security logs (for audit trail)
  new DailyRotateFile({
    filename: path.join(logsDir, 'tpg-security-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '50m',
    maxFiles: '365d', // Keep security logs for 1 year
    format: combine(
      timestamp(),
      json()
    ),
    level: 'info'
  })
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: {
    service: 'tpg-backend',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  },
  transports,
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'tpg-exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: combine(
        timestamp(),
        errors({ stack: true }),
        json()
      )
    })
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'tpg-rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: combine(
        timestamp(),
        errors({ stack: true }),
        json()
      )
    })
  ]
});

// Security-specific logging functions
const securityLogger = {
  /**
   * Log authentication attempts
   */
  logAuth: (event, email, ip, userAgent, success = true, details = {}) => {
    logger.info('Authentication Event', {
      category: 'security',
      event,
      email,
      ip,
      userAgent,
      success,
      timestamp: new Date().toISOString(),
      ...details
    });
  },

  /**
   * Log permission violations
   */
  logPermissionDenied: (userId, action, resource, ip, userAgent) => {
    logger.warn('Permission Denied', {
      category: 'security',
      event: 'permission_denied',
      userId,
      action,
      resource,
      ip,
      userAgent,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Log suspicious activities
   */
  logSuspiciousActivity: (event, details, ip, userAgent) => {
    logger.warn('Suspicious Activity', {
      category: 'security',
      event: 'suspicious_activity',
      activity: event,
      details,
      ip,
      userAgent,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Log data access events
   */
  logDataAccess: (userId, action, resource, resourceId, ip) => {
    logger.info('Data Access', {
      category: 'security',
      event: 'data_access',
      userId,
      action,
      resource,
      resourceId,
      ip,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Log administrative actions
   */
  logAdminAction: (adminId, action, target, details, ip) => {
    logger.info('Admin Action', {
      category: 'security',
      event: 'admin_action',
      adminId,
      action,
      target,
      details,
      ip,
      timestamp: new Date().toISOString()
    });
  }
};

// API request logging
const apiLogger = {
  /**
   * Log API requests
   */
  logRequest: (method, url, ip, userAgent, userId = null, duration = null) => {
    logger.info('API Request', {
      category: 'api',
      method,
      url,
      ip,
      userAgent,
      userId,
      duration,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Log API errors
   */
  logError: (method, url, statusCode, error, ip, userId = null) => {
    logger.error('API Error', {
      category: 'api',
      method,
      url,
      statusCode,
      error: error.message,
      stack: error.stack,
      ip,
      userId,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Log rate limit violations
   */
  logRateLimit: (ip, endpoint, userAgent) => {
    logger.warn('Rate Limit Exceeded', {
      category: 'api',
      event: 'rate_limit_exceeded',
      ip,
      endpoint,
      userAgent,
      timestamp: new Date().toISOString()
    });
  }
};

// Database logging
const dbLogger = {
  /**
   * Log database operations
   */
  logQuery: (query, duration, userId = null) => {
    if (process.env.LOG_QUERIES === 'true') {
      logger.debug('Database Query', {
        category: 'database',
        query,
        duration,
        userId,
        timestamp: new Date().toISOString()
      });
    }
  },

  /**
   * Log database errors
   */
  logError: (error, query, userId = null) => {
    logger.error('Database Error', {
      category: 'database',
      error: error.message,
      query,
      userId,
      timestamp: new Date().toISOString()
    });
  }
};

// Performance logging
const performanceLogger = {
  /**
   * Log performance metrics
   */
  logMetrics: (endpoint, duration, memoryUsage, cpuUsage) => {
    if (duration > 1000) { // Log slow requests (> 1 second)
      logger.warn('Slow Request', {
        category: 'performance',
        endpoint,
        duration,
        memoryUsage,
        cpuUsage,
        timestamp: new Date().toISOString()
      });
    }
  }
};

// Enhanced logger with additional methods
const enhancedLogger = Object.assign(logger, {
  security: securityLogger,
  api: apiLogger,
  db: dbLogger,
  performance: performanceLogger,

  /**
   * Create child logger with additional context
   */
  child: (meta) => {
    return logger.child(meta);
  },

  /**
   * Log with structured data
   */
  structured: (level, message, data) => {
    logger.log(level, message, data);
  }
});

module.exports = enhancedLogger;