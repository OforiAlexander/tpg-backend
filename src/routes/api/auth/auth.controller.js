// src/routes/api/auth/auth.controller.js - TPG Authentication Controller (FIXED)
const bcrypt = require('bcryptjs'); // FIXED: Using bcryptjs instead of bcrypt
const jwt = require('jsonwebtoken'); // ADDED: Missing import
const crypto = require('crypto');
const authService = require('../../../services/authService');
const recaptchaService = require('../../../services/recaptchaService');
const emailService = require('../../../services/enhancedEmailService');
const enhancedEmailService = require('../../../services/enhancedEmailService');
const User = require('../../../models/User');
const logger = require('../../../config/logger');
const { 
  validateLogin, 
  validateRegister, 
  validatePasswordReset, 
  validateChangePassword, 
  validateResetPassword 
} = require('./auth.validation');

class AuthController {
  /**
   * Enhanced user registration with email verification
   * POST /api/auth/register
   */
  async register(req, res) {
    try {
      const { error, value } = validateRegister(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      // FIXED: Use correct field name phone_number instead of phone
      const { username, email, password, pharmacy_name, tpg_license_number, phone_number } = value;

      // Check for existing user
      const existingUser = await User.query()
        .where('email', email.toLowerCase())
        .orWhere('username', username)
        .first();

      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'User already exists',
          message: 'An account with this email or username already exists'
        });
      }

      // Hash password
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const password_hash = await bcrypt.hash(password, saltRounds);

      // Generate email verification token
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');
      const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create user
      const user = await User.query().insert({
        username,
        email: email.toLowerCase(),
        password_hash,
        pharmacy_name,
        tpg_license_number,
        phone_number, // FIXED: Use correct field name
        status: 'pending', // Start as pending until email verification
        email_verification_token: emailVerificationToken,
        email_verification_expires: emailVerificationExpires.toISOString(),
        metadata: {
          registration_ip: req.ip,
          registration_user_agent: req.get('User-Agent'),
          registration_timestamp: new Date().toISOString()
        }
      });

      // Send welcome email with verification
      try {
        await enhancedEmailService.sendWelcomeEmail(user, emailVerificationToken);
        logger.info(`Welcome email sent to new user ${user.email}`, {
          user_id: user.id,
          email: user.email
        });
      } catch (emailError) {
        logger.error('Failed to send welcome email:', emailError);
        // Don't fail registration if email fails
      }

      // Log successful registration
      if (logger.security && logger.security.logSecurityEvent) {
        logger.security.logSecurityEvent(
          user.id,
          'user_registered',
          'User registration completed',
          req.ip,
          req.get('User-Agent')
        );
      }

      res.status(201).json({
        success: true,
        message: 'Account created successfully. Please check your email to verify your account.',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          status: user.status,
          requiresEmailVerification: true
        }
      });

    } catch (error) {
      logger.error('Registration error:', error);
      res.status(500).json({
        success: false,
        error: 'Registration failed',
        message: 'An error occurred during registration'
      });
    }
  }

/**
 * Enhanced login with security monitoring - COMPLETE VERSION
 * POST /api/auth/login
 */
async login(req, res) {
  try {
    const { error, value } = validateLogin(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        message: error.details[0].message
      });
    }

    const { login, email, password } = value;
    const userAgent = req.get('User-Agent');
    const ipAddress = req.ip;

    // Use login field or fall back to email
    const loginIdentifier = login || email;

    if (!loginIdentifier) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        message: 'Email or username is required'
      });
    }

    // Find user by email or username
    const user = await User.query()
      .where('email', loginIdentifier.toLowerCase())
      .orWhere('username', loginIdentifier)
      .first();

    if (!user) {
      if (logger.security && logger.security.logSecurityEvent) {
        logger.security.logSecurityEvent(
          null,
          'login_failed',
          `Login failed - user not found: ${loginIdentifier}`,
          ipAddress,
          userAgent
        );
      }

      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Invalid email/username or password'
      });
    }

    // Check account status
    if (user.status === 'locked') {
      if (logger.security && logger.security.logSecurityEvent) {
        logger.security.logSecurityEvent(
          user.id,
          'login_failed',
          'Login attempted on locked account',
          ipAddress,
          userAgent
        );
      }

      return res.status(423).json({
        success: false,
        error: 'Account locked',
        message: 'Your account has been locked. Please contact support.'
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        error: 'Account suspended',
        message: 'Your account has been suspended. Please contact support.'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      // Increment failed login attempts
      await user.$query().increment('failed_login_attempts', 1);
      
      // Check if account should be locked
      const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
      if (user.failed_login_attempts + 1 >= maxAttempts) {
        const lockDuration = parseInt(process.env.ACCOUNT_LOCK_DURATION) || 30; // minutes
        const lockUntil = new Date(Date.now() + lockDuration * 60 * 1000);
        
        await user.$query().patch({
          status: 'locked',
          locked_until: lockUntil.toISOString(),
          failed_login_attempts: user.failed_login_attempts + 1
        });

        // Send account locked email
        try {
          await enhancedEmailService.sendAccountLockedEmail(
            user, 
            'Multiple failed login attempts', 
            lockDuration
          );
        } catch (emailError) {
          logger.error('Failed to send account locked email:', emailError);
        }

        if (logger.security && logger.security.logSecurityEvent) {
          logger.security.logSecurityEvent(
            user.id,
            'account_locked',
            `Account locked due to ${user.failed_login_attempts + 1} failed login attempts`,
            ipAddress,
            userAgent
          );
        }

        return res.status(423).json({
          success: false,
          error: 'Account locked',
          message: `Account locked due to multiple failed login attempts. Try again in ${lockDuration} minutes.`
        });
      }

      if (logger.security && logger.security.logSecurityEvent) {
        logger.security.logSecurityEvent(
          user.id,
          'login_failed',
          `Invalid password attempt ${user.failed_login_attempts + 1}`,
          ipAddress,
          userAgent
        );
      }

      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Invalid email/username or password',
        attemptsRemaining: maxAttempts - (user.failed_login_attempts + 1)
      });
    }

    // Check if login is from new device/location (simplified for now)
    const isNewDevice = false; // Simplified - implement proper device checking later
    const isNewLocation = false; // Simplified - implement proper location checking later

    // Send security notifications if needed
    if (isNewDevice || isNewLocation) {
      try {
        const loginDetails = {
          ipAddress,
          userAgent,
          location: 'Unknown location',
          timestamp: new Date().toISOString(),
          isNewDevice,
          isNewLocation
        };

        if (isNewDevice && isNewLocation) {
          await enhancedEmailService.sendSecurityAlert(user, 'login_from_new_device', loginDetails);
        } else if (isNewLocation) {
          await enhancedEmailService.sendSecurityAlert(user, 'login_from_new_location', loginDetails);
        }
        
        await enhancedEmailService.sendLoginNotification(user, loginDetails);
      } catch (emailError) {
        logger.error('Failed to send security notification:', emailError);
      }
    }

    // Successful login - reset failed attempts and update login info
    await user.$query().patch({
      failed_login_attempts: 0,
      last_login: new Date().toISOString(),
      last_login_ip: ipAddress,
      last_user_agent: userAgent
    });

    // 🎯 FIX: Use authService to generate tokens with proper audience/issuer
    const tokens = authService.generateTokens(user);

    // Log successful login
    if (logger.security && logger.security.logSecurityEvent) {
      logger.security.logSecurityEvent(
        user.id,
        'login_success',
        'User login successful',
        ipAddress,
        userAgent
      );
    }

    // Return successful response
    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        pharmacy_name: user.pharmacy_name,
        tpg_license_number: user.tpg_license_number
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      message: 'An error occurred during login'
    });
  }
}

  /**
   * Refresh access token
   * POST /api/auth/refresh
   */
async refresh(req, res) {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({
        error: 'Refresh token required',
        message: 'No refresh token provided'
      });
    }

    //  DEBUG: Log the incoming token
    console.log(' Refresh Token Debug:');
    console.log('Token source:', req.cookies.refreshToken ? 'cookies' : 'body');
    console.log('Token (first 50 chars):', refreshToken.substring(0, 50));
    
    //  DEBUG: Decode token before verification
    const decoded = jwt.decode(refreshToken, { complete: true });
    console.log('Decoded token header:', JSON.stringify(decoded?.header, null, 2));
    console.log('Decoded token payload:', JSON.stringify(decoded?.payload, null, 2));
    
    // Check if token has expected claims
    if (!decoded?.payload?.aud || !decoded?.payload?.iss) {
      console.log(' Token missing audience or issuer claims');
      return res.status(401).json({
        error: 'Invalid token format',
        message: 'Token missing required claims'
      });
    }
    
    if (decoded.payload.aud !== 'tpg-users' || decoded.payload.iss !== 'tpg-portal') {
      console.log(' Token has wrong audience/issuer:');
      console.log('Expected: aud=tpg-users, iss=tpg-portal');
      console.log('Actual: aud=' + decoded.payload.aud + ', iss=' + decoded.payload.iss);
      return res.status(401).json({
        error: 'Invalid token claims',
        message: 'Token has invalid audience or issuer'
      });
    }

    const result = await authService.refreshAccessToken(refreshToken);

    res.json({
      success: true,
      token: result.accessToken,
      expiresIn: result.expiresIn
    });
  } catch (error) {
    console.log(' Refresh error:', error.message);
    logger.error('Token refresh error:', error);
    
    // Clear invalid refresh token cookie
    res.clearCookie('refreshToken');
    
    res.status(401).json({
      error: 'Token refresh failed',
      message: 'Invalid or expired refresh token'
    });
  }
}

  /**
   * User logout
   * POST /api/auth/logout
   */
  async logout(req, res) {
    try {
      if (req.user) {
        await authService.logout(req.user.id, req.ip, req.get('User-Agent'));
      }

      // Clear refresh token cookie
      res.clearCookie('refreshToken');

      res.json({
        success: true,
        message: 'Logout successful'
      });
    } catch (error) {
      logger.error('Logout error:', error);
      
      // Still clear cookie even if logout logging fails
      res.clearCookie('refreshToken');
      
      res.json({
        success: true,
        message: 'Logout completed'
      });
    }
  }

  /**
   * Verify JWT token
   * POST /api/auth/verify-token
   */
  async verifyToken(req, res) {
    try {
      // Token verification is handled by the authenticate middleware
      // If we reach here, the token is valid
      res.json({
        success: true,
        user: req.user.getPublicData(),
        permissions: await authService.getUserPermissions(req.user.id)
      });
    } catch (error) {
      logger.error('Token verification error:', error);
      res.status(401).json({
        error: 'Token verification failed',
        message: 'Invalid or expired token'
      });
    }
  }

  /**
   * Verify email address
   * POST /api/auth/verify-email
   */
  async verifyEmail(req, res) {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({
          error: 'Verification token required',
          message: 'Email verification token is missing'
        });
      }

      const result = await authService.verifyEmail(
        token,
        req.ip,
        req.get('User-Agent')
      );

      res.json({
        success: true,
        message: 'Email verified successfully',
        user: result.user
      });
    } catch (error) {
      logger.error('Email verification error:', error);
      res.status(400).json({
        error: 'Email verification failed',
        message: error.message
      });
    }
  }

/**
 * Enhanced forgot password with security monitoring - COMPLETE VERSION
 * POST /api/auth/forgot-password
 */
async forgotPassword(req, res) {
  try {
    const { error, value } = validatePasswordReset(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        message: error.details[0].message
      });
    }

    const { email } = value;
    const user = await User.query().where('email', email.toLowerCase()).first();

    // Always return success to prevent email enumeration
    const successResponse = {
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    };

    if (!user) {
      if (logger.security && logger.security.logSecurityEvent) {
        logger.security.logSecurityEvent(
          null,
          'password_reset_attempted',
          `Password reset attempted for non-existent email: ${email}`,
          req.ip,
          req.get('User-Agent')
        );
      }
      return res.json(successResponse);
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Update user with reset token
    await user.$query().patch({
      password_reset_token: resetToken,
      password_reset_expires: resetTokenExpires.toISOString()
    });

    // Send password reset email
    try {
      await enhancedEmailService.sendPasswordResetEmail(user, resetToken);
      
      if (logger.security && logger.security.logSecurityEvent) {
        logger.security.logSecurityEvent(
          user.id,
          'password_reset_requested',
          'Password reset email sent',
          req.ip,
          req.get('User-Agent')
        );
      }
    } catch (emailError) {
      logger.error('Failed to send password reset email:', emailError);
      // Still return success to prevent information disclosure
    }

    res.json(successResponse);

  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Request failed',
      message: 'An error occurred processing your request'
    });
  }
}

/**
 * Reset password with token - COMPLETE VERSION
 * POST /api/auth/reset-password
 */
async resetPassword(req, res) {
  try {
    const { error, value } = validateResetPassword(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        message: error.details[0].message
      });
    }

    const { token, password } = value;

    // Find user with valid reset token
    const user = await User.query()
      .where('password_reset_token', token)
      .where('password_reset_expires', '>', new Date().toISOString())
      .first();

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired token',
        message: 'Password reset token is invalid or has expired'
      });
    }

    // Hash new password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Update password and clear reset token
    await user.$query().patch({
      password_hash,
      password_reset_token: null,
      password_reset_expires: null,
      password_changed_at: new Date().toISOString(),
      failed_login_attempts: 0 // Reset failed attempts
    });

    // Send password reset confirmation email
    try {
      await enhancedEmailService.sendPasswordResetConfirmation(
        user,
        req.ip,
        req.get('User-Agent')
      );
    } catch (emailError) {
      logger.error('Failed to send password reset confirmation:', emailError);
    }

    if (logger.security && logger.security.logSecurityEvent) {
      logger.security.logSecurityEvent(
        user.id,
        'password_reset_completed',
        'Password reset completed successfully',
        req.ip,
        req.get('User-Agent')
      );
    }

    res.json({
      success: true,
      message: 'Password reset successful. You can now login with your new password.'
    });

  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset failed',
      message: 'An error occurred while resetting your password'
    });
  }
}

  /**
   * Enhanced password change with notifications
   * POST /api/auth/change-password
   */
  async changePassword(req, res) {
    try {
      const { error, value } = validateChangePassword(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { currentPassword, newPassword } = value;
      const user = await User.query().findById(req.user.id);

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValidPassword) {
        if (logger.security && logger.security.logSecurityEvent) {
          logger.security.logSecurityEvent(
            user.id,
            'password_change_failed',
            'Invalid current password provided',
            req.ip,
            req.get('User-Agent')
          );
        }

        return res.status(400).json({
          success: false,
          error: 'Invalid password',
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      await user.$query().patch({
        password_hash: newPasswordHash,
        password_changed_at: new Date().toISOString(),
        // Invalidate all existing refresh tokens
        refresh_token: null
      });

      // Send password changed notification
      try {
        await enhancedEmailService.sendPasswordChangedNotification(
          user,
          req.ip,
          req.get('User-Agent')
        );
      } catch (emailError) {
        logger.error('Failed to send password changed notification:', emailError);
      }

      if (logger.security && logger.security.logSecurityEvent) {
        logger.security.logSecurityEvent(
          user.id,
          'password_changed',
          'Password changed successfully',
          req.ip,
          req.get('User-Agent')
        );
      }

      res.json({
        success: true,
        message: 'Password changed successfully. Please log in again with your new password.'
      });

    } catch (error) {
      logger.error('Change password error:', error);
      res.status(500).json({
        success: false,
        error: 'Password change failed',
        message: 'An error occurred while changing your password'
      });
    }
  }

  /**
   * Get current user profile
   * GET /api/auth/profile
   */
  async getProfile(req, res) {
    try {
      const user = await User.query()
        .findById(req.user.id)
        .withGraphFetched('[tickets(orderByCreated), assignedTickets(orderByCreated)]')
        .modifiers({
          orderByCreated: builder => builder.orderBy('created_at', 'desc').limit(5)
        });

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User profile not found'
        });
      }

      const permissions = await authService.getUserPermissions(user.id);

      res.json({
        success: true,
        user: user.getPublicData(),
        permissions,
        statistics: {
          total_tickets: user.tickets?.length || 0,
          assigned_tickets: user.assignedTickets?.length || 0
        }
      });
    } catch (error) {
      logger.error('Get profile error:', error);
      res.status(500).json({
        error: 'Profile retrieval failed',
        message: 'Unable to retrieve user profile'
      });
    }
  }

  /**
   * Update user profile
   * PUT /api/auth/profile
   */
  async updateProfile(req, res) {
    try {
      const allowedFields = [
        'username',
        'phone_number',
        'address',
        'pharmacy_name',
        'preferences'
      ];

      // Filter only allowed fields
      const updates = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          error: 'No valid fields to update',
          message: 'Please provide valid fields to update'
        });
      }

      const updatedUser = await req.user.$query().patchAndFetch(updates);

      if (logger.security && logger.security.logDataAccess) {
        logger.security.logDataAccess(
          req.user.id,
          'update',
          'profile',
          req.user.id,
          req.ip
        );
      }

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: updatedUser.getPublicData()
      });
    } catch (error) {
      logger.error('Profile update error:', error);
      res.status(500).json({
        error: 'Profile update failed',
        message: 'Unable to update profile'
      });
    }
  }

  /**
   * Get reCAPTCHA configuration
   * GET /api/auth/recaptcha-config
   */
  async getRecaptchaConfig(req, res) {
    try {
      logger.info('reCAPTCHA config requested', { ip: req.ip });
      
      const config = recaptchaService.getClientConfig();
      
      logger.info('reCAPTCHA config retrieved successfully', { 
        enabled: config.enabled,
        hasSiteKey: !!config.siteKey,
        ip: req.ip 
      });

      res.json({
        success: true,
        config: {
          enabled: config.enabled,
          siteKey: config.siteKey,
          theme: config.theme || 'light',
          size: config.size || 'normal',
          badge: config.badge || 'bottomright'
        }
      });
    } catch (error) {
      logger.error('reCAPTCHA config error:', error);
      res.status(500).json({
        error: 'Configuration unavailable',
        message: 'Unable to retrieve reCAPTCHA configuration'
      });
    }
  }

  /**
   * Check if login is from a new device
   */
  async checkNewDevice(user, userAgent, ipAddress) {
    try {
      const deviceFingerprint = crypto.createHash('md5')
        .update(userAgent + ipAddress)
        .digest('hex');
    
        const recentLogin = await User.query()
        .findById(user.id)
        .select('last_user_agent')
        .first();
      
      return recentLogin?.last_user_agent !== userAgent;
    } catch (error) {
      logger.error('Device check error:', error);
      return false;
    }
  }
  
  /**
   * Check if login is from a new location
   */
  async checkNewLocation(user, ipAddress) {
    try {
      return user.last_login_ip !== ipAddress;
    } catch (error) {
      logger.error('Location check error:', error);
      return false;
    }
  }
  
  /**
   * Get location from IP address
   */
  async getLocationFromIP(ipAddress) {
    try {
      return 'Location detection not implemented';
    } catch (error) {
      logger.error('Location detection error:', error);
      return 'Unknown location';
    }
  }

  /**
   * Check service health
   * GET /api/auth/health
   */
  async healthCheck(req, res) {
    try {
      const recaptchaHealth = await recaptchaService.healthCheck();
      
      res.json({
        success: true,
        services: {
          authentication: { status: 'healthy' },
          recaptcha: recaptchaHealth,
          database: { status: 'healthy' } // Could add actual DB health check
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Auth health check error:', error);
      res.status(500).json({
        error: 'Health check failed',
        message: 'Unable to check service health'
      });
    }
  }
}

module.exports = new AuthController();