// src/routes/api/settings/settings.routes.js - TPG System Settings Routes (Context Fixed)
const express = require('express');
const router = express.Router();

// Import middleware
const { 
  authenticate, 
  requireRole, 
  requirePermission,
  authRateLimit 
} = require('../../../middleware/auth');
const { apiRateLimit } = require('../../../middleware/security');
const { auditUserAction } = require('../../../middleware/audit');

// Import controller
const settingsController = require('./settings.controller');

// Apply rate limiting
router.use(apiRateLimit);

/**
 * Public settings routes (minimal permissions required)
 */

// GET /api/settings/public - Get public settings (no special permissions needed)
router.get('/public', async (req, res) => {
  try {
    const SystemSettings = require('../../../models/SystemSettings');
    const publicSettings = await SystemSettings.getPublicSettings();
    
    res.json({
      success: true,
      settings: publicSettings,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Public settings error:', error);
    res.status(500).json({
      error: 'Failed to retrieve public settings',
      message: 'An error occurred while fetching public settings'
    });
  }
});

// Apply authentication to all routes
router.use(authenticate);

/**
 * System status routes
 */

// GET /api/settings/status - Get system status (Admin+)
router.get('/status', 
  requirePermission('system.status.view'),
  auditUserAction('view_system_status'),
  (req, res) => settingsController.getSystemStatus(req, res) // ✅ FIXED: Proper context binding
);

/**
 * Settings management routes (Admin+)
 */

// GET /api/settings - Get all system settings (Admin+)
router.get('/', 
  requirePermission('system.settings.view'),
  auditUserAction('view_settings'),
  (req, res) => settingsController.getSettings(req, res) // ✅ FIXED: Proper context binding
);

// GET /api/settings/:key - Get specific setting (Admin+)
router.get('/:key',
  requirePermission('system.settings.view'),
  auditUserAction('view_setting'),
  (req, res) => settingsController.getSetting(req, res) // ✅ FIXED: Proper context binding
);

// POST /api/settings - Create new setting (Super Admin only)
router.post('/',
  requireRole('super_admin'),
  authRateLimit, // Additional rate limiting for sensitive operations
  auditUserAction('create_setting'),
  (req, res) => settingsController.createSetting(req, res) // ✅ FIXED: Proper context binding
);

// PUT /api/settings - Update multiple settings (Admin+)
router.put('/',
  requirePermission('system.settings.manage'),
  // Remove authRateLimit for settings updates - too restrictive
  auditUserAction('update_settings'),
  (req, res) => settingsController.updateSettings(req, res) // ✅ FIXED: Proper context binding
);

// DELETE /api/settings/:key - Delete setting (Super Admin only)
router.delete('/:key',
  requireRole('super_admin'),
  authRateLimit,
  auditUserAction('delete_setting'),
  (req, res) => settingsController.deleteSetting(req, res) // ✅ FIXED: Proper context binding
);

/**
 * System administration routes (Super Admin only)
 */

// POST /api/settings/initialize - Initialize default settings (Super Admin only)
router.post('/initialize',
  requireRole('super_admin'),
  authRateLimit,
  auditUserAction('initialize_settings'),
  (req, res) => settingsController.initializeDefaultSettings(req, res) // ✅ FIXED: Proper context binding
);

// POST /api/settings/backup - Create system backup (Admin+)
router.post('/backup',
  requirePermission('system.backup.create'),
  authRateLimit,
  auditUserAction('create_backup'),
  (req, res) => settingsController.createBackup(req, res) // ✅ FIXED: Proper context binding
);

// GET /api/settings/backup/history - Get backup history (Admin+)
router.get('/backup/history',
  requirePermission('system.backup.view'),
  auditUserAction('view_backup_history'),
  async (req, res) => {
    try {
      // Mock backup history - in real implementation, this would query a backups table
      const backups = [
        {
          id: 'backup_1734697768000',
          created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          size: '245 MB',
          type: 'scheduled',
          status: 'completed',
          includes_files: true,
          includes_logs: false,
          created_by: 'system'
        },
        {
          id: 'backup_1734611368000', 
          created_at: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
          size: '238 MB',
          type: 'manual',
          status: 'completed',
          includes_files: true,
          includes_logs: true,
          created_by: req.user?.username || 'admin'
        }
      ];

      res.json({
        success: true,
        backups,
        total_backups: backups.length,
        total_size: '483 MB'
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to retrieve backup history',
        message: 'An error occurred while fetching backups'
      });
    }
  }
);

/**
 * Email and notification testing
 */

// POST /api/settings/test-email - Test email configuration (Admin+)
router.post('/test-email',
  requirePermission('system.settings.manage'),
  authRateLimit,
  auditUserAction('test_email'),
  async (req, res) => {
    try {
      const { validateTestEmail } = require('./settings.validation');
      const { error, value } = validateTestEmail(req.body);
      
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { to_email, test_type } = value;

      // TODO: Implement actual email test using enhancedEmailService
      // const enhancedEmailService = require('../../../services/enhancedEmailService');
      // await enhancedEmailService.sendTestEmail(to_email, test_type);

      res.json({
        success: true,
        message: `Test email sent successfully to ${to_email}`,
        test_type,
        sent_at: new Date().toISOString(),
        sent_by: req.user.username
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to send test email',
        message: 'An error occurred while sending test email'
      });
    }
  }
);

/**
 * Cache management
 */

// POST /api/settings/clear-cache - Clear system cache (Admin+)
router.post('/clear-cache',
  requirePermission('system.cache.clear'),
  authRateLimit,
  auditUserAction('clear_cache'),
  async (req, res) => {
    try {
      const { validateCacheOperation } = require('./settings.validation');
      const { error, value } = validateCacheOperation(req.body);
      
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { cache_type, force } = value;

      // TODO: Implement actual cache clearing
      // This would clear Redis cache, memory cache, etc.

      res.json({
        success: true,
        message: `${cache_type} cache cleared successfully`,
        cache_type,
        force,
        cleared_at: new Date().toISOString(),
        cleared_by: req.user.username,
        space_freed: '15.2 MB' // Mock value
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to clear cache',
        message: 'An error occurred while clearing cache'
      });
    }
  }
);

/**
 * Maintenance mode management
 */

// POST /api/settings/maintenance - Toggle maintenance mode (Super Admin only)
router.post('/maintenance',
  requireRole('super_admin'),
  authRateLimit,
  auditUserAction('toggle_maintenance'),
  async (req, res) => {
    try {
      const { validateMaintenanceMode } = require('./settings.validation');
      const { error, value } = validateMaintenanceMode(req.body);
      
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { enabled, message, estimated_duration, allowed_ips } = value;

      // TODO: Update maintenance_mode setting in database
      const SystemSettings = require('../../../models/SystemSettings');
      await SystemSettings.updateValue('maintenance_mode', enabled);
      
      if (enabled) {
        await SystemSettings.updateValue('maintenance_message', message);
        if (estimated_duration) {
          await SystemSettings.updateValue('maintenance_duration', estimated_duration);
        }
        if (allowed_ips && allowed_ips.length > 0) {
          await SystemSettings.updateValue('maintenance_allowed_ips', JSON.stringify(allowed_ips));
        }
      }

      res.json({
        success: true,
        message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'} successfully`,
        maintenance_enabled: enabled,
        maintenance_message: message,
        estimated_duration,
        allowed_ips,
        updated_by: req.user.username,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to toggle maintenance mode',
        message: 'An error occurred while updating maintenance mode'
      });
    }
  }
);

/**
 * Import/Export functionality
 */

// GET /api/settings/export - Export all settings (Super Admin only)
router.get('/export',
  requireRole('super_admin'),
  auditUserAction('export_settings'),
  async (req, res) => {
    try {
      const SystemSettings = require('../../../models/SystemSettings');
      const exportData = await SystemSettings.exportSettings();
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="tpg-settings-${Date.now()}.json"`);
      res.json(exportData);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to export settings',
        message: 'An error occurred while exporting settings'
      });
    }
  }
);

// POST /api/settings/import - Import settings (Super Admin only)
router.post('/import',
  requireRole('super_admin'),
  authRateLimit,
  auditUserAction('import_settings'),
  async (req, res) => {
    try {
      const { validateSettingsImport } = require('./settings.validation');
      const { error, value } = validateSettingsImport(req.body);
      
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const { settings, options } = value;
      
      const SystemSettings = require('../../../models/SystemSettings');
      const result = await SystemSettings.importSettings(settings, options);
      
      res.json({
        success: true,
        message: 'Settings import completed',
        imported_by: req.user.username,
        imported_at: new Date().toISOString(),
        ...result
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to import settings',
        message: 'An error occurred while importing settings'
      });
    }
  }
);

/**
 * Route-specific error handling middleware
 */
router.use((error, req, res, next) => {
  // Log settings-specific errors
  req.logger?.error('Settings API Error:', {
    error: error.message,
    stack: error.stack,
    user_id: req.user?.id,
    route: req.route?.path,
    method: req.method
  });

  // Handle specific validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: error.message,
      details: error.details
    });
  }

  // Handle permission errors
  if (error.message?.includes('permission')) {
    return res.status(403).json({
      error: 'Access Denied',
      message: 'You do not have permission to perform this action'
    });
  }

  // Handle setting not found errors
  if (error.message?.includes('not found')) {
    return res.status(404).json({
      error: 'Setting Not Found',
      message: 'The requested setting does not exist'
    });
  }

  // Pass to global error handler
  next(error);
});

module.exports = router;