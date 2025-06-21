// src/services/recaptchaService.js - Google reCAPTCHA v2 Service
const axios = require('axios');
const logger = require('../config/logger');

class RecaptchaService {
  constructor() {
    this.secretKey = process.env.RECAPTCHA_SECRET_KEY;
    this.siteKey = process.env.RECAPTCHA_SITE_KEY;
    this.verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
    this.enabled = process.env.ENABLE_RECAPTCHA !== 'false';

    // Log configuration status
    logger.info('reCAPTCHA Service initialized', {
      enabled: this.enabled,
      hasSecretKey: !!this.secretKey,
      hasSiteKey: !!this.siteKey,
      environment: process.env.NODE_ENV
    });

    if (this.enabled && (!this.secretKey || !this.siteKey)) {
      logger.warn('reCAPTCHA is enabled but keys are missing', {
        hasSecretKey: !!this.secretKey,
        hasSiteKey: !!this.siteKey
      });
    }
  }

  /**
   * Verify reCAPTCHA response token
   */
  async verify(token, ip = null) {
    // Skip verification in development if not configured
    if (!this.enabled) {
      logger.info('reCAPTCHA verification skipped - service disabled');
      return {
        success: true,
        score: 1.0,
        action: 'disabled',
        hostname: 'localhost'
      };
    }

    if (!this.secretKey) {
      if (process.env.NODE_ENV === 'development') {
        logger.warn('reCAPTCHA verification skipped in development mode - no secret key');
        return {
          success: true,
          score: 1.0,
          action: 'development',
          hostname: 'localhost'
        };
      }
      throw new Error('reCAPTCHA is not properly configured - missing secret key');
    }

    if (!token) {
      throw new Error('reCAPTCHA token is required');
    }

    try {
      const response = await axios.post(this.verifyUrl, null, {
        params: {
          secret: this.secretKey,
          response: token,
          remoteip: ip
        },
        timeout: 10000 // 10 second timeout
      });

      const result = response.data;

      // Log verification attempt
      logger.info('reCAPTCHA verification attempt', {
        success: result.success,
        score: result.score,
        action: result.action,
        hostname: result.hostname,
        errors: result['error-codes'],
        ip: ip
      });

      if (!result.success) {
        const errorCodes = result['error-codes'] || [];
        logger.warn('reCAPTCHA verification failed', {
          errors: errorCodes,
          ip: ip
        });

        // Handle specific error codes
        if (errorCodes.includes('timeout-or-duplicate')) {
          throw new Error('reCAPTCHA token has expired or been used already');
        }
        if (errorCodes.includes('invalid-input-response')) {
          throw new Error('Invalid reCAPTCHA token');
        }
        if (errorCodes.includes('missing-input-response')) {
          throw new Error('reCAPTCHA token is missing');
        }
        if (errorCodes.includes('invalid-input-secret')) {
          throw new Error('Invalid reCAPTCHA secret key');
        }

        throw new Error('reCAPTCHA verification failed');
      }

      // For reCAPTCHA v2, there's no score, but we can check hostname
      if (result.hostname && !this.isValidHostname(result.hostname)) {
        logger.warn('reCAPTCHA invalid hostname', {
          provided_hostname: result.hostname,
          expected_hostnames: this.getAllowedHostnames(),
          ip: ip
        });
        throw new Error('reCAPTCHA verification failed: invalid hostname');
      }

      return {
        success: true,
        hostname: result.hostname,
        challenge_ts: result.challenge_ts
      };

    } catch (error) {
      if (error.response) {
        logger.error('reCAPTCHA API error', {
          status: error.response.status,
          data: error.response.data,
          ip: ip
        });
        throw new Error('reCAPTCHA service unavailable');
      }

      if (error.code === 'ECONNABORTED') {
        logger.error('reCAPTCHA timeout', { ip: ip });
        throw new Error('reCAPTCHA verification timeout');
      }

      // Re-throw our custom errors
      if (error.message.includes('reCAPTCHA')) {
        throw error;
      }

      logger.error('Unexpected reCAPTCHA error', {
        error: error.message,
        ip: ip
      });
      throw new Error('reCAPTCHA verification failed');
    }
  }

  /**
   * Verify reCAPTCHA with additional security checks
   */
  async verifyWithChecks(token, ip, userAgent = null, expectedAction = null) {
    try {
      const result = await this.verify(token, ip);

      // Additional security checks can be added here
      if (expectedAction && result.action !== expectedAction) {
        logger.warn('reCAPTCHA action mismatch', {
          expected: expectedAction,
          actual: result.action,
          ip: ip
        });
        // Note: For reCAPTCHA v2, action checking might not be applicable
        // This is more relevant for reCAPTCHA v3
      }

      return result;
    } catch (error) {
      // Log failed verification with context
      logger.error('reCAPTCHA verification failed', {
        error: error.message,
        ip: ip,
        userAgent: userAgent
      });
      throw error;
    }
  }

  /**
   * Check if hostname is valid for our application
   */
  isValidHostname(hostname) {
    const allowedHostnames = this.getAllowedHostnames();
    return allowedHostnames.includes(hostname);
  }

  /**
   * Get allowed hostnames for reCAPTCHA
   */
  getAllowedHostnames() {
    const hostnames = [
      'localhost',
      '127.0.0.1',
      'portal.tpg.gov.gh',
      'staging.tpg.gov.gh'
    ];

    // Add custom hostnames from environment
    const customHostnames = process.env.RECAPTCHA_ALLOWED_HOSTNAMES;
    if (customHostnames) {
      hostnames.push(...customHostnames.split(',').map(h => h.trim()));
    }

    return hostnames;
  }

  /**
   * Middleware for Express routes that require reCAPTCHA
   */
  middleware(options = {}) {
    const {
      action = null,
      required = true,
      skipInDevelopment = true
    } = options;

    return async (req, res, next) => {
      // Skip in development if configured
      if (skipInDevelopment && process.env.NODE_ENV === 'development' && !this.secretKey) {
        logger.info('reCAPTCHA middleware skipped in development');
        return next();
      }

      if (!required && !req.body.recaptchaToken) {
        return next();
      }

      try {
        const token = req.body.recaptchaToken || req.body['g-recaptcha-response'];
        if (!token) {
          return res.status(400).json({
            error: 'reCAPTCHA verification required',
            message: 'Please complete the reCAPTCHA challenge'
          });
        }

        const result = await this.verifyWithChecks(
          token,
          req.ip,
          req.get('User-Agent'),
          action
        );

        // Store result in request for later use
        req.recaptcha = result;
        next();
      } catch (error) {
        logger.error('reCAPTCHA middleware failed', {
          error: error.message,
          url: req.originalUrl,
          method: req.method,
          ip: req.ip
        });

        return res.status(400).json({
          error: 'reCAPTCHA verification failed',
          message: error.message
        });
      }
    };
  }

  /**
   * Check service health
   */
  async healthCheck() {
    if (!this.enabled) {
      return {
        status: 'disabled',
        message: 'reCAPTCHA is disabled'
      };
    }

    if (!this.secretKey) {
      return {
        status: 'error',
        message: 'reCAPTCHA secret key not configured'
      };
    }

    try {
      // Test with invalid token to check API connectivity
      await axios.post(this.verifyUrl, null, {
        params: {
          secret: this.secretKey,
          response: 'test'
        },
        timeout: 5000
      });

      return {
        status: 'healthy',
        message: 'reCAPTCHA service is available'
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'reCAPTCHA service unavailable',
        error: error.message
      };
    }
  }

  /**
   * Get client configuration for frontend
   */
  getClientConfig() {
    logger.info('Getting reCAPTCHA client config', {
      enabled: this.enabled,
      hasSiteKey: !!this.siteKey,
      environment: process.env.NODE_ENV
    });

    return {
      enabled: this.enabled,
      siteKey: this.siteKey || null,
      theme: process.env.RECAPTCHA_THEME || 'light', // or 'dark'
      size: process.env.RECAPTCHA_SIZE || 'normal', // or 'compact'
      badge: process.env.RECAPTCHA_BADGE || 'bottomright' // or 'bottomleft', 'inline'
    };
  }
}

module.exports = new RecaptchaService();