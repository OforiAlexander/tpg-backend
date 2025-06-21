// src/database/migrations/001_create_tpg_tables.js
// Initial TPG State Ticketing System Database Schema

exports.up = function(knex) {
  return knex.schema
    // Create ENUM types first
    .raw(`
      -- User roles
      CREATE TYPE user_role AS ENUM ('user', 'admin', 'super_admin');
      
      -- User status
      CREATE TYPE user_status AS ENUM ('active', 'pending', 'suspended', 'locked');
      
      -- Ticket categories (TPG-specific)
      CREATE TYPE ticket_category AS ENUM (
        'cpd-points',
        'license-management', 
        'performance-issues',
        'payment-gateway',
        'user-interface',
        'data-inconsistencies',
        'system-errors'
      );
      
      -- Ticket urgency levels
      CREATE TYPE ticket_urgency AS ENUM ('low', 'medium', 'high', 'critical');
      
      -- Ticket status
      CREATE TYPE ticket_status AS ENUM ('open', 'in-progress', 'resolved', 'closed');
      
      -- Security event types
      CREATE TYPE security_event_type AS ENUM (
        'login_success',
        'login_failed',
        'password_changed',
        'account_locked',
        'permission_denied',
        'suspicious_activity',
        'email_verified',
        'password_reset_requested',
        'password_reset_completed'
      );
    `)
    
    // Users table
    .createTable('users', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('username', 255).notNullable();
      table.string('email', 255).unique().notNullable();
      table.string('password_hash', 255).notNullable();
      table.specificType('role', 'user_role').notNullable().defaultTo('user');
      table.specificType('status', 'user_status').notNullable().defaultTo('pending');
      
      // TPG-specific fields
      table.string('tpg_license_number', 50);
      table.string('pharmacy_name', 255);
      table.string('phone_number', 20);
      table.text('address');
      
      // Security fields
      table.integer('failed_login_attempts').defaultTo(0);
      table.timestamp('locked_until');
      table.timestamp('email_verified_at');
      table.string('email_verification_token', 255);
      table.string('password_reset_token', 255);
      table.timestamp('password_reset_expires');
      table.timestamp('last_login');
      table.specificType('last_login_ip', 'INET');
      table.text('last_user_agent');
      
      // Timestamps
      table.timestamps(true, true);
      
      // Additional profile data as JSON
      table.jsonb('profile_data');
      table.jsonb('preferences').defaultTo('{}');
      
      // Indexes
      table.index(['email']);
      table.index(['role']);
      table.index(['status']);
      table.index(['tpg_license_number']);
      table.index(['created_at']);
    })
    
    // Tickets table
    .createTable('tickets', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('ticket_number', 20).unique().notNullable(); // TPG-0001 format
      table.string('title', 500).notNullable();
      table.text('description').notNullable();
      table.specificType('category', 'ticket_category').notNullable();
      table.specificType('urgency', 'ticket_urgency').notNullable().defaultTo('medium');
      table.specificType('status', 'ticket_status').notNullable().defaultTo('open');
      
      // User relationships
      table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
      table.uuid('assigned_to').references('id').inTable('users').onDelete('SET NULL');
      
      // Timestamps
      table.timestamps(true, true);
      table.timestamp('resolved_at');
      table.timestamp('closed_at');
      table.timestamp('first_response_at');
      
      // Resolution tracking
      table.integer('estimated_resolution_hours');
      table.integer('actual_resolution_hours');
      table.text('resolution_notes');
      
      // Additional data
      table.specificType('tags', 'text[]').defaultTo('{}');
      table.jsonb('metadata').defaultTo('{}');
      table.integer('satisfaction_rating'); // 1-5 rating
      table.text('satisfaction_comment');
      
      // Indexes
      table.index(['ticket_number']);
      table.index(['user_id']);
      table.index(['assigned_to']);
      table.index(['category']);
      table.index(['urgency']);
      table.index(['status']);
      table.index(['created_at']);
      table.index(['resolved_at']);
    })
    
    // Ticket comments table
    .createTable('ticket_comments', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('ticket_id').references('id').inTable('tickets').onDelete('CASCADE').notNullable();
      table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
      table.text('content').notNullable();
      table.boolean('is_internal').defaultTo(false); // Internal admin comments
      table.boolean('is_edited').defaultTo(false);
      table.timestamp('edited_at');
      table.timestamps(true, true);
      
      // Indexes
      table.index(['ticket_id']);
      table.index(['user_id']);
      table.index(['created_at']);
      table.index(['is_internal']);
    })
    
    // Ticket attachments table
    .createTable('ticket_attachments', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('ticket_id').references('id').inTable('tickets').onDelete('CASCADE').notNullable();
      table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
      table.string('filename', 255).notNullable();
      table.string('original_filename', 255).notNullable();
      table.string('file_path', 500).notNullable();
      table.integer('file_size').notNullable();
      table.string('mime_type', 100).notNullable();
      table.string('virus_scan_status', 20).defaultTo('pending'); // pending, clean, infected
      table.text('virus_scan_details');
      table.timestamps(true, true);
      
      // Indexes
      table.index(['ticket_id']);
      table.index(['user_id']);
      table.index(['virus_scan_status']);
      table.index(['created_at']);
    })
    
    // Audit logs table
    .createTable('audit_logs', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
      table.string('action', 100).notNullable(); // create, update, delete, login, etc.
      table.string('resource_type', 50).notNullable(); // user, ticket, comment, etc.
      table.string('resource_id', 100);
      table.jsonb('old_values');
      table.jsonb('new_values');
      table.specificType('ip_address', 'INET');
      table.text('user_agent');
      table.string('session_id', 255);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes
      table.index(['user_id']);
      table.index(['action']);
      table.index(['resource_type']);
      table.index(['resource_id']);
      table.index(['created_at']);
      table.index(['ip_address']);
    })
    
    // Security events table
    .createTable('security_events', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
      table.specificType('event_type', 'security_event_type').notNullable();
      table.jsonb('details').defaultTo('{}');
      table.specificType('ip_address', 'INET');
      table.text('user_agent');
      table.string('severity', 20).defaultTo('info'); // info, warning, error, critical
      table.boolean('resolved').defaultTo(false);
      table.text('resolution_notes');
      table.timestamp('resolved_at');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes
      table.index(['user_id']);
      table.index(['event_type']);
      table.index(['severity']);
      table.index(['resolved']);
      table.index(['created_at']);
      table.index(['ip_address']);
    })
    
    // TPG categories configuration table
    .createTable('categories', table => {
      table.string('id', 50).primary(); // matches enum values
      table.string('name', 255).notNullable();
      table.text('description');
      table.string('icon', 50);
      table.string('color', 20);
      table.boolean('is_active').defaultTo(true);
      table.boolean('requires_escalation').defaultTo(false);
      table.integer('estimated_resolution_hours');
      table.integer('sla_hours'); // Service Level Agreement
      table.specificType('auto_escalate_after_hours', 'integer');
      table.jsonb('examples').defaultTo('[]');
      table.jsonb('common_solutions').defaultTo('[]');
      table.timestamps(true, true);
      
      // Indexes
      table.index(['is_active']);
      table.index(['requires_escalation']);
    })
    
    // System settings table
    .createTable('system_settings', table => {
      table.string('key', 100).primary();
      table.text('value');
      table.string('description', 500);
      table.string('type', 20).defaultTo('string'); // string, number, boolean, json
      table.boolean('is_public').defaultTo(false); // Can be accessed by frontend
      table.timestamps(true, true);
      
      // Indexes
      table.index(['is_public']);
    })
    
    // Email templates table
    .createTable('email_templates', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('name', 100).unique().notNullable();
      table.string('subject', 255).notNullable();
      table.text('html_content').notNullable();
      table.text('text_content').notNullable();
      table.jsonb('variables').defaultTo('[]'); // Available template variables
      table.boolean('is_active').defaultTo(true);
      table.timestamps(true, true);
      
      // Indexes
      table.index(['name']);
      table.index(['is_active']);
    })
    
    // Sessions table (for session storage)
    .createTable('sessions', table => {
      table.string('session_id', 255).primary();
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.jsonb('session_data');
      table.specificType('ip_address', 'INET');
      table.text('user_agent');
      table.timestamp('expires_at').notNullable();
      table.timestamps(true, true);
      
      // Indexes
      table.index(['user_id']);
      table.index(['expires_at']);
      table.index(['created_at']);
    });
};

exports.down = function(knex) {
  return knex.schema
    // Drop tables in reverse order (due to foreign key constraints)
    .dropTableIfExists('sessions')
    .dropTableIfExists('email_templates')
    .dropTableIfExists('system_settings')
    .dropTableIfExists('categories')
    .dropTableIfExists('security_events')
    .dropTableIfExists('audit_logs')
    .dropTableIfExists('ticket_attachments')
    .dropTableIfExists('ticket_comments')
    .dropTableIfExists('tickets')
    .dropTableIfExists('users')
    
    // Drop custom types
    .raw(`
      DROP TYPE IF EXISTS security_event_type;
      DROP TYPE IF EXISTS ticket_status;
      DROP TYPE IF EXISTS ticket_urgency;
      DROP TYPE IF EXISTS ticket_category;
      DROP TYPE IF EXISTS user_status;
      DROP TYPE IF EXISTS user_role;
    `);
};