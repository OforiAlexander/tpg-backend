const SystemSettings = require('../../../models/SystemSettings');
const logger = require('../../../config/logger');
const { 
  validateSettingsUpdate, 
  validateSettingsCreate,
  validateBackupRequest 
} = require('./settings.validation');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');

class SettingsController {
  /**
   * Get all system settings
   * GET /api/settings
   * Permissions: system.settings.view
   */
  async getSettings(req, res) {
    try {
      const { category, public_only = false } = req.query;

      let query = SystemSettings.query();

      // Apply filters
      if (category) {
        query = query.where('category', category);
      }

      if (public_only === 'true') {
        query = query.where('is_public', true);
      }

      const settings = await query.orderBy('category').orderBy('sort_order');

      // Group settings by category
      const groupedSettings = settings.reduce((acc, setting) => {
        const cat = setting.category || 'general';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(setting.getSafeData());
        return acc;
      }, {});

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'system_settings',
        'all',
        req.ip
      );

      res.json({
        success: true,
        settings: groupedSettings,
        total: settings.length,
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get settings error:', error);
      res.status(500).json({
        error: 'Failed to retrieve system settings',
        message: 'An error occurred while fetching settings'
      });
    }
  }

  /**
   * Get specific setting by key
   * GET /api/settings/:key
   * Permissions: system.settings.view
   */
  async getSetting(req, res) {
    try {
      const { key } = req.params;

      const setting = await SystemSettings.query().findById(key);

      if (!setting) {
        return res.status(404).json({
          error: 'Setting not found',
          message: 'The requested setting does not exist'
        });
      }

      // Check if user can view this setting
      if (!setting.is_public && !req.user.hasPermission('system.settings.view')) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to view this setting'
        });
      }

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'system_setting',
        key,
        req.ip
      );

      res.json({
        success: true,
        setting: setting.getSafeData()
      });
    } catch (error) {
      logger.error('Get setting error:', error);
      res.status(500).json({
        error: 'Failed to retrieve setting',
        message: 'An error occurred while fetching the setting'
      });
    }
  }

  /**
   * Update system settings
   * PUT /api/settings
   * Permissions: system.settings.manage
   */
  async updateSettings(req, res) {
    try {
      const { settings } = req.body;

      if (!settings || !Array.isArray(settings)) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Settings array is required'
        });
      }

      const updates = [];
      const errors = [];

      // Process each setting update
      for (const settingData of settings) {
        try {
          const { error, value } = validateSettingsUpdate(settingData);
          if (error) {
            errors.push({
              key: settingData.key,
              error: error.details[0].message
            });
            continue;
          }

          const { key, value: newValue } = value;

          // Check if setting exists
          const existingSetting = await SystemSettings.query().findById(key);
          if (!existingSetting) {
            errors.push({
              key,
              error: 'Setting not found'
            });
            continue;
          }

          // Validate value type
          const validatedValue = this.validateAndConvertValue(newValue, existingSetting.type);

          // Update setting
          const updatedSetting = await existingSetting.$query().patchAndFetch({
            value: validatedValue,
            updated_at: new Date().toISOString()
          });

          updates.push({
            key,
            old_value: existingSetting.value,
            new_value: validatedValue,
            updated_at: updatedSetting.updated_at
          });

          // Log the change
          logger.security.logAdminAction(
            req.user.id,
            'setting_updated',
            key,
            {
              old_value: existingSetting.value,
              new_value: validatedValue,
              setting_type: existingSetting.type
            },
            req.ip
          );

        } catch (settingError) {
          errors.push({
            key: settingData.key,
            error: settingError.message
          });
        }
      }

      const response = {
        success: errors.length === 0,
        message: `Settings update completed. ${updates.length} successful, ${errors.length} failed.`,
        updates,
        updated_by: req.user.username,
        updated_at: new Date().toISOString()
      };

      if (errors.length > 0) {
        response.errors = errors;
      }

      const statusCode = errors.length === 0 ? 200 : 207; // 207 Multi-Status
      res.status(statusCode).json(response);

    } catch (error) {
      logger.error('Update settings error:', error);
      res.status(500).json({
        error: 'Failed to update settings',
        message: 'An error occurred while updating settings'
      });
    }
  }

  /**
   * Create new system setting
   * POST /api/settings
   * Permissions: system.settings.manage
   */
  async createSetting(req, res) {
    try {
      const { error, value } = validateSettingsCreate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const { key, value: settingValue, description, type, category, is_public, sort_order } = value;

      // Check if setting already exists
      const existingSetting = await SystemSettings.query().findById(key);
      if (existingSetting) {
        return res.status(409).json({
          error: 'Setting already exists',
          message: 'A setting with this key already exists'
        });
      }

      // Validate and convert value
      const validatedValue = this.validateAndConvertValue(settingValue, type);

      // Create setting
      const setting = await SystemSettings.query().insert({
        key,
        value: validatedValue,
        description,
        type,
        category: category || 'general',
        is_public: is_public || false,
        sort_order: sort_order || 0
      });

      // Log creation
      logger.security.logAdminAction(
        req.user.id,
        'setting_created',
        key,
        {
          value: validatedValue,
          type,
          category: category || 'general'
        },
        req.ip
      );

      res.status(201).json({
        success: true,
        message: 'Setting created successfully',
        setting: setting.getSafeData(),
        created_by: req.user.username
      });

    } catch (error) {
      logger.error('Create setting error:', error);
      res.status(500).json({
        error: 'Failed to create setting',
        message: 'An error occurred while creating the setting'
      });
    }
  }

  /**
   * Delete system setting
   * DELETE /api/settings/:key
   * Permissions: system.settings.manage
   */
  async deleteSetting(req, res) {
    try {
      const { key } = req.params;

      const setting = await SystemSettings.query().findById(key);
      if (!setting) {
        return res.status(404).json({
          error: 'Setting not found',
          message: 'The requested setting does not exist'
        });
      }

      // Prevent deletion of critical system settings
      const criticalSettings = [
        'site_name',
        'email_host',
        'security_password_min_length',
        'system_maintenance_mode'
      ];

      if (criticalSettings.includes(key)) {
        return res.status(400).json({
          error: 'Cannot delete critical setting',
          message: 'This setting is critical and cannot be deleted'
        });
      }

      await setting.$query().delete();

      // Log deletion
      logger.security.logAdminAction(
        req.user.id,
        'setting_deleted',
        key,
        {
          value: setting.value,
          type: setting.type
        },
        req.ip
      );

      res.json({
        success: true,
        message: 'Setting deleted successfully',
        deleted_by: req.user.username
      });

    } catch (error) {
      logger.error('Delete setting error:', error);
      res.status(500).json({
        error: 'Failed to delete setting',
        message: 'An error occurred while deleting the setting'
      });
    }
  }

  /**
   * Get system status
   * GET /api/settings/status
   * Permissions: system.status.view
   */
  async getSystemStatus(req, res) {
    try {
      // Get disk usage before creating the status object to preserve 'this' context
      const diskUsage = await this.getDiskUsage();
      
      const status = {
        system: {
          status: 'online',
          uptime: process.uptime(),
          version: process.env.APP_VERSION || '1.0.0',
          environment: process.env.NODE_ENV || 'development',
          node_version: process.version,
          platform: os.platform(),
          architecture: os.arch(),
          last_restart: new Date(Date.now() - process.uptime() * 1000).toISOString()
        },
        database: {
          status: 'connected',
          // Add actual database health check here
          last_query: new Date().toISOString()
        },
        services: {
          email_service: {
            status: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true' ? 'active' : 'disabled',
            last_sent: new Date().toISOString()
          },
          file_storage: {
            status: 'active',
            upload_path: process.env.UPLOAD_PATH || './uploads'
          },
          authentication: {
            status: 'active',
            jwt_expiry: process.env.JWT_EXPIRES_IN || '24h'
          }
        },
        performance: {
          memory_usage: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            unit: 'MB'
          },
          cpu_usage: {
            load_average: os.loadavg(),
            cpu_count: os.cpus().length
          },
          disk_usage: diskUsage // ✅ FIXED: Use the pre-fetched value
        },
        security: {
          https_enabled: process.env.COOKIE_SECURE === 'true',
          rate_limiting: process.env.ENABLE_RATE_LIMITING === 'true',
          cors_enabled: process.env.ENABLE_CORS === 'true',
          helmet_enabled: process.env.ENABLE_HELMET === 'true'
        }
      };

      // Log status check
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'system_status',
        'all',
        req.ip
      );

      res.json({
        success: true,
        status,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Get system status error:', error);
      res.status(500).json({
        error: 'Failed to retrieve system status',
        message: 'An error occurred while fetching status'
      });
    }
  }

  /**
   * Initialize default settings
   * POST /api/settings/initialize
   * Permissions: system.settings.manage (Super Admin only)
   */
  async initializeDefaultSettings(req, res) {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Only super administrators can initialize settings'
        });
      }

      const defaultSettings = [
        // System Settings
        { key: 'site_name', value: 'TPG State Portal', description: 'Application name', type: 'string', category: 'system', is_public: true, sort_order: 1 },
        { key: 'site_description', value: 'SMS - Support System Support System', description: 'Application description', type: 'string', category: 'system', is_public: true, sort_order: 2 },
        { key: 'maintenance_mode', value: 'false', description: 'Enable maintenance mode', type: 'boolean', category: 'system', is_public: true, sort_order: 3 },
        { key: 'registration_enabled', value: 'true', description: 'Allow new user registration', type: 'boolean', category: 'system', is_public: true, sort_order: 4 },
        { key: 'email_verification_required', value: 'false', description: 'Require email verification for new accounts', type: 'boolean', category: 'system', is_public: true, sort_order: 5 },
        
        // Email Settings
        { key: 'email_notifications_enabled', value: 'true', description: 'Enable email notifications', type: 'boolean', category: 'email', sort_order: 1 },
        { key: 'email_from_name', value: 'TPG Support System', description: 'Email sender name', type: 'string', category: 'email', sort_order: 2 },
        { key: 'support_email', value: process.env.SUPPORT_EMAIL || 'support@upsamail.edu.gh', description: 'Support email address', type: 'string', category: 'email', is_public: true, sort_order: 3 },
        
        // Security Settings
        { key: 'password_min_length', value: '8', description: 'Minimum password length', type: 'number', category: 'security', is_public: true, sort_order: 1 },
        { key: 'max_login_attempts', value: '5', description: 'Maximum failed login attempts', type: 'number', category: 'security', sort_order: 2 },
        { key: 'account_lockout_duration', value: '30', description: 'Account lockout duration (minutes)', type: 'number', category: 'security', sort_order: 3 },
        { key: 'session_timeout', value: '60', description: 'Session timeout (minutes)', type: 'number', category: 'security', sort_order: 4 },
        
        // Ticket System Settings
        { key: 'auto_assignment_enabled', value: 'true', description: 'Enable automatic ticket assignment', type: 'boolean', category: 'tickets', sort_order: 1 },
        { key: 'sla_response_time', value: '4', description: 'SLA response time (hours)', type: 'number', category: 'tickets', is_public: true, sort_order: 2 },
        { key: 'sla_resolution_time', value: '24', description: 'SLA resolution time (hours)', type: 'number', category: 'tickets', is_public: true, sort_order: 3 },
        { key: 'satisfaction_surveys_enabled', value: 'true', description: 'Enable satisfaction surveys', type: 'boolean', category: 'tickets', sort_order: 4 },
        { key: 'auto_escalation_enabled', value: 'true', description: 'Enable automatic ticket escalation', type: 'boolean', category: 'tickets', sort_order: 5 },
        { key: 'escalation_time_hours', value: '8', description: 'Escalation time in hours', type: 'number', category: 'tickets', sort_order: 6 },
        { key: 'allow_non_registered_tickets', value: 'false', description: 'Allow tickets from non-registered users', type: 'boolean', category: 'tickets', sort_order: 7 },
        
        // File Upload Settings
        { key: 'max_file_upload_size', value: '10485760', description: 'Maximum file upload size (bytes)', type: 'number', category: 'files', sort_order: 1 },
        { key: 'allowed_file_types', value: JSON.stringify(['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx', '.txt']), description: 'Allowed file extensions', type: 'json', category: 'files', sort_order: 2 },
        
        // Organization Settings
        { key: 'org_name', value: process.env.ORG_NAME || 'SMS - Support System', description: 'Organization name', type: 'string', category: 'organization', is_public: true, sort_order: 1 },
        { key: 'org_email', value: process.env.ORG_EMAIL || 'info@tpg.gov.gh', description: 'Organization email', type: 'string', category: 'organization', is_public: true, sort_order: 2 },
        { key: 'org_phone', value: process.env.ORG_PHONE || '+233 50 123 9711', description: 'Organization phone', type: 'string', category: 'organization', is_public: true, sort_order: 3 },
        { key: 'org_address', value: process.env.ORG_ADDRESS || 'Accra, Ghana', description: 'Organization address', type: 'string', category: 'organization', is_public: true, sort_order: 4 }
      ];

      const created = [];
      const skipped = [];

      for (const settingData of defaultSettings) {
        try {
          // Check if setting already exists
          const existing = await SystemSettings.query().findById(settingData.key);
          if (existing) {
            skipped.push(settingData.key);
            continue;
          }

          // Create setting
          await SystemSettings.query().insert(settingData);
          created.push(settingData.key);

        } catch (error) {
          logger.error(`Failed to create setting ${settingData.key}:`, error);
        }
      }

      // Log initialization
      logger.security.logAdminAction(
        req.user.id,
        'settings_initialized',
        'system',
        {
          created_count: created.length,
          skipped_count: skipped.length,
          created_settings: created
        },
        req.ip
      );

      res.json({
        success: true,
        message: 'Default settings initialization completed',
        created_count: created.length,
        skipped_count: skipped.length,
        created_settings: created,
        skipped_settings: skipped
      });

    } catch (error) {
      logger.error('Initialize settings error:', error);
      res.status(500).json({
        error: 'Failed to initialize settings',
        message: 'An error occurred while initializing default settings'
      });
    }
  }

  /**
   * Backup system
   * POST /api/settings/backup
   * Permissions: system.backup.create
   */
  async createBackup(req, res) {
    try {
      const { error, value } = validateBackupRequest(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const { include_files = false, include_logs = false } = value;
      const backupId = `backup_${Date.now()}_${req.user.id}`;

      // Log backup initiation
      logger.security.logAdminAction(
        req.user.id,
        'backup_initiated',
        backupId,
        {
          include_files,
          include_logs
        },
        req.ip
      );

      // In a real implementation, you would:
      // 1. Create database dump
      // 2. Archive files if requested
      // 3. Compress and store backup
      // 4. Return download link or backup ID

      res.json({
        success: true,
        message: 'Backup initiated successfully',
        backup_id: backupId,
        estimated_completion: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
        include_files,
        include_logs,
        initiated_by: req.user.username
      });

    } catch (error) {
      logger.error('Create backup error:', error);
      res.status(500).json({
        error: 'Failed to create backup',
        message: 'An error occurred while initiating backup'
      });
    }
  }

  // Helper Methods

  /**
   * Validate and convert setting value based on type
   */
  validateAndConvertValue(value, type) {
    switch (type) {
      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true';
        }
        throw new Error('Invalid boolean value');

      case 'number':
        const num = Number(value);
        if (isNaN(num)) throw new Error('Invalid number value');
        return num;

      case 'json':
        if (typeof value === 'object') return JSON.stringify(value);
        if (typeof value === 'string') {
          try {
            JSON.parse(value);
            return value;
          } catch {
            throw new Error('Invalid JSON value');
          }
        }
        throw new Error('Invalid JSON value');

      case 'string':
      default:
        return String(value);
    }
  }

  /**
   * Get disk usage information
   * Enhanced with better error handling
   */
  async getDiskUsage() {
    try {
      // This is a simplified implementation
      // In production, you might want to use a library like 'diskusage' or 'node-df'
      const stats = await fs.stat(process.cwd());
      
      // For a more accurate disk usage, you could use platform-specific commands
      // or external libraries. For now, return mock data with proper structure
      return {
        available: 'N/A',
        used: 'N/A',
        total: 'N/A',
        unit: 'GB'
      };
    } catch (error) {
      logger.warn('Could not get disk usage:', error);
      return {
        available: 'Unknown',
        used: 'Unknown',
        total: 'Unknown',
        unit: 'GB'
      };
    }
  }
}

module.exports = new SettingsController();