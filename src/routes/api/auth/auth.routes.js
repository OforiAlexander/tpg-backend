// src/routes/api/auth/auth.routes.js - TPG Authentication Routes
const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const { authenticate } = require('../../../middleware/auth');

// Public authentication endpoints (no auth required)
router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/verify-email', authController.verifyEmail);
router.post('/refresh', authController.refresh);

// reCAPTCHA configuration (public)
router.get('/recaptcha-config', authController.getRecaptchaConfig);

// Health check (public)
router.get('/health', authController.healthCheck);

// Protected endpoints (require authentication)
router.use(authenticate); // Apply authentication middleware to all routes below

router.post('/verify-token', authController.verifyToken);
router.post('/logout', authController.logout);
router.post('/change-password', authController.changePassword);
router.get('/profile', authController.getProfile);
router.put('/profile', authController.updateProfile);

// Status endpoint
router.get('/status', (req, res) => {
  res.json({
    service: 'TPG Authentication Service',
    status: 'Operational',
    endpoints: {
      // Public endpoints
      login: 'POST /api/auth/login',
      register: 'POST /api/auth/register',
      forgotPassword: 'POST /api/auth/forgot-password',
      resetPassword: 'POST /api/auth/reset-password',
      verifyEmail: 'POST /api/auth/verify-email',
      refresh: 'POST /api/auth/refresh',
      recaptchaConfig: 'GET /api/auth/recaptcha-config',
      health: 'GET /api/auth/health',
      
      // Protected endpoints
      verifyToken: 'POST /api/auth/verify-token',
      logout: 'POST /api/auth/logout',
      changePassword: 'POST /api/auth/change-password',
      getProfile: 'GET /api/auth/profile',
      updateProfile: 'PUT /api/auth/profile'
    },
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    authentication: 'JWT Bearer Token required for protected endpoints'
  });
});

module.exports = router;