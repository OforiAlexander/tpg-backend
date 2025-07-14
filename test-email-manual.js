// Manual email testing script - Run this to test actual email sending
// Usage: node test-emails-manual.js

// Set environment variables
process.env.NODE_ENV = 'development';
process.env.EMAIL_HOST = 'sandbox.smtp.mailtrap.io';
process.env.EMAIL_PORT = '2525';
process.env.EMAIL_USER = '04aed909b5d623';
process.env.EMAIL_PASSWORD = 'c718d81163dcd9';
process.env.EMAIL_FROM = 'TPG Support <noreply@upsamail.edu.gh>';
process.env.EMAIL_SECURE = 'false';
process.env.SUPPORT_EMAIL = 'alexander.ofori@upsamail.edu.gh';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.ENABLE_EMAIL_NOTIFICATIONS = 'true';

const nodemailer = require('nodemailer');
const enhancedEmailService = require('./src/services/enhancedEmailService');

// Mock user data
const testUser = {
  id: 1,
  username: 'testuser',
  email: 'test@example.com', // Change this to your email for testing
  pharmacy_name: 'Test Pharmacy',
  tpg_license_number: 'TPG1234'
};

async function testEmailSending() {
  console.log('🧪 Testing Email Service...\n');

  try {
    // Test 1: Basic SMTP Configuration
    console.log('1️⃣ Testing SMTP Configuration...');
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    await transporter.verify();
    console.log('✅ SMTP configuration is valid');

    // Test 2: Simple Email Send
    console.log('\n2️⃣ Testing Simple Email Send...');
    const result = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: testUser.email,
      subject: 'Test Email - SMTP Verification',
      text: 'This is a test email to verify SMTP configuration.',
      html: '<p>This is a test email to verify SMTP configuration.</p>'
    });
    console.log('✅ Simple email sent successfully');
    console.log('Message ID:', result.messageId);

    // Test 3: Enhanced Email Service Health Check
    console.log('\n3️⃣ Testing Enhanced Email Service...');
    const healthCheck = await enhancedEmailService.healthCheck();
    console.log('Email service health:', healthCheck);

    // Test 4: Template-based Emails (if service is working)
    if (healthCheck.status === 'healthy') {
      console.log('\n4️⃣ Testing Template-based Emails...');
      
      // Test welcome email
      try {
        await enhancedEmailService.sendWelcomeEmail(testUser, 'test-token-123');
        console.log('✅ Welcome email sent successfully');
      } catch (error) {
        console.log('❌ Welcome email failed:', error.message);
      }

      // Test password reset email
      try {
        await enhancedEmailService.sendPasswordResetEmail(testUser, 'reset-token-456');
        console.log('✅ Password reset email sent successfully');
      } catch (error) {
        console.log('❌ Password reset email failed:', error.message);
      }

      // Test account locked email
      try {
        await enhancedEmailService.sendAccountLockedEmail(testUser, 'Too many failed attempts', 30);
        console.log('✅ Account locked email sent successfully');
      } catch (error) {
        console.log('❌ Account locked email failed:', error.message);
      }

      // Test security alert
      try {
        await enhancedEmailService.sendSecurityAlert(testUser, 'login_from_new_device', {
          ipAddress: '192.168.1.1',
          userAgent: 'Test Browser',
          location: 'Test Location'
        });
        console.log('✅ Security alert email sent successfully');
      } catch (error) {
        console.log('❌ Security alert email failed:', error.message);
      }

      // Test password changed notification
      try {
        await enhancedEmailService.sendPasswordChangedNotification(testUser, '192.168.1.1', 'Test Browser');
        console.log('✅ Password changed notification sent successfully');
      } catch (error) {
        console.log('❌ Password changed notification failed:', error.message);
      }
    }

    console.log('\n🎉 Email testing completed successfully!');
    console.log('📧 Check your Mailtrap inbox for the test emails');

  } catch (error) {
    console.error('❌ Email testing failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testEmailSending().then(() => {
  console.log('\n✅ Manual email testing finished');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Manual email testing failed:', error);
  process.exit(1);
});