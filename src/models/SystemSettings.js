const { Model } = require('objection');
const logger = require('../config/logger');

class SystemSettings extends Model {
  static get tableName() {
    return 'system_settings';
  }

  static get idColumn() {
    return 'key';
  }

  // Define the JSON schema for validation
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['key', 'value'],
      properties: {
        key: { 
          type: 'string', 
          minLength: 1, 
          maxLength: 100 
        },
        value: { 
          type: 'string' 
        },
        description: { 
          type: ['string', 'null'], 
          maxLength: 500 
        },
        type: { 
          type: 'string', 
          enum: ['string', 'number', 'boolean', 'json'],
          default: 'string'
        },
        category: {
          type: ['string', 'null'],
          maxLength: 50,
          default: 'general'
        },
        is_public: { 
          type: 'boolean', 
          default: false 
        },
        sort_order: {
          type: 'integer',
          minimum: 0,
          default: 0
        },
        created_at: {
          type: ['string', 'null']
        },
        updated_at: {
          type: ['string', 'null']
        }
      },
      additionalProperties: false
    };
  }

  // Hooks - called before insert
  async $beforeInsert(context) {
    await super.$beforeInsert(context);
    
    const now = new Date().toISOString();
    this.created_at = now;
    this.updated_at = now;

    // Set default category if not provided
    if (!this.category) {
      this.category = 'general';
    }

    // Set default type if not provided
    if (!this.type) {
      this.type = 'string';
    }

    // Set default sort_order if not provided
    if (this.sort_order === undefined) {
      this.sort_order = 0;
    }

    // Set default is_public if not provided
    if (this.is_public === undefined) {
      this.is_public = false;
    }

    // Validate value format based on type
    this.validateValueFormat();
  }

  // Hooks - called before update
  async $beforeUpdate(context) {
    await super.$beforeUpdate(context);
    this.updated_at = new Date().toISOString();

    // Validate value format if value is being updated
    if (this.value !== undefined) {
      this.validateValueFormat();
    }
  }

  // Instance methods

  /**
   * Validate value format based on type
   */
  validateValueFormat() {
    try {
      switch (this.type) {
        case 'boolean':
          if (typeof this.value === 'string') {
            const lower = this.value.toLowerCase();
            if (!['true', 'false', '1', '0'].includes(lower)) {
              throw new Error(`Invalid boolean value: ${this.value}`);
            }
          }
          break;

        case 'number':
          if (typeof this.value === 'string' && isNaN(Number(this.value))) {
            throw new Error(`Invalid number value: ${this.value}`);
          }
          break;

        case 'json':
          if (typeof this.value === 'string') {
            try {
              JSON.parse(this.value);
            } catch {
              throw new Error(`Invalid JSON value: ${this.value}`);
            }
          }
          break;

        case 'string':
        default:
          // String values are always valid
          break;
      }
    } catch (error) {
      logger.error('Setting value validation error:', error);
      throw error;
    }
  }

  /**
   * Get typed value (convert from string to appropriate type)
   */
  getTypedValue() {
    switch (this.type) {
      case 'boolean':
        if (typeof this.value === 'boolean') return this.value;
        if (typeof this.value === 'string') {
          const lower = this.value.toLowerCase();
          return ['true', '1'].includes(lower);
        }
        return Boolean(this.value);

      case 'number':
        return Number(this.value);

      case 'json':
        try {
          return JSON.parse(this.value);
        } catch {
          return this.value;
        }

      case 'string':
      default:
        return String(this.value);
    }
  }

  /**
   * Get safe setting data (for API responses)
   */
  getSafeData() {
    return {
      key: this.key,
      value: this.getTypedValue(),
      description: this.description,
      type: this.type,
      category: this.category,
      is_public: this.is_public,
      sort_order: this.sort_order,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  /**
   * Get public setting data (only for public settings)
   */
  getPublicData() {
    if (!this.is_public) {
      return null;
    }

    return {
      key: this.key,
      value: this.getTypedValue(),
      description: this.description,
      type: this.type,
      category: this.category
    };
  }

  // Static methods

  /**
   * Get setting by key with typed value
   */
  static async getTypedValue(key) {
    const setting = await this.query().findById(key);
    return setting ? setting.getTypedValue() : null;
  }

  /**
   * Get settings by category
   */
  static async getByCategory(category) {
    return await this.query()
      .where('category', category)
      .orderBy('sort_order')
      .orderBy('key');
  }

  /**
   * Get public settings only
   */
  static async getPublicSettings() {
    const settings = await this.query()
      .where('is_public', true)
      .orderBy('category')
      .orderBy('sort_order');

    return settings.reduce((acc, setting) => {
      const publicData = setting.getPublicData();
      if (publicData) {
        const category = publicData.category || 'general';
        if (!acc[category]) acc[category] = [];
        acc[category].push(publicData);
      }
      return acc;
    }, {});
  }

  /**
   * Update setting value with validation
   */
  static async updateValue(key, value) {
    const setting = await this.query().findById(key);
    if (!setting) {
      throw new Error(`Setting not found: ${key}`);
    }

    // Validate value type
    const tempSetting = Object.assign(Object.create(Object.getPrototypeOf(setting)), setting);
    tempSetting.value = String(value);
    tempSetting.validateValueFormat();

    // Update the setting
    return await setting.$query().patchAndFetch({
      value: String(value),
      updated_at: new Date().toISOString()
    });
  }

  /**
   * Bulk update settings
   */
  static async bulkUpdate(updates) {
    const results = [];
    const errors = [];

    for (const { key, value } of updates) {
      try {
        const updated = await this.updateValue(key, value);
        results.push({ key, success: true, updated });
      } catch (error) {
        errors.push({ key, error: error.message });
      }
    }

    return { results, errors };
  }

  /**
   * Get all categories
   */
  static async getCategories() {
    const result = await this.query()
      .distinct('category')
      .whereNotNull('category')
      .orderBy('category');

    return result.map(row => row.category);
  }

  /**
   * Search settings
   */
  static async search(query, limit = 50) {
    return await this.query()
      .where('key', 'ilike', `%${query}%`)
      .orWhere('description', 'ilike', `%${query}%`)
      .orderBy('category')
      .orderBy('sort_order')
      .limit(limit);
  }

  /**
   * Initialize default settings if none exist
   */
  static async initializeDefaults() {
    const count = await this.query().count().first();
    
    if (Number(count.count) > 0) {
      return { message: 'Settings already exist', initialized: false };
    }

    const defaultSettings = [
      // System Settings
      { key: 'site_name', value: 'TPG State Portal', description: 'Application name', type: 'string', category: 'system', is_public: true, sort_order: 1 },
      { key: 'site_description', value: 'SMS - Support System Support System', description: 'Application description', type: 'string', category: 'system', is_public: true, sort_order: 2 },
      { key: 'maintenance_mode', value: 'false', description: 'Enable maintenance mode', type: 'boolean', category: 'system', is_public: true, sort_order: 3 },
      
      // Email Settings
      { key: 'email_notifications_enabled', value: 'true', description: 'Enable email notifications', type: 'boolean', category: 'email', sort_order: 1 },
      { key: 'support_email', value: 'support@upsamail.edu.gh', description: 'Support email address', type: 'string', category: 'email', is_public: true, sort_order: 2 },
      
      // Security Settings
      { key: 'password_min_length', value: '8', description: 'Minimum password length', type: 'number', category: 'security', is_public: true, sort_order: 1 },
      { key: 'max_login_attempts', value: '5', description: 'Maximum failed login attempts', type: 'number', category: 'security', sort_order: 2 },
      
      // Ticket System
      { key: 'sla_response_time', value: '4', description: 'SLA response time (hours)', type: 'number', category: 'tickets', is_public: true, sort_order: 1 },
      { key: 'sla_resolution_time', value: '24', description: 'SLA resolution time (hours)', type: 'number', category: 'tickets', is_public: true, sort_order: 2 }
    ];

    const inserted = await this.query().insert(defaultSettings);
    
    return { 
      message: 'Default settings initialized', 
      initialized: true,
      count: inserted.length || defaultSettings.length
    };
  }

  /**
   * Export all settings
   */
  static async exportSettings() {
    const settings = await this.query().orderBy('category').orderBy('sort_order');
    
    return {
      export_date: new Date().toISOString(),
      total_settings: settings.length,
      settings: settings.map(setting => setting.getSafeData())
    };
  }

  /**
   * Import settings from export
   */
  static async importSettings(settingsData, options = {}) {
    const { overwrite = false } = options;
    const results = [];
    const errors = [];

    for (const settingData of settingsData.settings || []) {
      try {
        const existing = await this.query().findById(settingData.key);
        
        if (existing && !overwrite) {
          results.push({ key: settingData.key, action: 'skipped', reason: 'already exists' });
          continue;
        }

        if (existing && overwrite) {
          await existing.$query().patch({
            value: String(settingData.value),
            description: settingData.description,
            type: settingData.type,
            category: settingData.category,
            is_public: settingData.is_public,
            sort_order: settingData.sort_order
          });
          results.push({ key: settingData.key, action: 'updated' });
        } else {
          await this.query().insert({
            key: settingData.key,
            value: String(settingData.value),
            description: settingData.description,
            type: settingData.type,
            category: settingData.category,
            is_public: settingData.is_public,
            sort_order: settingData.sort_order
          });
          results.push({ key: settingData.key, action: 'created' });
        }

      } catch (error) {
        errors.push({ key: settingData.key, error: error.message });
      }
    }

    return { results, errors };
  }
}

module.exports = SystemSettings;