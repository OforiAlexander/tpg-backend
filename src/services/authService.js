// src/services/authService.js - TPG Authentication Service
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const logger = require('../config/logger');

class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET;
    this.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
    this.jwtRefreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

    if (!this.jwtSecret || !this.jwtRefreshSecret) {
      throw new Error('JWT secrets are required. Please set JWT_SECRET and JWT_REFRESH_SECRET environment variables.');
    }
  }

  /**
   * Generate JWT access token
   */
  generateAccessToken(user) {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      type: 'access'
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn,
      issuer: 'tpg-portal',
      audience: 'tpg-users'
    });
  }

  /**
   * Generate JWT refresh token
   */
  generateRefreshToken(user) {
    const payload = {
      id: user.id,
      email: user.email,
      type: 'refresh',
      tokenId: crypto.randomBytes(16).toString('hex')
    };

    return jwt.sign(payload, this.jwtRefreshSecret, {
      expiresIn: this.jwtRefreshExpiresIn,
      issuer: 'tpg-portal',
      audience: 'tpg-users'
    });
  }

  /**
   * Generate both access and refresh tokens
   */
  generateTokens(user) {
    return {
      accessToken: this.generateAccessToken(user),
      refreshToken: this.generateRefreshToken(user),
      expiresIn: this.jwtExpiresIn
    };
  }

  /**
   * Verify JWT access token
   */
  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'tpg-portal',
        audience: 'tpg-users'
      });

      if (decoded.type !== 'access') {
        throw new Error('Invalid token type');
      }

      return decoded;
    } catch (error) {
      logger.security.logSuspiciousActivity('invalid_token', {
        error: error.message,
        token: token.substring(0, 20) + '...'
      }, null, null);
      throw error;
    }
  }

  /**
   * Verify JWT refresh token
   */
  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtRefreshSecret, {
        issuer: 'tpg-portal',
        audience: 'tpg-users'
      });

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      return decoded;
    } catch (error) {
      logger.security.logSuspiciousActivity('invalid_refresh_token', {
        error: error.message
      }, null, null);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const decoded = this.verifyRefreshToken(refreshToken);
      
      // Get current user data
      const user = await User.query().findById(decoded.id);
      if (!user) {
        throw new Error('User not found');
      }

      if (user.status !== 'active') {
        throw new Error('User account is not active');
      }

      // Generate new access token
      const newAccessToken = this.generateAccessToken(user);

      logger.security.logAuth('token_refreshed', user.email, null, null, true);

      return {
        accessToken: newAccessToken,
        expiresIn: this.jwtExpiresIn
      };
    } catch (error) {
      logger.security.logAuth('token_refresh_failed', null, null, null, false, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Register new user
   */
  async register(userData, ip, userAgent) {
    try {
      // Validate TPG email domain
      if (!this.isValidTPGEmail(userData.email)) {
        throw new Error('Only @tpg.gov.gh email addresses are allowed');
      }

      // Check if user already exists
      const existingUser = await User.findByEmail(userData.email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Create new user
      const user = await User.query().insert({
        username: userData.username,
        email: userData.email.toLowerCase(),
        password: userData.password, // Will be hashed in $beforeInsert
        role: userData.role || 'user',
        status: 'pending', // Requires admin approval
        tpg_license_number: userData.tpg_license_number,
        pharmacy_name: userData.pharmacy_name,
        phone_number: userData.phone_number,
        address: userData.address
      });

      // Generate email verification token
      const verificationToken = await user.generateEmailVerificationToken();

      logger.security.logAuth('user_registered', user.email, ip, userAgent, true, {
        user_id: user.id,
        role: user.role
      });

      return {
        user: user.getPublicData(),
        verificationToken
      };
    } catch (error) {
      logger.security.logAuth('registration_failed', userData.email, ip, userAgent, false, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Authenticate user login
   */
  async login(email, password, ip, userAgent) {
    try {
      // Find user by email
      const user = await User.findByEmail(email);
      if (!user) {
        logger.security.logAuth('login_failed', email, ip, userAgent, false, {
          reason: 'user_not_found'
        });
        throw new Error('Invalid email or password');
      }

      // Check if account is locked
      if (user.isLocked()) {
        logger.security.logAuth('login_failed', email, ip, userAgent, false, {
          reason: 'account_locked',
          locked_until: user.locked_until
        });
        throw new Error('Account is temporarily locked. Please try again later.');
      }

      // Verify password
      const isPasswordValid = await user.verifyPassword(password);
      if (!isPasswordValid) {
        await user.incrementFailedLogins();
        logger.security.logAuth('login_failed', email, ip, userAgent, false, {
          reason: 'invalid_password',
          failed_attempts: user.failed_login_attempts + 1
        });
        throw new Error('Invalid email or password');
      }

      // Check account status
      if (user.status === 'suspended') {
        logger.security.logAuth('login_failed', email, ip, userAgent, false, {
          reason: 'account_suspended'
        });
        throw new Error('Account is suspended. Please contact support.');
      }

      if (user.status === 'pending') {
        logger.security.logAuth('login_failed', email, ip, userAgent, false, {
          reason: 'account_pending'
        });
        throw new Error('Account is pending approval. Please wait for admin approval.');
      }

      // Successful login
      await user.resetFailedLogins();
      await user.updateLastLogin(ip, userAgent);

      // Generate tokens
      const tokens = this.generateTokens(user);

      logger.security.logAuth('login_success', email, ip, userAgent, true, {
        user_id: user.id
      });

      return {
        user: user.getPublicData(),
        tokens
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Logout user (invalidate tokens)
   */
  async logout(userId, ip, userAgent) {
    try {
      const user = await User.query().findById(userId);
      if (user) {
        logger.security.logAuth('logout', user.email, ip, userAgent, true);
      }

      // In a production system, you might want to maintain a blacklist of tokens
      // For now, we'll just log the logout event
      return { success: true };
    } catch (error) {
      logger.error('Logout error:', error);
      throw error;
    }
  }

  /**
   * Verify email address
   */
  async verifyEmail(token, ip, userAgent) {
    try {
      const user = await User.findByVerificationToken(token);
      if (!user) {
        throw new Error('Invalid or expired verification token');
      }

      const success = await user.verifyEmail(token);
      if (!success) {
        throw new Error('Email verification failed');
      }

      logger.security.logAuth('email_verified', user.email, ip, userAgent, true);

      return {
        user: user.getPublicData()
      };
    } catch (error) {
      logger.security.logAuth('email_verification_failed', null, ip, userAgent, false, {
        error: error.message,
        token: token.substring(0, 10) + '...'
      });
      throw error;
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email, ip, userAgent) {
    try {
      const user = await User.findByEmail(email);
      if (!user) {
        // Don't reveal whether email exists or not
        logger.security.logAuth('password_reset_requested', email, ip, userAgent, false, {
          reason: 'user_not_found'
        });
        return { success: true }; // Always return success for security
      }

      const resetToken = await user.generatePasswordResetToken();

      logger.security.logAuth('password_reset_requested', email, ip, userAgent, true);

      return {
        success: true,
        resetToken // In production, this would be sent via email
      };
    } catch (error) {
      logger.security.logAuth('password_reset_request_failed', email, ip, userAgent, false, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(token, newPassword, ip, userAgent) {
    try {
      const user = await User.findByPasswordResetToken(token);
      if (!user) {
        throw new Error('Invalid or expired reset token');
      }

      const success = await user.resetPassword(token, newPassword);
      if (!success) {
        throw new Error('Password reset failed');
      }

      logger.security.logAuth('password_reset_completed', user.email, ip, userAgent, true);

      return {
        user: user.getPublicData()
      };
    } catch (error) {
      logger.security.logAuth('password_reset_failed', null, ip, userAgent, false, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Change password (for authenticated users)
   */
  async changePassword(userId, currentPassword, newPassword, ip, userAgent) {
    try {
      const user = await User.query().findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isCurrentPasswordValid = await user.verifyPassword(currentPassword);
      if (!isCurrentPasswordValid) {
        logger.security.logAuth('password_change_failed', user.email, ip, userAgent, false, {
          reason: 'invalid_current_password'
        });
        throw new Error('Current password is incorrect');
      }

      // Update password
      await user.$query().patch({
        password: newPassword // Will be hashed in $beforeUpdate
      });

      logger.security.logAuth('password_changed', user.email, ip, userAgent, true);

      return {
        user: user.getPublicData()
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Validate TPG email domain
   */
  isValidTPGEmail(email) {
    const domain = process.env.EMAIL_DOMAIN || '@tpg.gov.gh';
    return email.toLowerCase().endsWith(domain);
  }

  /**
   * Get user permissions
   */
  async getUserPermissions(userId) {
    const user = await User.query().findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    return {
      role: user.role,
      permissions: this.getRolePermissions(user.role)
    };
  }

  /**
   * Get permissions for a role
   */
  getRolePermissions(role) {
    const rolePermissions = {
      user: [
        'tickets.create',
        'tickets.view.own',
        'tickets.edit.own',
        'tickets.delete.own'
      ],
      admin: [
        'tickets.create',
        'tickets.view.own',
        'tickets.view.all',
        'tickets.edit.own',
        'tickets.edit.all',
        'tickets.assign',
        'tickets.close',
        'users.view',
        'analytics.view'
      ],
      super_admin: [
        'tickets.*',
        'users.*',
        'analytics.*',
        'system.admin',
        'categories.manage'
      ]
    };

    return rolePermissions[role] || [];
  }
}

module.exports = new AuthService();