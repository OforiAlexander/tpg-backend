// src/middleware/audit.js - TPG Audit Middleware
const logger = require('../config/logger');

/**
 * Log all incoming requests
 */
const logRequest = (req, res, next) => {
  const startTime = Date.now();
  
  // Skip logging for health checks and static files
  const skipPaths = ['/health', '/favicon.ico', '/uploads'];
  const shouldSkip = skipPaths.some(path => req.path.startsWith(path));
  
  if (!shouldSkip) {
    logger.api.logRequest(
      req.method,
      req.originalUrl,
      req.ip,
      req.get('User-Agent'),
      req.user?.id || null
    );
  }
  
  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    if (!shouldSkip) {
      logger.api.logRequest(
        req.method,
        req.originalUrl,
        req.ip,
        req.get('User-Agent'),
        req.user?.id || null,
        duration
      );
      
      // Log slow requests
      if (duration > 1000) {
        logger.performance.logMetrics(
          req.originalUrl,
          duration,
          process.memoryUsage(),
          process.cpuUsage()
        );
      }
      
      // Log errors
      if (res.statusCode >= 400) {
        logger.api.logError(
          req.method,
          req.originalUrl,
          res.statusCode,
          new Error(`HTTP ${res.statusCode}`),
          req.ip,
          req.user?.id || null
        );
      }
    }
  });
  
  next();
};

/**
 * Log authentication events
 */
const logAuthEvent = (event, email, ip, userAgent, success = true, details = {}) => {
  logger.security.logAuth(event, email, ip, userAgent, success, details);
};

/**
 * Log data access events
 */
const logDataAccess = (userId, action, resource, resourceId, req) => {
  logger.security.logDataAccess(
    userId,
    action,
    resource,
    resourceId,
    req.ip
  );
};

/**
 * Log administrative actions
 */
const logAdminAction = (adminId, action, target, details, req) => {
  logger.security.logAdminAction(
    adminId,
    action,
    target,
    details,
    req.ip
  );
};

/**
 * Middleware to audit user actions
 */
const auditUserAction = (action) => {
  return (req, res, next) => {
    // Store audit info for later use
    req.auditAction = action;
    req.auditStartTime = Date.now();
    
    // Override res.json to capture response data
    const originalJson = res.json;
    res.json = function(data) {
      // Log the action after successful response
      if (res.statusCode < 400 && req.user) {
        const resourceType = req.route?.path?.split('/')[1] || 'unknown';
        const resourceId = req.params?.id || req.body?.id || 'unknown';
        
        logDataAccess(
          req.user.id,
          action,
          resourceType,
          resourceId,
          req
        );
      }
      
      return originalJson.call(this, data);
    };
    
    next();
  };
};

/**
 * Log security events
 */
const logSecurityEvent = (eventType, userId, details, req) => {
  // This would typically save to the security_events table
  // For now, just log it
  logger.security.logSuspiciousActivity(eventType, details, req.ip, req.get('User-Agent'));
};

/**
 * Middleware to track request context
 */
const trackRequestContext = (req, res, next) => {
  // Add request tracking ID
  req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Add request context to logger
  req.logger = logger.child({
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    method: req.method,
    url: req.originalUrl
  });
  
  next();
};

/**
 * Middleware to audit database changes
 */
const auditDatabaseChange = (operation) => {
  return (req, res, next) => {
    // Store original values for comparison
    req.auditOperation = operation;
    
    // This will be used by database models to log changes
    next();
  };
};

module.exports = {
  logRequest,
  logAuthEvent,
  logDataAccess,
  logAdminAction,
  auditUserAction,
  logSecurityEvent,
  trackRequestContext,
  auditDatabaseChange
};