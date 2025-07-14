// Set environment variables before any module imports
process.env.NODE_ENV = 'development';
process.env.EMAIL_HOST = 'sandbox.smtp.mailtrap.io';
process.env.EMAIL_PORT = '2525';
process.env.EMAIL_USER = '04aed909b5d623';
process.env.EMAIL_PASSWORD = 'c718d81163dcd9';
process.env.EMAIL_FROM = 'TPG Support <noreply@upsamail.edu.gh>';
process.env.EMAIL_SECURE = 'false';
process.env.SUPPORT_EMAIL = 'alexander.ofori@upsamail.edu.gh';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.JWT_SECRET = 'mjuLpY3QgUg3PAm3klM251PDTw6yeLPtiW2SbvoAs3A=';
process.env.JWT_REFRESH_SECRET = 'WTfs49ZqFaLQaQ3vlAC4QHD/txGkp/f9faA7bSmSg3I=';
process.env.MAX_LOGIN_ATTEMPTS = '3';
process.env.ACCOUNT_LOCK_DURATION = '30';
process.env.BCRYPT_ROUNDS = '10';
process.env.ENABLE_EMAIL_NOTIFICATIONS = 'true';

// Reset module cache to ensure environment variables are applied
jest.resetModules();

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const User = require('../src/models/User');
const authRoutes = require('../src/routes/api/auth/auth.routes');
const enhancedEmailService = require('../src/services/enhancedEmailService');
const logger = require('../src/config/logger');

// Initialize Express app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

// Mock dependencies
jest.mock('../src/models/User');
jest.mock('../src/config/logger');
jest.mock('../src/services/recaptchaService', () => ({
  getClientConfig: jest.fn().mockReturnValue({
    enabled: false,
    siteKey: null,
    theme: 'light',
    size: 'normal',
    badge: 'bottomright'
  }),
  healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' })
}));
jest.mock('knex', () => () => ({
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  first: jest.fn().mockResolvedValue(null)
}));

// Mock Nodemailer sendMail and transporter
const mockSendMail = jest.fn();
const mockTransporter = {
  verify: jest.fn().mockResolvedValue(true),
  sendMail: mockSendMail,
  close: jest.fn()
};
nodemailer.createTransport = jest.fn().mockReturnValue(mockTransporter);

// Mock enhancedEmailService.initialize and templates
jest.spyOn(enhancedEmailService, 'initialize').mockResolvedValue();
jest.spyOn(enhancedEmailService, 'loadTemplates').mockResolvedValue({
  'welcome': jest.fn().mockReturnValue('<html>Welcome</html>'),
  'email-verification': jest.fn().mockReturnValue('<html>Verify</html>'),
  'password-reset': jest.fn().mockReturnValue('<html>Reset</html>'),
  'password-reset-confirmation': jest.fn().mockReturnValue('<html>Reset Confirm</html>'),
  'account-locked': jest.fn().mockReturnValue('<html>Locked</html>'),
  'security-alert': jest.fn().mockReturnValue('<html>Security Alert</html>'),
  'login-notification': jest.fn().mockReturnValue('<html>Login</html>'),
  'password-changed': jest.fn().mockReturnValue('<html>Changed</html>')
});

describe('Email Notifications Test Suite', () => {
  let testUser;
  let accessToken;
  let refreshToken;

  // Define mocks outside beforeAll
  testUser = {
    id: 1,
    username: 'testuser',
    email: 'testuser@upsamail.edu.gh',
    password_hash: bcrypt.hashSync('Password123!', 10),
    status: 'pending',
    pharmacy_name: 'Test Pharmacy',
    tpg_license_number: 'TPG1234',
    phone_number: '+233123456789',
    address: '123 Test Street',
    failed_login_attempts: 0,
    last_login_ip: null,
    last_user_agent: null,
    email_verification_token: null,
    email_verification_expires: null,
    password_reset_token: null,
    password_reset_expires: null,
    $query: jest.fn().mockReturnThis(),
    patch: jest.fn().mockResolvedValue(),
    patchAndFetch: jest.fn().mockResolvedValue({
      id: 1,
      username: 'testuser',
      email: 'testuser@upsamail.edu.gh',
      status: 'active',
      getPublicData: jest.fn().mockReturnValue({
        id: 1,
        username: 'testuser',
        email: 'testuser@upsamail.edu.gh',
        status: 'active'
      })
    }),
    increment: jest.fn().mockResolvedValue({ failed_login_attempts: 3 }),
    getPublicData: jest.fn().mockReturnValue({
      id: 1,
      username: 'testuser',
      email: 'testuser@upsamail.edu.gh',
      status: 'active'
    })
  };

  User.query = jest.fn().mockReturnValue({
    where: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation((params) => {
      if (params.email === testUser.email || params.username === testUser.username) {
        return Promise.resolve(testUser);
      }
      return Promise.resolve(null);
    }),
    findById: jest.fn().mockResolvedValue(testUser),
    insert: jest.fn().mockImplementation((data) => {
      if (data.email === testUser.email || data.username === testUser.username) {
        throw new Error('User already exists');
      }
      return Promise.resolve({ ...testUser, ...data });
    })
  });

  // Mock authService
  const authService = require('../src/services/authService');
  authService.generateTokens = jest.fn().mockReturnValue({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresIn: '24h'
  });
  authService.verifyEmail = jest.fn().mockResolvedValue({ user: testUser });
  authService.getUserPermissions = jest.fn().mockResolvedValue({
    role: 'user',
    permissions: ['tickets.create', 'tickets.view.own']
  });
  authService.logout = jest.fn().mockResolvedValue({ success: true });

  // Mock logger
  logger.info = jest.fn();
  logger.error = jest.fn();
  logger.warn = jest.fn();
  logger.security = {
    logSecurityEvent: jest.fn(),
    logAuth: jest.fn(),
    logDataAccess: jest.fn(),
    logSuspiciousActivity: jest.fn()
  };

  beforeAll(async () => {
    jest.setTimeout(10000); // 10 seconds
    await enhancedEmailService.initialize();
  });

  beforeEach(() => {
    mockSendMail.mockReset();
    mockTransporter.close.mockReset();
    testUser.status = 'active'; // Set to active to pass auth middleware
    testUser.failed_login_attempts = 0;
    testUser.email_verification_token = null;
    testUser.password_reset_token = null;
    accessToken = jwt.sign(
      { id: testUser.id, email: testUser.email, type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: '24h', issuer: 'tpg-portal', audience: 'tpg-users' }
    );
    refreshToken = jwt.sign(
      { id: testUser.id, email: testUser.email, type: 'refresh', tokenId: '1234' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d', issuer: 'tpg-portal', audience: 'tpg-users' }
    );
    // Reset User.query mock to handle unique users
    User.query.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation((params) => {
        if (params.email === testUser.email || params.username === testUser.username) {
          return Promise.resolve(testUser);
        }
        return Promise.resolve(null);
      }),
      findById: jest.fn().mockResolvedValue(testUser),
      insert: jest.fn().mockImplementation((data) => {
        if (data.email === testUser.email || data.username === testUser.username) {
          throw new Error('User already exists');
        }
        return Promise.resolve({ ...testUser, ...data });
      })
    });
  });

  test('should verify environment variables', () => {
    const requiredEnvVars = [
      'EMAIL_HOST',
      'EMAIL_PORT',
      'EMAIL_USER',
      'EMAIL_PASSWORD',
      'EMAIL_FROM',
      'SUPPORT_EMAIL',
      'FRONTEND_URL',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
      'ENABLE_EMAIL_NOTIFICATIONS'
    ];
    requiredEnvVars.forEach((envVar) => {
      expect(process.env[envVar]).toBeDefined();
    });
    expect(process.env.ENABLE_EMAIL_NOTIFICATIONS).toBe('true');
    expect(process.env.FRONTEND_URL).toMatch(/^http(s)?:\/\//);
  });

  test('should send welcome email on registration', async () => {
    jest.setTimeout(10000);
    const registerData = {
      username: 'newuser',
      email: 'newuser@upsamail.edu.gh',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      tpg_license_number: 'TPG5678',
      pharmacy_name: 'New Pharmacy',
      phone_number: '+233987654321',
      address: '456 New Street',
      recaptchaToken: ''
    };

    const response = await request(app)
      .post('/api/auth/register')
      .send(registerData);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: process.env.EMAIL_FROM,
        to: 'newuser@upsamail.edu.gh',
        subject: 'Welcome to TPG State Portal',
        html: expect.stringContaining(`${process.env.FRONTEND_URL}/verify-email?token=`)
      })
    );
  });

  test('should send email-verification email when requested', async () => {
    jest.setTimeout(10000);
    const verificationToken = 'mock-verification-token';
    testUser.email_verification_token = verificationToken;
    testUser.email_verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await enhancedEmailService.sendEmailVerification(testUser, verificationToken);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: process.env.EMAIL_FROM,
        to: 'testuser@upsamail.edu.gh',
        subject: 'Verify Your Email Address - TPG Portal',
        html: expect.stringContaining(`${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`)
      })
    );
  });

  test('should send password-reset email on forgot-password request', async () => {
    jest.setTimeout(10000);
    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'testuser@upsamail.edu.gh', recaptchaToken: '' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: process.env.EMAIL_FROM,
        to: 'testuser@upsamail.edu.gh',
        subject: 'Password Reset Request - TPG Portal',
        html: expect.stringContaining(`${process.env.FRONTEND_URL}/reset-password?token=`)
      })
    );
  });

  test('should send password-reset-confirmation email on reset-password', async () => {
    jest.setTimeout(10000);
    const resetToken = 'mock-reset-token';
    testUser.password_reset_token = resetToken;
    testUser.password_reset_expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const response = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, password: 'NewPassword123!', confirmPassword: 'NewPassword123!' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: process.env.EMAIL_FROM,
        to: 'testuser@upsamail.edu.gh',
        subject: 'Password Successfully Reset - TPG Portal',
        html: expect.stringContaining(`${process.env.FRONTEND_URL}/login`)
      })
    );
  });

  test('should send account-locked email after max failed login attempts', async () => {
    jest.setTimeout(10000);
    testUser.failed_login_attempts = 2;
    testUser.status = 'active';

    // Mock increment to simulate account lock
    testUser.increment.mockImplementation(() => {
      testUser.failed_login_attempts += 1;
      if (testUser.failed_login_attempts >= 3) {
        testUser.status = 'locked';
      }
      return Promise.resolve({ failed_login_attempts: testUser.failed_login_attempts });
    });

    for (let i = 0; i < 2; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'testuser@upsamail.edu.gh', password: 'wrong-password' });
    }

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: process.env.EMAIL_FROM,
        to: 'testuser@upsamail.edu.gh',
        subject: 'Account Security Alert - Account Locked',
        html: expect.stringContaining('Account locked')
      })
    );
  });

  test('should send security-alert and login-notification emails on new device login', async () => {
    jest.setTimeout(10000);
    // Mock checkNewDevice as a standalone function
    jest.mock('../src/routes/api/auth/auth.controller', () => {
      const original = jest.requireActual('../src/routes/api/auth/auth.controller');
      return {
        ...original,
        checkNewDevice: jest.fn().mockResolvedValue(true)
      };
    });

    testUser.status = 'active';
    testUser.failed_login_attempts = 0;

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'testuser@upsamail.edu.gh', password: 'Password123!' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: process.env.EMAIL_FROM,
        to: 'testuser@upsamail.edu.gh',
        subject: 'Security Alert - Login from new device detected',
        html: expect.stringContaining(`${process.env.FRONTEND_URL}/security`)
      })
    );
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: process.env.EMAIL_FROM,
        to: 'testuser@upsamail.edu.gh',
        subject: 'New Login to Your TPG Account',
        html: expect.stringContaining(`${process.env.FRONTEND_URL}/security`)
      })
    );
  });

  test('should send password-changed email on password change', async () => {
    jest.setTimeout(10000);
    const response = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: 'Password123!',
        newPassword: 'NewPassword123!',
        confirmNewPassword: 'NewPassword123!'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: process.env.EMAIL_FROM,
        to: 'testuser@upsamail.edu.gh',
        subject: 'Password Changed Successfully - TPG Portal',
        html: expect.stringContaining(`${process.env.FRONTEND_URL}/security`)
      })
    );
  });

  test('should handle invalid FRONTEND_URL', async () => {
    jest.setTimeout(10000);
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'invalid-url';

    const registerData = {
      username: 'newuser2',
      email: 'newuser2@upsamail.edu.gh',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      tpg_license_number: 'TPG9012',
      pharmacy_name: 'New Pharmacy 2',
      phone_number: '+233987654322',
      address: '789 New Street',
      recaptchaToken: ''
    };

    const response = await request(app)
      .post('/api/auth/register')
      .send(registerData);

    expect(response.status).toBe(201);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('invalid-url/verify-email?token=')
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid FRONTEND_URL detected')
    );

    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  test('should verify SMTP configuration with real email send', async () => {
    jest.setTimeout(10000);
    const realTransporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: 'testuser@upsamail.edu.gh',
      subject: 'Test SMTP Configuration',
      text: 'This is a test email to verify SMTP configuration.'
    };

    try {
      const result = await realTransporter.sendMail(mailOptions);
      expect(result).toHaveProperty('messageId');
    } catch (error) {
      console.error('SMTP Test Error:', error);
      throw error;
    } finally {
      realTransporter.close();
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    jest.setTimeout(5000);
    mockTransporter.close();
  });
});