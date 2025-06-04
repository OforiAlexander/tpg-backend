// server.js - TPG State Ticketing System Backend
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

// Import custom middleware and routes
const { connectDatabase } = require('./src/config/database');
const securityMiddleware = require('./src/middleware/security');
const auditMiddleware = require('./src/middleware/audit');
const logger = require('./src/config/logger');

// Import route handlers
const authRoutes = require('./src/routes/api/auth/auth.routes');
const ticketRoutes = require('./src/routes/api/tickets/tickets.routes');
const userRoutes = require('./src/routes/api/users/users.routes');
const analyticsRoutes = require('./src/routes/api/analytics/analytics.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for accurate IP addresses (important for rate limiting)
app.set('trust proxy', 1);

// Security Headers - TPG Configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "https://www.google.com", "https://www.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["https://www.google.com"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS Configuration for TPG Frontend
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',  // Vite dev server
      'http://localhost:3000',  // Alternative dev port
      'https://portal.tpg.gov.gh',  // Production domain
      'https://staging.tpg.gov.gh'  // Staging domain
    ];
    
    // Allow requests with no origin (mobile apps, etc)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count']
};

app.use(cors(corsOptions));

// Request compression
app.use(compression());

// Request logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  strict: true
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Rate limiting - Global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

app.use(globalLimiter);

// Custom security middleware
app.use(securityMiddleware.validateRequest);
app.use(securityMiddleware.sanitizeInput);

// Audit logging middleware
app.use(auditMiddleware.logRequest);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    service: 'TPG State Ticketing System API'
  });
});

// API Documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'TPG State Ticketing System API',
    version: '1.0.0',
    description: 'The Pharmacy Guild of Ghana - Support Portal API',
    documentation: '/api/docs',
    endpoints: {
      auth: '/api/auth',
      tickets: '/api/tickets', 
      users: '/api/users',
      analytics: '/api/analytics'
    },
    support: {
      email: 'support@tpg.gov.gh',
      phone: '+233 XX XXX XXXX'
    }
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/users', userRoutes);
app.use('/api/analytics', analyticsRoutes);

// Serve uploaded files (with security checks)
app.use('/uploads', express.static('uploads', {
  maxAge: '1d',
  etag: false,
  index: false,
  dotfiles: 'deny'
}));

// 404 Handler
app.use('*', (req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.originalUrl} from IP: ${req.ip}`);
  res.status(404).json({
    error: 'API endpoint not found',
    message: 'The requested resource does not exist',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global Error Handler
app.use((error, req, res, next) => {
  // Log the error
  logger.error(`Global Error Handler: ${error.message}`, {
    error: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Determine error status code
  const statusCode = error.statusCode || error.status || 500;
  
  // Prepare error response
  const errorResponse = {
    error: 'Internal Server Error',
    message: isDevelopment ? error.message : 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
    path: req.originalUrl
  };

  // Add stack trace in development
  if (isDevelopment) {
    errorResponse.stack = error.stack;
  }

  // Specific error handling
  if (error.name === 'ValidationError') {
    errorResponse.error = 'Validation Error';
    errorResponse.details = error.details;
    return res.status(400).json(errorResponse);
  }

  if (error.name === 'UnauthorizedError') {
    errorResponse.error = 'Unauthorized';
    errorResponse.message = 'Authentication token is invalid';
    return res.status(401).json(errorResponse);
  }

  if (error.code === 'LIMIT_FILE_SIZE') {
    errorResponse.error = 'File Too Large';
    errorResponse.message = 'Uploaded file exceeds the maximum allowed size';
    return res.status(413).json(errorResponse);
  }

  // Default error response
  res.status(statusCode).json(errorResponse);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start server
async function startServer() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Database connected successfully');

    // Start Express server
    app.listen(PORT, () => {
      logger.info(`🚀 TPG Backend Server started successfully`);
      logger.info(`🌐 Server running on port ${PORT}`);
      logger.info(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 API Base URL: http://localhost:${PORT}/api`);
      logger.info(`🏥 Health Check: http://localhost:${PORT}/health`);
      
      if (process.env.NODE_ENV === 'development') {
        logger.info(`📚 API Documentation: http://localhost:${PORT}/api`);
      }
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Initialize server
startServer();

module.exports = app;
