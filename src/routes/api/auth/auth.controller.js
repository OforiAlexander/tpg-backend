// src/routes/api/auth/auth.controller.js - TPG Authentication Controller
const authService = require('../../../services/authService');
const recaptchaService = require('../../../services/recaptchaService');
const emailService = require('../../../services/emailService');
const User = require('../../../models/User');
const logger = require('../../../config/logger');
const { validateLogin, validateRegister, validatePasswordReset, validateChangePassword } = require('./auth.validation');

class AuthController {
  /**
   * User registration
   * POST /api/auth/register
   */
  async register(req, res) {
    try {
      // Validate input
      const { error, value } = validateRegister(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const { username, email, password, tpg_license_number, pharmacy_name, phone_number, address } = value;

      // Verify reCAPTCHA if enabled
      if (req.body.recaptchaToken) {
        try {
          await recaptchaService.verifyWithChecks(
            req.body.recaptchaToken,
            req.ip,
            req.get('User-Agent'),
            'register'
          );
        } catch (recaptchaError) {
          return res.status(400).json({
            error: 'reCAPTCHA verification failed',
            message: recaptchaError.message
          });
        }
      }

      // Register user
      const result = await authService.register({
        username,
        email,
        password,
        tpg_license_number,
        pharmacy_name,
        phone_number,
        address
      }, req.ip, req.get('User-Agent'));

      // Send verification email
      try {
        await emailService.sendWelcomeEmail(result.user, result.verificationToken);
      } catch (emailError) {
        logger.error('Failed to send welcome email:', emailError);
        // Don't fail registration if email fails
      }

      res.status(201).json({
        success: true,
        message: 'Registration successful. Please check your email for verification instructions.',
        user: result.user,
        requires_approval: true
      });
    } catch (error) {
      logger.error('Registration error:', error);
      
      if (error.message.includes('already exists')) {
        return res.status(409).json({
          error: 'Registration failed',
          message: error.message
        });
      }

      if (error.message.includes('@tpg.gov.gh')) {
        return res.status(400).json({
          error: 'Invalid email domain',
          message: error.message
        });
      }

      res.status(500).json({
        error: 'Registration failed',
        message: 'An unexpected error occurred during registration'
      });
    }
  }

  /**
   * User login
   * POST /api/auth/login
   */
  async login(req, res) {
    try {
      // Validate input
      const { error, value } = validateLogin(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { email, password, rememberMe } = value;

      // Verify reCAPTCHA if enabled
      if (req.body.recaptchaToken) {
        try {
          await recaptchaService.verifyWithChecks(
            req.body.recaptchaToken,
            req.ip,
            req.get('User-Agent'),
            'login'
          );
        } catch (recaptchaError) {
          return res.status(400).json({
            error: 'reCAPTCHA verification failed',
            message: recaptchaError.message
          });
        }
      }

      // Attempt login
      const result = await authService.login(
        email,
        password,
        req.ip,
        req.get('User-Agent')
      );

      // Set cookie options based on rememberMe
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000 // 7 days or 24 hours
      };

      // Set refresh token in cookie
      res.cookie('refreshToken', result.tokens.refreshToken, cookieOptions);

      res.json({
        success: true,
        message: 'Login successful',
        user: result.user,
        token: result.tokens.accessToken,
        expiresIn: result.tokens.expiresIn
      });
    } catch (error) {
      logger.error('Login error:', error);

      // Handle specific error types
      if (error.message.includes('Invalid email or password')) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid email or password'
        });
      }

      if (error.message.includes('locked')) {
        return res.status(423).json({
          error: 'Account locked',
          message: error.message
        });
      }

      if (error.message.includes('suspended') || error.message.includes('pending')) {
        return res.status(403).json({
          error: 'Account inactive',
          message: error.message
        });
      }

      res.status(500).json({
        error: 'Login failed',
        message: 'An unexpected error occurred during login'
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

      const result = await authService.refreshAccessToken(refreshToken);

      res.json({
        success: true,
        token: result.accessToken,
        expiresIn: result.expiresIn
      });
    } catch (error) {
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
   * GET /api/auth/verify
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
   * Request password reset
   * POST /api/auth/forgot-password
   */
  async forgotPassword(req, res) {
    try {
      // Validate input
      const { error, value } = validatePasswordReset(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { email } = value;

      // Verify reCAPTCHA if enabled
      if (req.body.recaptchaToken) {
        try {
          await recaptchaService.verifyWithChecks(
            req.body.recaptchaToken,
            req.ip,
            req.get('User-Agent'),
            'forgot_password'
          );
        } catch (recaptchaError) {
          return res.status(400).json({
            error: 'reCAPTCHA verification failed',
            message: recaptchaError.message
          });
        }
      }

      const result = await authService.requestPasswordReset(
        email,
        req.ip,
        req.get('User-Agent')
      );

      // Send password reset email
      if (result.resetToken) {
        try {
          const user = await User.findByEmail(email);
          if (user) {
            await emailService.sendPasswordResetEmail(user, result.resetToken);
          }
        } catch (emailError) {
          logger.error('Failed to send password reset email:', emailError);
        }
      }

      // Always return success for security (don't reveal if email exists)
      res.json({
        success: true,
        message: 'If an account with that email exists, password reset instructions have been sent.'
      });
    } catch (error) {
      logger.error('Password reset request error:', error);
      res.status(500).json({
        error: 'Password reset failed',
        message: 'An unexpected error occurred'
      });
    }
  }

  /**
   * Reset password with token
   * POST /api/auth/reset-password
   */
  async resetPassword(req, res) {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Reset token and new password are required'
        });
      }

      // Validate password strength
      if (password.length < 8) {
        return res.status(400).json({
          error: 'Weak password',
          message: 'Password must be at least 8 characters long'
        });
      }

      const result = await authService.resetPassword(
        token,
        password,
        req.ip,
        req.get('User-Agent')
      );

      res.json({
        success: true,
        message: 'Password reset successful. You can now login with your new password.',
        user: result.user
      });
    } catch (error) {
      logger.error('Password reset error:', error);
      res.status(400).json({
        error: 'Password reset failed',
        message: error.message
      });
    }
  }

  /**
   * Change password (for authenticated users)
   * POST /api/auth/change-password
   */
  async changePassword(req, res) {
    try {
      // Validate input
      const { error, value } = validateChangePassword(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { currentPassword, newPassword } = value;

      const result = await authService.changePassword(
        req.user.id,
        currentPassword,
        newPassword,
        req.ip,
        req.get('User-Agent')
      );

      res.json({
        success: true,
        message: 'Password changed successfully',
        user: result.user
      });
    } catch (error) {
      logger.error('Password change error:', error);
      
      if (error.message.includes('Current password is incorrect')) {
        return res.status(400).json({
          error: 'Invalid password',
          message: error.message
        });
      }

      res.status(500).json({
        error: 'Password change failed',
        message: 'An unexpected error occurred'
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

      logger.security.logDataAccess(
        req.user.id,
        'update',
        'profile',
        req.user.id,
        req.ip
      );

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
      const config = recaptchaService.getClientConfig();
      res.json({
        success: true,
        config
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