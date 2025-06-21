// src/middleware/security.js - TPG Security Middleware
const rateLimit = require('express-rate-limit');
const logger = require('../config/logger');

/**
 * Validate incoming requests
 */
const validateRequest = (req, res, next) => {
  // Check for required headers
  if (!req.get('User-Agent')) {
    logger.security.logSuspiciousActivity('missing_user_agent', {
      url: req.originalUrl,
      method: req.method
    }, req.ip, '');
    
    return res.status(400).json({
      error: 'Bad Request',
      message: 'User-Agent header is required'
    });
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /(<script|javascript:|vbscript:|onload=|onerror=)/i,
    /(union\s+select|drop\s+table|delete\s+from)/i,
      /(\.\.\/|\.\.\\|etc\/passwd|cmd\.exe)/i
  ];

  const checkString = `${req.originalUrl} ${JSON.stringify(req.query)} ${JSON.stringify(req.body)}`;
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(checkString)) {
      logger.security.logSuspiciousActivity('malicious_pattern_detected', {
        pattern: pattern.toString(),
        url: req.originalUrl,
        method: req.method,
        query: req.query,
        body: req.body
      }, req.ip, req.get('User-Agent'));
      
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid request format'
      });
    }
  }

  next();
};

/**
 * Sanitize input data
 */
const sanitizeInput = (req, res, next) => {
  // Recursively sanitize object
  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      return value
        .replace(/[<>]/g, '') // Remove < and >
        .trim(); // Remove leading/trailing whitespace
    }
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map(sanitizeValue);
      }
      const sanitized = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = sanitizeValue(val);
      }
      return sanitized;
    }
    return value;
  };

  // Sanitize request body
  if (req.body) {
    req.body = sanitizeValue(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeValue(req.query);
  }

  next();
};

/**
 * Authentication rate limiting
 */
const authRateLimit = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS) || 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts',
    message: 'Please try again later',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.api.logRateLimit(req.ip, req.originalUrl, req.get('User-Agent'));
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Please try again later',
      retryAfter: '15 minutes'
    });
  }
});

/**
 * API rate limiting
 */
const apiRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'Please try again later',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.api.logRateLimit(req.ip, req.originalUrl, req.get('User-Agent'));
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please try again later',
      retryAfter: '15 minutes'
    });
  }
});

/**
 * Check if request is from allowed origin
 */
const checkOrigin = (req, res, next) => {
  const origin = req.get('Origin');
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');
  
  // Allow requests without origin (mobile apps, Postman, etc.)
  if (!origin) {
    return next();
  }
  
  if (!allowedOrigins.includes(origin)) {
    logger.security.logSuspiciousActivity('invalid_origin', {
      origin,
      allowedOrigins,
      url: req.originalUrl
    }, req.ip, req.get('User-Agent'));
    
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Request origin not allowed'
    });
  }
  
  next();
};

/**
 * Add security headers
 */
const addSecurityHeaders = (req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // XSS Protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove server signature
  res.removeHeader('X-Powered-By');
  
  next();
};

module.exports = {
  validateRequest,
  sanitizeInput,
  authRateLimit,
  apiRateLimit,
  checkOrigin,
  addSecurityHeaders
};