// src/database/seeds/001_tpg_initial_data.js
// Initial TPG data seeding

const bcrypt = require('bcryptjs');

exports.seed = async function(knex) {
  // Clear existing data (in correct order due to foreign keys)
  await knex('ticket_attachments').del();
  await knex('ticket_comments').del();
  await knex('tickets').del();
  await knex('sessions').del();
  await knex('security_events').del();
  await knex('audit_logs').del();
  await knex('email_templates').del();
  await knex('system_settings').del();
  await knex('categories').del();
  await knex('users').del();

  // Insert TPG categories
  await knex('categories').insert([
    {
      id: 'cpd-points',
      name: 'CPD Points Issues',
      description: 'Problems with Continuing Professional Development points tracking, allocation, or verification',
      icon: 'FileText',
      color: 'text-blue-600',
      is_active: true,
      requires_escalation: false,
      estimated_resolution_hours: 48,
      sla_hours: 72,
      examples: JSON.stringify([
        'CPD points not reflecting after course completion',
        'Incorrect CPD credit allocation for completed training',
        'CPD certificate verification and download issues',
        'CPD requirement clarification and guidance needed',
        'Historical CPD records missing or incorrect'
      ]),
      common_solutions: JSON.stringify([
        'Check if course completion was properly submitted',
        'Verify course provider is TPG-approved',
        'Allow 48 hours for automatic point allocation',
        'Contact course provider for completion confirmation'
      ])
    },
    {
      id: 'license-management',
      name: 'License Management Problems',
      description: 'Issues with pharmacy license registration, renewal, or documentation',
      icon: 'Shield',
      color: 'text-purple-600',
      is_active: true,
      requires_escalation: true,
      estimated_resolution_hours: 72,
      sla_hours: 120,
      examples: JSON.stringify([
        'License renewal application processing delays',
        'License verification and status checking problems',
        'Required documentation upload failures',
        'License certificate download and printing issues',
        'License transfer between regions or facilities'
      ]),
      common_solutions: JSON.stringify([
        'Ensure all required documents are uploaded',
        'Verify payment confirmation receipt',
        'Check license renewal deadline requirements',
        'Contact regional office for status updates'
      ])
    },
    {
      id: 'performance-issues',
      name: 'Performance Issues',
      description: 'System slowness, timeouts, or general performance problems',
      icon: 'Zap',
      color: 'text-orange-600',
      is_active: true,
      requires_escalation: false,
      estimated_resolution_hours: 24,
      sla_hours: 48,
      examples: JSON.stringify([
        'Portal pages loading very slowly or timing out',
        'Dashboard taking excessive time to display data',
        'File upload processes hanging or failing',
        'Search functionality responding slowly',
        'System freezing during peak usage hours'
      ]),
      common_solutions: JSON.stringify([
        'Clear browser cache and cookies',
        'Try accessing during off-peak hours',
        'Use latest version of supported browsers',
        'Check internet connection stability'
      ])
    },
    {
      id: 'payment-gateway',
      name: 'Payment Gateway Issues',
      description: 'Problems with payments, transactions, or billing processes',
      icon: 'CreditCard',
      color: 'text-green-600',
      is_active: true,
      requires_escalation: true,
      estimated_resolution_hours: 24,
      sla_hours: 48,
      auto_escalate_after_hours: 8,
      examples: JSON.stringify([
        'Payment processing failures or error messages',
        'Successful payment not reflecting in account',
        'Credit/debit card payment methods not working',
        'Mobile money payment integration problems',
        'Billing amount discrepancies or incorrect charges'
      ]),
      common_solutions: JSON.stringify([
        'Check payment confirmation email/SMS',
        'Verify card details and expiry date',
        'Ensure sufficient account balance',
        'Contact bank for transaction authorization'
      ])
    },
    {
      id: 'user-interface',
      name: 'User Interface Problems',
      description: 'Issues with the website interface, navigation, or user experience',
      icon: 'Settings',
      color: 'text-indigo-600',
      is_active: true,
      requires_escalation: false,
      estimated_resolution_hours: 24,
      sla_hours: 48,
      examples: JSON.stringify([
        'Buttons or links not responding to clicks',
        'Navigation menu not displaying correctly',
        'Form fields not accepting input properly',
        'Mobile or tablet display formatting issues',
        'Page layout broken or elements overlapping'
      ]),
      common_solutions: JSON.stringify([
        'Try refreshing the page',
        'Clear browser cache and cookies',
        'Disable browser extensions temporarily',
        'Try using a different browser'
      ])
    },
    {
      id: 'data-inconsistencies',
      name: 'Data Inconsistencies',
      description: 'Problems with incorrect, missing, or outdated information',
      icon: 'Database',
      color: 'text-red-600',
      is_active: true,
      requires_escalation: true,
      estimated_resolution_hours: 48,
      sla_hours: 96,
      examples: JSON.stringify([
        'Personal or professional information showing incorrectly',
        'Historical records missing from account',
        'Duplicate entries appearing in system',
        'Profile information not updating after changes',
        'Inconsistent data between different portal sections'
      ]),
      common_solutions: JSON.stringify([
        'Verify information with official documents',
        'Check for pending approval processes',
        'Contact TPG office with supporting documents',
        'Allow time for data synchronization'
      ])
    },
    {
      id: 'system-errors',
      name: 'System Errors',
      description: 'Technical errors, bugs, or system malfunctions',
      icon: 'Bug',
      color: 'text-gray-600',
      is_active: true,
      requires_escalation: false,
      estimated_resolution_hours: 24,
      sla_hours: 72,
      examples: JSON.stringify([
        'Error messages appearing during normal operations',
        'System crashes or unexpected logouts',
        'Features not working as expected or documented',
        'Database connection errors or timeouts',
        'File corruption or inaccessible documents'
      ]),
      common_solutions: JSON.stringify([
        'Note exact error message and screenshot',
        'Try logging out and logging back in',
        'Clear browser data and restart browser',
        'Contact support with detailed error information'
      ])
    }
  ]);

  // Insert default admin user (if environment variable is set)
  if (process.env.SEED_DEFAULT_ADMIN === 'true') {
    const hashedPassword = await bcrypt.hash(
      process.env.DEFAULT_ADMIN_PASSWORD || 'TempPassword123!', 
      parseInt(process.env.BCRYPT_ROUNDS) || 12
    );

    await knex('users').insert([
      {
        id: knex.raw('gen_random_uuid()'),
        username: 'TPG System Administrator',
        email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@tpg.gov.gh',
        password_hash: hashedPassword,
        role: 'super_admin',
        status: 'active',
        tpg_license_number: 'ADMIN-001',
        pharmacy_name: 'TPG Administrative Office',
        phone_number: process.env.ORG_PHONE || '+233 XX XXX XXXX',
        address: process.env.ORG_ADDRESS || 'Accra, Ghana',
        email_verified_at: knex.fn.now(),
        preferences: JSON.stringify({
          email_notifications: true,
          dashboard_layout: 'expanded',
          theme: 'light'
        }),
        profile_data: JSON.stringify({
          department: 'IT Administration',
          join_date: new Date().toISOString(),
          bio: 'Default system administrator account for TPG State Portal'
        })
      }
    ]);
  }

  // Insert system settings
  await knex('system_settings').insert([
    {
      key: 'system_name',
      value: 'TPG State Portal',
      description: 'Name of the ticketing system',
      type: 'string',
      is_public: true
    },
    {
      key: 'organization_name',
      value: 'The Pharmacy Guild of Ghana',
      description: 'Full organization name',
      type: 'string',
      is_public: true
    },
    {
      key: 'organization_short_name',
      value: 'TPG',
      description: 'Short organization name',
      type: 'string',
      is_public: true
    },
    {
      key: 'support_email',
      value: process.env.ORG_EMAIL || 'support@tpg.gov.gh',
      description: 'Primary support email address',
      type: 'string',
      is_public: true
    },
    {
      key: 'support_phone',
      value: process.env.ORG_PHONE || '+233 XX XXX XXXX',
      description: 'Primary support phone number',
      type: 'string',
      is_public: true
    },
    {
      key: 'business_hours_start',
      value: '08:00',
      description: 'Business hours start time',
      type: 'string',
      is_public: true
    },
    {
      key: 'business_hours_end',
      value: '17:00',
      description: 'Business hours end time',
      type: 'string',
      is_public: true
    },
    {
      key: 'ticket_id_prefix',
      value: process.env.TICKET_ID_PREFIX || 'TPG',
      description: 'Prefix for ticket numbers',
      type: 'string',
      is_public: false
    },
    {
      key: 'default_ticket_urgency',
      value: process.env.DEFAULT_TICKET_URGENCY || 'medium',
      description: 'Default urgency level for new tickets',
      type: 'string',
      is_public: false
    },
    {
      key: 'max_login_attempts',
      value: process.env.MAX_LOGIN_ATTEMPTS || '5',
      description: 'Maximum failed login attempts before account lockout',
      type: 'number',
      is_public: false
    },
    {
      key: 'account_lockout_duration',
      value: process.env.ACCOUNT_LOCKOUT_DURATION || '900000',
      description: 'Account lockout duration in milliseconds',
      type: 'number',
      is_public: false
    },
    {
      key: 'email_domain',
      value: process.env.EMAIL_DOMAIN || '@tpg.gov.gh',
      description: 'Allowed email domain for user registration',
      type: 'string',
      is_public: true
    },
    {
      key: 'enable_user_registration',
      value: process.env.ENABLE_USER_REGISTRATION || 'true',
      description: 'Allow new user registration',
      type: 'boolean',
      is_public: true
    },
    {
      key: 'enable_email_notifications',
      value: process.env.ENABLE_EMAIL_NOTIFICATIONS || 'true',
      description: 'Enable email notifications system-wide',
      type: 'boolean',
      is_public: false
    },
    {
      key: 'system_maintenance_mode',
      value: 'false',
      description: 'Enable maintenance mode',
      type: 'boolean',
      is_public: true
    }
  ]);

  // Insert email templates
  await knex('email_templates').insert([
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'welcome_user',
      subject: 'Welcome to TPG State Portal',
      html_content: `
        <h2>Welcome to TPG State Portal</h2>
        <p>Dear {{username}},</p>
        <p>Your account has been created successfully. You can now access the TPG State Portal for support and assistance.</p>
        <p><strong>Email:</strong> {{email}}</p>
        <p>Please contact our support team if you need any assistance.</p>
        <p>Best regards,<br>TPG Support Team</p>
      `,
      text_content: `
        Welcome to TPG State Portal
        
        Dear {{username}},
        
        Your account has been created successfully. You can now access the TPG State Portal for support and assistance.
        
        Email: {{email}}
        
        Please contact our support team if you need any assistance.
        
        Best regards,
        TPG Support Team
      `,
      variables: JSON.stringify(['username', 'email']),
      is_active: true
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'ticket_created',
      subject: 'New Support Ticket Created - {{ticket_number}}',
      html_content: `
        <h2>Support Ticket Created</h2>
        <p>Dear {{username}},</p>
        <p>Your support ticket has been created successfully.</p>
        <p><strong>Ticket Number:</strong> {{ticket_number}}</p>
        <p><strong>Category:</strong> {{category}}</p>
        <p><strong>Priority:</strong> {{urgency}}</p>
        <p><strong>Title:</strong> {{title}}</p>
        <p>Our team will review your request and respond within the expected timeframe.</p>
        <p>Best regards,<br>TPG Support Team</p>
      `,
      text_content: `
        Support Ticket Created
        
        Dear {{username}},
        
        Your support ticket has been created successfully.
        
        Ticket Number: {{ticket_number}}
        Category: {{category}}
        Priority: {{urgency}}
        Title: {{title}}
        
        Our team will review your request and respond within the expected timeframe.
        
        Best regards,
        TPG Support Team
      `,
      variables: JSON.stringify(['username', 'ticket_number', 'category', 'urgency', 'title']),
      is_active: true
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'password_reset',
      subject: 'Password Reset Request - TPG State Portal',
      html_content: `
        <h2>Password Reset Request</h2>
        <p>Dear {{username}},</p>
        <p>You have requested to reset your password for TPG State Portal.</p>
        <p>Click the link below to reset your password:</p>
        <p><a href="{{reset_link}}">Reset Password</a></p>
        <p>This link will expire in 1 hour.</p>
        <p>If you did not request this reset, please ignore this email.</p>
        <p>Best regards,<br>TPG Support Team</p>
      `,
      text_content: `
        Password Reset Request
        
        Dear {{username}},
        
        You have requested to reset your password for TPG State Portal.
        
        Click the link below to reset your password:
        {{reset_link}}
        
        This link will expire in 1 hour.
        
        If you did not request this reset, please ignore this email.
        
        Best regards,
        TPG Support Team
      `,
      variables: JSON.stringify(['username', 'reset_link']),
      is_active: true
    }
  ]);

  console.log('✅ TPG initial data seeded successfully');
  console.log('📧 Default admin email:', process.env.DEFAULT_ADMIN_EMAIL || 'admin@tpg.gov.gh');
  console.log('🔑 Default admin password:', process.env.DEFAULT_ADMIN_PASSWORD || 'TempPassword123!');
  console.log('⚠️  Remember to change the default admin password after first login');
};