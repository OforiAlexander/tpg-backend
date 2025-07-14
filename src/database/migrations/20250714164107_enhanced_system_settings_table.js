// Database migration to enhance system_settings table
exports.up = async function(knex) {
    // Check if table exists and add missing columns
    const hasTable = await knex.schema.hasTable('system_settings');
    
    if (!hasTable) {
      // Create the table if it doesn't exist
      await knex.schema.createTable('system_settings', table => {
        table.string('key', 100).primary();
        table.text('value');
        table.string('description', 500);
        table.string('type', 20).defaultTo('string'); // string, number, boolean, json
        table.string('category', 50).defaultTo('general');
        table.boolean('is_public').defaultTo(false); // Can be accessed by frontend
        table.integer('sort_order').defaultTo(0);
        table.timestamps(true, true);
        
        // Indexes
        table.index(['is_public']);
        table.index(['category']);
        table.index(['type']);
        table.index(['sort_order']);
      });
    } else {
      // Add missing columns to existing table
      const columns = await knex('information_schema.columns')
        .where({ table_name: 'system_settings' })
        .pluck('column_name');
  
      await knex.schema.alterTable('system_settings', table => {
        if (!columns.includes('category')) {
          table.string('category', 50).defaultTo('general');
        }
        if (!columns.includes('sort_order')) {
          table.integer('sort_order').defaultTo(0);
        }
        if (!columns.includes('created_at')) {
          table.timestamp('created_at').defaultTo(knex.fn.now());
        }
        if (!columns.includes('updated_at')) {
          table.timestamp('updated_at').defaultTo(knex.fn.now());
        }
      });
  
      // Add indexes if they don't exist
      const indexes = await knex.raw(`
        SELECT indexname FROM pg_indexes 
        WHERE tablename = 'system_settings'
      `);
      
      const existingIndexes = indexes.rows.map(row => row.indexname);
      
      if (!existingIndexes.includes('system_settings_category_index')) {
        await knex.schema.alterTable('system_settings', table => {
          table.index(['category'], 'system_settings_category_index');
        });
      }
      
      if (!existingIndexes.includes('system_settings_sort_order_index')) {
        await knex.schema.alterTable('system_settings', table => {
          table.index(['sort_order'], 'system_settings_sort_order_index');
        });
      }
    }
  
    // Insert default settings if they don't exist
    const existingSettings = await knex('system_settings').select('key');
    const existingKeys = existingSettings.map(s => s.key);
  
    const defaultSettings = [
      // System Settings
      { 
        key: 'site_name', 
        value: 'TPG State Portal', 
        description: 'Application name', 
        type: 'string', 
        category: 'system', 
        is_public: true, 
        sort_order: 1 
      },
      { 
        key: 'site_description', 
        value: 'Teacher Portal Ghana Support System', 
        description: 'Application description', 
        type: 'string', 
        category: 'system', 
        is_public: true, 
        sort_order: 2 
      },
      { 
        key: 'maintenance_mode', 
        value: 'false', 
        description: 'Enable maintenance mode', 
        type: 'boolean', 
        category: 'system', 
        is_public: true, 
        sort_order: 3 
      },
      { 
        key: 'registration_enabled', 
        value: 'true', 
        description: 'Allow new user registration', 
        type: 'boolean', 
        category: 'system', 
        is_public: true, 
        sort_order: 4 
      },
      { 
        key: 'email_verification_required', 
        value: 'true', 
        description: 'Require email verification for new accounts', 
        type: 'boolean', 
        category: 'system', 
        is_public: true, 
        sort_order: 5 
      },
  
      // Email Settings
      { 
        key: 'email_notifications_enabled', 
        value: 'true', 
        description: 'Enable email notifications', 
        type: 'boolean', 
        category: 'email', 
        is_public: false, 
        sort_order: 1 
      },
      { 
        key: 'email_from_name', 
        value: 'TPG Support System', 
        description: 'Email sender name', 
        type: 'string', 
        category: 'email', 
        is_public: false, 
        sort_order: 2 
      },
      { 
        key: 'support_email', 
        value: process.env.SUPPORT_EMAIL || 'support@upsamail.edu.gh', 
        description: 'Support email address', 
        type: 'string', 
        category: 'email', 
        is_public: true, 
        sort_order: 3 
      },
  
      // Security Settings
      { 
        key: 'password_min_length', 
        value: '8', 
        description: 'Minimum password length', 
        type: 'number', 
        category: 'security', 
        is_public: true, 
        sort_order: 1 
      },
      { 
        key: 'password_require_special_chars', 
        value: 'true', 
        description: 'Require special characters in passwords', 
        type: 'boolean', 
        category: 'security', 
        is_public: true, 
        sort_order: 2 
      },
      { 
        key: 'password_require_numbers', 
        value: 'true', 
        description: 'Require numbers in passwords', 
        type: 'boolean', 
        category: 'security', 
        is_public: true, 
        sort_order: 3 
      },
      { 
        key: 'password_require_uppercase', 
        value: 'true', 
        description: 'Require uppercase letters in passwords', 
        type: 'boolean', 
        category: 'security', 
        is_public: true, 
        sort_order: 4 
      },
      { 
        key: 'max_login_attempts', 
        value: '5', 
        description: 'Maximum failed login attempts before account lockout', 
        type: 'number', 
        category: 'security', 
        is_public: false, 
        sort_order: 5 
      },
      { 
        key: 'account_lockout_duration', 
        value: '30', 
        description: 'Account lockout duration in minutes', 
        type: 'number', 
        category: 'security', 
        is_public: false, 
        sort_order: 6 
      },
      { 
        key: 'session_timeout', 
        value: '60', 
        description: 'Session timeout in minutes', 
        type: 'number', 
        category: 'security', 
        is_public: false, 
        sort_order: 7 
      },
      { 
        key: 'two_factor_auth_enabled', 
        value: 'false', 
        description: 'Enable two-factor authentication', 
        type: 'boolean', 
        category: 'security', 
        is_public: true, 
        sort_order: 8 
      },
  
      // Ticket System Settings
      { 
        key: 'auto_assignment_enabled', 
        value: 'true', 
        description: 'Enable automatic ticket assignment', 
        type: 'boolean', 
        category: 'tickets', 
        is_public: false, 
        sort_order: 1 
      },
      { 
        key: 'sla_response_time', 
        value: '4', 
        description: 'SLA first response time in hours', 
        type: 'number', 
        category: 'tickets', 
        is_public: true, 
        sort_order: 2 
      },
      { 
        key: 'sla_resolution_time', 
        value: '24', 
        description: 'SLA resolution time in hours', 
        type: 'number', 
        category: 'tickets', 
        is_public: true, 
        sort_order: 3 
      },
      { 
        key: 'escalation_enabled', 
        value: 'true', 
        description: 'Enable automatic ticket escalation', 
        type: 'boolean', 
        category: 'tickets', 
        is_public: false, 
        sort_order: 4 
      },
      { 
        key: 'escalation_time', 
        value: '8', 
        description: 'Escalation time in hours', 
        type: 'number', 
        category: 'tickets', 
        is_public: false, 
        sort_order: 5 
      },
      { 
        key: 'satisfaction_surveys_enabled', 
        value: 'true', 
        description: 'Enable customer satisfaction surveys', 
        type: 'boolean', 
        category: 'tickets', 
        is_public: true, 
        sort_order: 6 
      },
      { 
        key: 'allow_public_tickets', 
        value: 'false', 
        description: 'Allow tickets from non-registered users', 
        type: 'boolean', 
        category: 'tickets', 
        is_public: true, 
        sort_order: 7 
      },
  
      // File Upload Settings
      { 
        key: 'max_file_upload_size', 
        value: '10485760', 
        description: 'Maximum file upload size in bytes (10MB)', 
        type: 'number', 
        category: 'files', 
        is_public: true, 
        sort_order: 1 
      },
      { 
        key: 'allowed_file_types', 
        value: JSON.stringify(['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx', '.txt']), 
        description: 'Allowed file extensions for uploads', 
        type: 'json', 
        category: 'files', 
        is_public: true, 
        sort_order: 2 
      },
      { 
        key: 'enable_virus_scan', 
        value: 'false', 
        description: 'Enable virus scanning for uploaded files', 
        type: 'boolean', 
        category: 'files', 
        is_public: false, 
        sort_order: 3 
      },
  
      // Organization Settings
      { 
        key: 'org_name', 
        value: process.env.ORG_NAME || 'Teacher Portal Ghana', 
        description: 'Organization name', 
        type: 'string', 
        category: 'organization', 
        is_public: true, 
        sort_order: 1 
      },
      { 
        key: 'org_short_name', 
        value: process.env.ORG_SHORT_NAME || 'TPG', 
        description: 'Organization short name/abbreviation', 
        type: 'string', 
        category: 'organization', 
        is_public: true, 
        sort_order: 2 
      },
      { 
        key: 'org_email', 
        value: process.env.ORG_EMAIL || 'info@tpg.gov.gh', 
        description: 'Organization primary email', 
        type: 'string', 
        category: 'organization', 
        is_public: true, 
        sort_order: 3 
      },
      { 
        key: 'org_phone', 
        value: process.env.ORG_PHONE || '+233 50 123 9711', 
        description: 'Organization phone number', 
        type: 'string', 
        category: 'organization', 
        is_public: true, 
        sort_order: 4 
      },
      { 
        key: 'org_address', 
        value: process.env.ORG_ADDRESS || 'Accra, Ghana', 
        description: 'Organization address', 
        type: 'string', 
        category: 'organization', 
        is_public: true, 
        sort_order: 5 
      },
      { 
        key: 'org_website', 
        value: process.env.ORG_WEBSITE || 'https://ntc.gov.gh', 
        description: 'Organization website URL', 
        type: 'string', 
        category: 'organization', 
        is_public: true, 
        sort_order: 6 
      },
  
      // Notification Settings
      { 
        key: 'notification_frequency', 
        value: 'immediate', 
        description: 'Default notification frequency', 
        type: 'string', 
        category: 'notifications', 
        is_public: false, 
        sort_order: 1 
      },
      { 
        key: 'digest_emails_enabled', 
        value: 'true', 
        description: 'Enable daily digest emails', 
        type: 'boolean', 
        category: 'notifications', 
        is_public: false, 
        sort_order: 2 
      },
      { 
        key: 'digest_frequency', 
        value: 'daily', 
        description: 'Digest email frequency (daily, weekly)', 
        type: 'string', 
        category: 'notifications', 
        is_public: false, 
        sort_order: 3 
      },
  
      // Integration Settings
      { 
        key: 'recaptcha_enabled', 
        value: process.env.ENABLE_RECAPTCHA || 'true', 
        description: 'Enable reCAPTCHA for forms', 
        type: 'boolean', 
        category: 'integrations', 
        is_public: true, 
        sort_order: 1 
      },
      { 
        key: 'google_analytics_enabled', 
        value: 'false', 
        description: 'Enable Google Analytics tracking', 
        type: 'boolean', 
        category: 'integrations', 
        is_public: false, 
        sort_order: 2 
      },
      { 
        key: 'slack_integration_enabled', 
        value: 'false', 
        description: 'Enable Slack notifications', 
        type: 'boolean', 
        category: 'integrations', 
        is_public: false, 
        sort_order: 3 
      },
      { 
        key: 'webhooks_enabled', 
        value: 'false', 
        description: 'Enable webhook notifications', 
        type: 'boolean', 
        category: 'integrations', 
        is_public: false, 
        sort_order: 4 
      }
    ];
  
    // Insert only settings that don't already exist
    for (const setting of defaultSettings) {
      if (!existingKeys.includes(setting.key)) {
        await knex('system_settings').insert(setting);
      }
    }
  
    console.log(`✅ Enhanced system_settings table and inserted ${defaultSettings.filter(s => !existingKeys.includes(s.key)).length} new default settings`);
  };
  
  exports.down = async function(knex) {
    // Only remove the columns we added, don't drop the entire table
    // as it might contain user data
    await knex.schema.alterTable('system_settings', table => {
      table.dropIndex(['category'], 'system_settings_category_index');
      table.dropIndex(['sort_order'], 'system_settings_sort_order_index');
      table.dropColumn('category');
      table.dropColumn('sort_order');
    });
  };