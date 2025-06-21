// src/middleware/auth.js - Enhanced TPG Authentication Middleware with Debug
const authService = require('../services/authService');
const User = require('../models/User');
const logger = require('../config/logger');

/**
 * Extract JWT token from request headers
 */
const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  
  // Debug: Log what we received
  if (process.env.NODE_ENV === 'development') {
    console.log('🔍 Auth Header Debug:', {
      authHeader: authHeader ? authHeader.substring(0, 20) + '...' : 'undefined',
      hasBearer: authHeader?.startsWith('Bearer '),
      queryToken: req.query.token ? 'present' : 'not present'
    });
  }
  
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
    
    // Debug: Log token extraction result
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Token Debug:', {
        tokenPresent: !!token,
        tokenLength: token ? token.length : 0,
        tokenStart: token ? token.substring(0, 10) + '...' : 'none'
      });
    }
    
    if (!token) {
      logger.warn('Authentication failed: No token provided', {
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'No authentication token provided'
      });
    }

    // Verify token with better error handling
    let decoded;
    try {
      decoded = authService.verifyAccessToken(token);
      
      // Debug: Log decoded token info
      if (process.env.NODE_ENV === 'development') {
        console.log('🔍 Token Decoded:', {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role,
          exp: new Date(decoded.exp * 1000).toISOString()
        });
      }
    } catch (tokenError) {
      logger.security.logSuspiciousActivity('token_verification_failed', {
        error: tokenError.message,
        token: token.substring(0, 20) + '...'
      }, req.ip, req.get('User-Agent'));
      
      return res.status(401).json({
        success: false,
        error: 'Authentication failed',
        message: 'Invalid or expired authentication token',
        debug: process.env.NODE_ENV === 'development' ? tokenError.message : undefined
      });
    }
    
    // Get user from database with better error handling
    let user;
    try {
      user = await User.query().findById(decoded.id);
      
      // Debug: Log user lookup result
      if (process.env.NODE_ENV === 'development') {
        console.log('🔍 User Lookup:', {
          userId: decoded.id,
          userFound: !!user,
          userStatus: user?.status,
          userRole: user?.role
        });
      }
    } catch (dbError) {
      logger.error('Database error during user lookup:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Unable to verify user credentials'
      });
    }
    
    if (!user) {
      logger.security.logSuspiciousActivity('token_with_nonexistent_user', {
        token_user_id: decoded.id,
        token_email: decoded.email
      }, req.ip, req.get('User-Agent'));
      
      return res.status(401).json({
        success: false,
        error: 'Authentication failed',
        message: 'Invalid authentication token - user not found'
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
        success: false,
        error: 'Account inactive',
        message: `Your account is ${user.status}`,
        userStatus: user.status
      });
    }

    // Check if account is locked (with safe method call)
    const isLocked = typeof user.isLocked === 'function' ? user.isLocked() : false;
    if (isLocked) {
      logger.security.logSuspiciousActivity('locked_user_token_usage', {
        user_id: user.id,
        email: user.email,
        locked_until: user.locked_until
      }, req.ip, req.get('User-Agent'));
      
      return res.status(401).json({
        success: false,
        error: 'Account locked',
        message: 'Your account is temporarily locked',
        lockedUntil: user.locked_until
      });
    }

    // Attach user to request
    req.user = user;
    req.token = token;
    
    // Debug: Log successful authentication
    if (process.env.NODE_ENV === 'development') {
      console.log('✅ Authentication Success:', {
        userId: user.id,
        email: user.email,
        role: user.role,
        status: user.status
      });
    }
    
    next();
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    logger.security.logSuspiciousActivity('authentication_error', {
      error: error.message,
      stack: error.stack,
      token: req.headers.authorization?.substring(0, 20) + '...'
    }, req.ip, req.get('User-Agent'));
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Authentication system error',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
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
        success: false,
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
        success: false,
        error: 'Insufficient permissions',
        message: 'You do not have permission to access this resource',
        requiredRoles: roles,
        userRole: req.user.role
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
        success: false,
        error: 'Authentication required',
        message: 'Please authenticate first'
      });
    }

    // Check if user has permission (with safe method call)
    const hasPermission = typeof req.user.hasPermission === 'function' 
      ? req.user.hasPermission(permission)
      : false;

    if (!hasPermission) {
      logger.security.logPermissionDenied(
        req.user.id,
        permission,
        req.originalUrl,
        req.ip,
        req.get('User-Agent')
      );
      
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: `You do not have permission to ${permission}`,
        requiredPermission: permission
      });
    }

    next();
  };
};

/**
 * Enhanced ticket access middleware for TPG
 */
const requireTicketAccess = (action = 'view') => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please authenticate first'
      });
    }

    const ticketId = req.params.id || req.params.ticketId;
    if (!ticketId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        message: 'Ticket ID is required'
      });
    }

    try {
      const Ticket = require('../models/Tickets');
      const ticket = await Ticket.query().findById(ticketId);
      
      // Debug: Log ticket lookup
      if (process.env.NODE_ENV === 'development') {
        console.log('🔍 Ticket Access Debug:', {
          ticketId,
          ticketFound: !!ticket,
          ticketUserId: ticket?.user_id,
          currentUserId: req.user.id,
          currentUserRole: req.user.role,
          action
        });
      }
      
      if (!ticket) {
        return res.status(404).json({
          success: false,
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      // Super admins and admins can access all tickets
      if (req.user.role === 'admin' || req.user.role === 'super_admin') {
        req.ticket = ticket;
        return next();
      }

      // Users can only access their own tickets OR tickets assigned to them
      const canAccess = ticket.user_id === req.user.id || ticket.assigned_to === req.user.id;
      
      if (!canAccess) {
        logger.security.logPermissionDenied(
          req.user.id,
          `ticket_${action}`,
          `ticket_${ticketId}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'You can only access your own tickets or tickets assigned to you',
          debug: process.env.NODE_ENV === 'development' ? {
            ticketUserId: ticket.user_id,
            ticketAssignedTo: ticket.assigned_to,
            currentUserId: req.user.id
          } : undefined
        });
      }

      req.ticket = ticket;
      next();
    } catch (error) {
      logger.error('Ticket access check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Unable to verify ticket access',
        debug: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
};

/**
 * Middleware to check resource ownership (user can only access their own resources)
 */
const requireOwnership = (userIdParam = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
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
        success: false,
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
    
    if (user && user.status === 'active') {
      const isLocked = typeof user.isLocked === 'function' ? user.isLocked() : false;
      if (!isLocked) {
        req.user = user;
        req.token = token;
      }
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
      success: false,
      error: 'Authentication required',
      message: 'Please authenticate first'
    });
  }

  if (!req.user.email_verified_at) {
    return res.status(403).json({
      success: false,
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
      success: false,
      error: 'Authentication required',
      message: 'Please authenticate first'
    });
  }

  const isLocked = typeof req.user.isLocked === 'function' ? req.user.isLocked() : false;
  if (isLocked) {
    return res.status(423).json({
      success: false,
      error: 'Account locked',
      message: 'Your account is temporarily locked',
      locked_until: req.user.locked_until
    });
  }

  next();
};

/**
 * Debug middleware to log authentication state
 */
const debugAuth = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    console.log('🔍 Auth State Debug:', {
      url: req.originalUrl,
      method: req.method,
      hasAuthHeader: !!req.headers.authorization,
      hasUser: !!req.user,
      userId: req.user?.id,
      userRole: req.user?.role,
      userStatus: req.user?.status
    });
  }
  next();
};

// Rate limiting middleware from security.js
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
  extractToken,
  debugAuth
};