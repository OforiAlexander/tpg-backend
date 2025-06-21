// src/config/logger.js - TPG Logging Configuration (Fixed)
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
try {
  require('fs').mkdirSync(logsDir, { recursive: true });
} catch (error) {
  console.error('Failed to create logs directory:', error.message);
}

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
      level: process.env.LOG_LEVEL || 'debug'
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

// Create the base Winston logger
const baseLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: {
    service: 'tpg-backend',
    version: process.env.APP_VERSION || '1.0.0',
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
    try {
      baseLogger.info('Authentication Event', {
        category: 'security',
        event,
        email,
        ip,
        userAgent,
        success,
        timestamp: new Date().toISOString(),
        ...details
      });
    } catch (error) {
      console.error('Logger Error (Auth):', error.message);
    }
  },

  /**
   * Log permission violations
   */
  logPermissionDenied: (userId, action, resource, ip, userAgent) => {
    try {
      baseLogger.warn('Permission Denied', {
        category: 'security',
        event: 'permission_denied',
        userId,
        action,
        resource,
        ip,
        userAgent,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Logger Error (Permission):', error.message);
    }
  },

  /**
   * Log suspicious activities
   */
  logSuspiciousActivity: (event, details, ip, userAgent) => {
    try {
      baseLogger.warn('Suspicious Activity', {
        category: 'security',
        event: 'suspicious_activity',
        activity: event,
        details,
        ip,
        userAgent,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Logger Error (Suspicious):', error.message);
    }
  },

  /**
   * Log data access events
   */
  logDataAccess: (userId, action, resource, resourceId, ip) => {
    try {
      baseLogger.info('Data Access', {
        category: 'security',
        event: 'data_access',
        userId,
        action,
        resource,
        resourceId,
        ip,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Logger Error (Data Access):', error.message);
    }
  },

  /**
   * Log administrative actions
   */
  logAdminAction: (adminId, action, target, details, ip) => {
    try {
      baseLogger.info('Admin Action', {
        category: 'security',
        event: 'admin_action',
        adminId,
        action,
        target,
        details,
        ip,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Logger Error (Admin):', error.message);
    }
  }
};

// API request logging
const apiLogger = {
  /**
   * Log API requests
   */
  logRequest: (method, url, ip, userAgent, userId = null, duration = null) => {
    try {
      baseLogger.info('API Request', {
        category: 'api',
        method,
        url,
        ip,
        userAgent,
        userId,
        duration,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Logger Error (API Request):', error.message);
    }
  },

  /**
   * Log API errors
   */
  logError: (method, url, statusCode, error, ip, userId = null) => {
    try {
      baseLogger.error('API Error', {
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
    } catch (loggerError) {
      console.error('Logger Error (API Error):', loggerError.message);
    }
  },

  /**
   * Log rate limit violations
   */
  logRateLimit: (ip, endpoint, userAgent) => {
    try {
      baseLogger.warn('Rate Limit Exceeded', {
        category: 'api',
        event: 'rate_limit_exceeded',
        ip,
        endpoint,
        userAgent,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Logger Error (Rate Limit):', error.message);
    }
  }
};

// Database logging
const dbLogger = {
  /**
   * Log database operations
   */
  logQuery: (query, duration, userId = null) => {
    try {
      if (process.env.LOG_QUERIES === 'true') {
        baseLogger.debug('Database Query', {
          category: 'database',
          query: typeof query === 'string' ? query : JSON.stringify(query),
          duration,
          userId,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Logger Error (DB Query):', error.message);
    }
  },

  /**
   * Log database errors
   */
  logError: (error, query, userId = null) => {
    try {
      baseLogger.error('Database Error', {
        category: 'database',
        error: error.message,
        query: typeof query === 'string' ? query : JSON.stringify(query),
        userId,
        timestamp: new Date().toISOString()
      });
    } catch (loggerError) {
      console.error('Logger Error (DB Error):', loggerError.message);
    }
  }
};

// Performance logging
const performanceLogger = {
  /**
   * Log performance metrics
   */
  logMetrics: (endpoint, duration, memoryUsage = null, cpuUsage = null) => {
    try {
      const threshold = parseInt(process.env.SLOW_REQUEST_THRESHOLD) || 1000;
      if (duration > threshold) { // Log slow requests
        baseLogger.warn('Slow Request', {
          category: 'performance',
          endpoint,
          duration,
          memoryUsage,
          cpuUsage,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Logger Error (Performance):', error.message);
    }
  },

  /**
   * Log memory usage
   */
  logMemoryUsage: (context = 'general') => {
    try {
      if (process.env.LOG_MEMORY === 'true') {
        const memUsage = process.memoryUsage();
        baseLogger.info('Memory Usage', {
          category: 'performance',
          context,
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
          external: Math.round(memUsage.external / 1024 / 1024) + ' MB',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Logger Error (Memory):', error.message);
    }
  }
};

// Enhanced logger with all methods - FIXED VERSION
class EnhancedLogger {
  constructor(winstonLogger) {
    this.logger = winstonLogger;
    this.security = securityLogger;
    this.api = apiLogger;
    this.db = dbLogger;
    this.performance = performanceLogger;
  }

  // Winston logger methods
  info(message, meta = {}) {
    try {
      this.logger.info(message, meta);
    } catch (error) {
      console.error('Logger Error (Info):', error.message);
    }
  }

  error(message, meta = {}) {
    try {
      this.logger.error(message, meta);
    } catch (error) {
      console.error('Logger Error (Error):', error.message);
    }
  }

  warn(message, meta = {}) {
    try {
      this.logger.warn(message, meta);
    } catch (error) {
      console.error('Logger Error (Warn):', error.message);
    }
  }

  debug(message, meta = {}) {
    try {
      this.logger.debug(message, meta);
    } catch (error) {
      console.error('Logger Error (Debug):', error.message);
    }
  }

  log(level, message, meta = {}) {
    try {
      this.logger.log(level, message, meta);
    } catch (error) {
      console.error('Logger Error (Log):', error.message);
    }
  }

  /**
   * Create child logger with additional context
   * FIXED: No more infinite recursion
   */
  child(meta = {}) {
    try {
      const childLogger = this.logger.child(meta);
      return new EnhancedLogger(childLogger);
    } catch (error) {
      console.error('Logger Error (Child):', error.message);
      return this; // Return self as fallback
    }
  }

  /**
   * Log with structured data
   */
  structured(level, message, data) {
    try {
      this.logger.log(level, message, data);
    } catch (error) {
      console.error('Logger Error (Structured):', error.message);
    }
  }

  /**
   * Add request context to logger
   */
  withRequest(req) {
    return this.child({
      requestId: req.id || req.headers['x-request-id'],
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      method: req.method,
      url: req.originalUrl || req.url
    });
  }

  /**
   * Add user context to logger
   */
  withUser(userId, userEmail = null) {
    return this.child({
      userId,
      userEmail
    });
  }
}

// Create and export the enhanced logger instance
const logger = new EnhancedLogger(baseLogger);

// Development logging helpers
if (process.env.NODE_ENV === 'development') {
  logger.development = {
    logRequest: (req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.debug(`${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
      });
      next();
    }
  };
}

module.exports = logger;