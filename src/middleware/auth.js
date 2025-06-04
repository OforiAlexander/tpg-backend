// src/middleware/auth.js - TPG Authentication Middleware
const authService = require('../services/authService');
const User = require('../models/User');
const logger = require('../config/logger');

/**
 * Extract JWT token from request headers
 */
const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Also check query parameter (for file downloads, etc.)
  if (req.query.token) {
    return req.query.token;
  }
  
  return null;
};

/**
 * Middleware to authenticate JWT token
 */
const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'No authentication token provided'
      });
    }

    // Verify token
    const decoded = authService.verifyAccessToken(token);
    
    // Get user from database
    const user = await User.query().findById(decoded.id);
    if (!user) {
      logger.security.logSuspiciousActivity('token_with_nonexistent_user', {
        token_user_id: decoded.id,
        token_email: decoded.email
      }, req.ip, req.get('User-Agent'));
      
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid authentication token'
      });
    }

    // Check if user account is still active
    if (user.status !== 'active') {
      logger.security.logSuspiciousActivity('inactive_user_token_usage', {
        user_id: user.id,
        user_status: user.status,
        email: user.email
      }, req.ip, req.get('User-Agent'));
      
      return res.status(401).json({
        error: 'Account inactive',
        message: 'Your account is not active'
      });
    }

    // Check if account is locked
    if (user.isLocked()) {
      logger.security.logSuspiciousActivity('locked_user_token_usage', {
        user_id: user.id,
        email: user.email,
        locked_until: user.locked_until
      }, req.ip, req.get('User-Agent'));
      
      return res.status(401).json({
        error: 'Account locked',
        message: 'Your account is temporarily locked'
      });
    }

    // Attach user to request
    req.user = user;
    req.token = token;
    
    next();
  } catch (error) {
    logger.security.logSuspiciousActivity('invalid_token_usage', {
      error: error.message,
      token: req.headers.authorization?.substring(0, 20) + '...'
    }, req.ip, req.get('User-Agent'));
    
    return res.status(401).json({
      error: 'Authentication failed',
      message: 'Invalid or expired authentication token'
    });
  }
};

/**
 * Middleware to check if user has required role
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate first'
      });
    }

    if (!roles.includes(req.user.role)) {
      logger.security.logPermissionDenied(
        req.user.id,
        `access_with_role_${req.user.role}`,
        req.originalUrl,
        req.ip,
        req.get('User-Agent')
      );
      
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have permission to access this resource'
      });
    }

    next();
  };
};

/**
 * Middleware to check if user has required permission
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate first'
      });
    }

    if (!req.user.hasPermission(permission)) {
      logger.security.logPermissionDenied(
        req.user.id,
        permission,
        req.originalUrl,
        req.ip,
        req.get('User-Agent')
      );
      
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `You do not have permission to ${permission}`
      });
    }

    next();
  };
};

/**
 * Middleware to check resource ownership (user can only access their own resources)
 */
const requireOwnership = (userIdParam = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate first'
      });
    }

    // Get user ID from request parameters
    const resourceUserId = req.params[userIdParam] || req.body[userIdParam];
    
    // Admins can access any resource
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      return next();
    }

    // Check if user owns the resource
    if (resourceUserId !== req.user.id) {
      logger.security.logPermissionDenied(
        req.user.id,
        'access_other_user_resource',
        req.originalUrl,
        req.ip,
        req.get('User-Agent')
      );
      
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only access your own resources'
      });
    }

    next();
  };
};

/**
 * Optional authentication - attaches user if token is present but doesn't fail if missing
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return next(); // No token, continue without user
    }

    const decoded = authService.verifyAccessToken(token);
    const user = await User.query().findById(decoded.id);
    
    if (user && user.status === 'active' && !user.isLocked()) {
      req.user = user;
      req.token = token;
    }
    
    next();
  } catch (error) {
    // Token is invalid, but we don't fail - just continue without user
    next();
  }
};

/**
 * Middleware to check email verification status
 */
const requireEmailVerification = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please authenticate first'
    });
  }

  if (!req.user.email_verified_at) {
    return res.status(403).json({
      error: 'Email verification required',
      message: 'Please verify your email address to access this resource'
    });
  }

  next();
};

/**
 * Middleware to ensure user is not locked
 */
const requireUnlocked = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please authenticate first'
    });
  }

  if (req.user.isLocked()) {
    return res.status(423).json({
      error: 'Account locked',
      message: 'Your account is temporarily locked',
      locked_until: req.user.locked_until
    });
  }

  next();
};

/**
 * Middleware to check if user can perform action on specific ticket
 */
const requireTicketAccess = (action = 'view') => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate first'
      });
    }

    const ticketId = req.params.id || req.params.ticketId;
    if (!ticketId) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Ticket ID is required'
      });
    }

    try {
      const Ticket = require('../models/Ticket');
      const ticket = await Ticket.query().findById(ticketId);
      
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      // Admins can access all tickets
      if (req.user.role === 'admin' || req.user.role === 'super_admin') {
        req.ticket = ticket;
        return next();
      }

      // Users can only access their own tickets
      if (ticket.user_id !== req.user.id) {
        logger.security.logPermissionDenied(
          req.user.id,
          `ticket_${action}`,
          `ticket_${ticketId}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only access your own tickets'
        });
      }

      req.ticket = ticket;
      next();
    } catch (error) {
      logger.error('Ticket access check error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Unable to verify ticket access'
      });
    }
  };
};

/**
 * Rate limiting middleware for authentication endpoints
 */
const authRateLimit = require('./security').authRateLimit;

module.exports = {
  authenticate,
  requireRole,
  requirePermission,
  requireOwnership,
  optionalAuth,
  requireEmailVerification,
  requireUnlocked,
  requireTicketAccess,
  authRateLimit,
  extractToken
};