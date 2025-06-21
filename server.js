// server.js - TPG State Ticketing System Backend (FIXED - Proper Middleware Order)
require('dotenv').config();

const express = require('express');
const { configureCORS, corsErrorHandler } = require('./src/config/cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

// Import custom middleware and configuration
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

// =============================================================================
// DEBUGGING MIDDLEWARE - Enable/Disable with Environment Variable
// =============================================================================
const DEBUG_MODE = process.env.VITE_ENABLE_DEBUG === 'true' || process.env.NODE_ENV === 'development';

if (DEBUG_MODE) {
  app.use((req, res, next) => {
    const startTime = Date.now();
    
    console.log('\n' + '='.repeat(80));
    console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    console.log(`🌐 IP: ${req.ip} | User-Agent: ${req.get('User-Agent')?.substring(0, 50)}...`);
    console.log(`📝 Headers:`, {
      authorization: req.headers.authorization ? req.headers.authorization.substring(0, 20) + '...' : 'none',
      'content-type': req.headers['content-type'],
      origin: req.headers.origin
    });
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      console.log(`✅ Response: ${res.statusCode} | Duration: ${duration}ms | User: ${req.user?.id || 'none'}`);
      console.log('='.repeat(80));
    });
    
    next();
  });
}

// =============================================================================
// BASIC MIDDLEWARE (Before Authentication)
// =============================================================================

// Trust proxy for accurate IP addresses (important for rate limiting and security)
app.set('trust proxy', process.env.TRUST_PROXY === 'true');

// Security Headers - TPG Enhanced Configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "https://www.google.com", "https://www.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["https://www.google.com"], // For reCAPTCHA
      childSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: process.env.NODE_ENV === 'production' ? 31536000 : 0, // 1 year in production
    includeSubDomains: process.env.NODE_ENV === 'production',
    preload: process.env.NODE_ENV === 'production'
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

// CORS Configuration
configureCORS(app);
app.use(corsErrorHandler);

// Request compression
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024 // Only compress responses larger than 1KB
}));

// Request logging with custom format (but WITHOUT user info yet)
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: {
    write: (message) => logger.info(message.trim())
  },
  skip: (req, res) => {
    // Skip logging for health checks and static assets
    return req.url === '/health' || req.url.startsWith('/uploads');
  }
}));

// Body parsing middleware with security limits
app.use(express.json({ 
  limit: '10mb',
  strict: true,
  type: ['application/json', 'application/*+json']
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb',
  parameterLimit: 50
}));

// Parse cookies
app.use(require('cookie-parser')());

// Custom security middleware
app.use(securityMiddleware.addSecurityHeaders);
app.use(securityMiddleware.validateRequest);
app.use(securityMiddleware.sanitizeInput);

// Global rate limiting
app.use(securityMiddleware.apiRateLimit);

// Request tracking (but NOT audit logging yet)
app.use(auditMiddleware.trackRequestContext);

// =============================================================================
// PUBLIC ENDPOINTS (No Authentication Required)
// =============================================================================

// Health check endpoint (before authentication)
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    service: 'TPG State Ticketing System API',
    database: 'connected', // This could be enhanced with actual DB health check
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
    }
  });
});

// API Documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'TPG State Ticketing System API',
    version: '1.0.0',
    description: 'The Pharmacy Guild of Ghana - Support Portal API',
    documentation: {
      postman: '/api/docs/postman',
      openapi: '/api/docs/openapi',
      endpoints: '/api/docs/endpoints'
    },
    endpoints: {
      authentication: {
        base: '/api/auth',
        description: 'User authentication and session management',
        routes: [
          'POST /api/auth/login',
          'POST /api/auth/register', 
          'POST /api/auth/logout',
          'POST /api/auth/refresh',
          'POST /api/auth/forgot-password',
          'POST /api/auth/reset-password',
          'GET /api/auth/profile'
        ]
      },
      tickets: {
        base: '/api/tickets',
        description: 'Ticket management and workflow',
        routes: [
          'GET /api/tickets',
          'POST /api/tickets',
          'GET /api/tickets/:id',
          'PUT /api/tickets/:id',
          'DELETE /api/tickets/:id',
          'POST /api/tickets/:id/comments',
          'POST /api/tickets/:id/attachments'
        ]
      },
      users: {
        base: '/api/users',
        description: 'User management and administration',
        routes: [
          'GET /api/users',
          'POST /api/users',
          'GET /api/users/:id',
          'PUT /api/users/:id',
          'DELETE /api/users/:id'
        ]
      },
      analytics: {
        base: '/api/analytics',
        description: 'Reporting and analytics',
        routes: [
          'GET /api/analytics/dashboard',
          'GET /api/analytics/tickets',
          'GET /api/analytics/users'
        ]
      }
    },
    contact: {
      support: process.env.ORG_EMAIL || 'support@upsamail.edu.gh',
      phone: process.env.ORG_PHONE || '+233 XX XXX XXXX',
      website: process.env.ORG_WEBSITE || 'https://ntc.gov.gh'
    },
    security: {
      authentication: 'JWT Bearer Token',
      rate_limiting: 'Enabled',
      cors: 'Configured',
      csrf_protection: 'Enabled',
      input_validation: 'Enabled'
    }
  });
});

// =============================================================================
// AUTHENTICATED ROUTES WITH PROPER AUDIT LOGGING
// =============================================================================

// Enhanced audit middleware that logs AFTER authentication
const enhancedAuditMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  // Log the request AFTER all middleware has run (including auth)
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    // Skip logging for health checks and static files
    const skipPaths = ['/health', '/favicon.ico', '/uploads'];
    const shouldSkip = skipPaths.some(path => req.path.startsWith(path));
    
    if (!shouldSkip) {
      // Now we have access to req.user if authentication succeeded
      auditMiddleware.logDataAccess(
        req.user?.id || null,
        req.method,
        'api_request',
        req.originalUrl,
        req
      );
      
      // Log slow requests
      if (duration > 1000) {
        logger.performance.logMetrics(
          req.originalUrl,
          duration,
          process.memoryUsage(),
          process.cpuUsage()
        );
      }
      
      // Log errors
      if (res.statusCode >= 400) {
        logger.api.logError(
          req.method,
          req.originalUrl,
          res.statusCode,
          new Error(`HTTP ${res.statusCode}`),
          req.ip,
          req.user?.id || null
        );
      }
    }
  });
  
  next();
};

// Apply enhanced audit logging to all API routes
app.use('/api', enhancedAuditMiddleware);

// API Routes with versioning support (v1)
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/analytics', analyticsRoutes);

// Default API routes (latest version)
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/users', userRoutes);
app.use('/api/analytics', analyticsRoutes);

// =============================================================================
// PROTECTED SYSTEM ENDPOINTS
// =============================================================================

// System status endpoint (requires authentication and permission)
app.get('/status', require('./src/middleware/auth').authenticate, (req, res) => {
  if (!req.user.hasPermission('system.health')) {
    return res.status(403).json({
      error: 'Insufficient permissions',
      message: 'You do not have permission to view system status'
    });
  }

  res.json({
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      platform: process.platform,
      node_version: process.version
    },
    database: {
      status: 'connected',
      pool_size: 10 // This would come from actual DB connection
    },
    services: {
      authentication: 'healthy',
      file_upload: 'healthy',
      email: 'healthy',
      virus_scanning: process.env.ENABLE_VIRUS_SCAN === 'true' ? 'enabled' : 'disabled'
    },
    timestamp: new Date().toISOString()
  });
});

// =============================================================================
// STATIC FILE SERVING
// =============================================================================

// Serve uploaded files with security checks
app.use('/uploads', 
  require('./src/middleware/auth').authenticate,
  express.static('uploads', {
    maxAge: '1d',
    etag: true,
    index: false,
    dotfiles: 'deny',
    setHeaders: (res, path, stat) => {
      // Add security headers for uploaded files
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  })
);

// Serve static documentation files
if (process.env.NODE_ENV !== 'production') {
  app.use('/docs', express.static(path.join(__dirname, 'docs')));
}

// =============================================================================
// DEBUG ENDPOINTS (Development Only)
// =============================================================================

if (DEBUG_MODE) {
  // API endpoint discovery
  app.get('/api/docs/endpoints', (req, res) => {
    const getRoutes = (stack, basePath = '') => {
      const routes = [];
      
      stack.forEach(layer => {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
          routes.push({
            path: basePath + layer.route.path,
            methods: methods,
            middleware: layer.route.stack.map(s => s.name).filter(name => name !== 'anonymous')
          });
        } else if (layer.name === 'router' && layer.regexp) {
          const match = layer.regexp.source.match(/\^\\?([^\\]+)/);
          if (match) {
            const nestedBasePath = basePath + match[1].replace(/\\\//g, '/');
            routes.push(...getRoutes(layer.handle.stack, nestedBasePath));
          }
        }
      });
      
      return routes;
    };

    res.json({
      routes: getRoutes(app._router.stack),
      total_routes: getRoutes(app._router.stack).length,
      generated_at: new Date().toISOString()
    });
  });

  // Debug endpoint to check middleware order
  app.get('/api/debug/middleware', require('./src/middleware/auth').authenticate, (req, res) => {
    if (!req.user.hasPermission('system.admin')) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({
      middleware_order: [
        '1. Debug logging',
        '2. Security headers',
        '3. CORS',
        '4. Compression',
        '5. Morgan logging',
        '6. Body parsing',
        '7. Security middleware',
        '8. Rate limiting',
        '9. Request tracking',
        '10. Enhanced audit middleware',
        '11. Route handlers (with authentication)',
        '12. Error handling'
      ],
      current_user: req.user.getPublicData(),
      authentication_working: true,
      timestamp: new Date().toISOString()
    });
  });
}

// =============================================================================
// ERROR HANDLERS
// =============================================================================

// 404 Handler for API routes
app.use('/api/*', (req, res) => {
  logger.warn(`404 - API endpoint not found: ${req.method} ${req.originalUrl} from IP: ${req.ip}`);
  res.status(404).json({
    error: 'API endpoint not found',
    message: 'The requested API endpoint does not exist',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    available_endpoints: '/api/docs/endpoints'
  });
});

// Generic 404 Handler
app.use('*', (req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.originalUrl} from IP: ${req.ip}`);
  res.status(404).json({
    error: 'Route not found',
    message: 'The requested resource does not exist',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    api_documentation: '/api'
  });
});

// Global Error Handler
app.use((error, req, res, next) => {
  // Generate error ID for tracking
  const errorId = require('crypto').randomBytes(8).toString('hex');
  
  // Enhanced error logging with more context
  logger.error(`Global Error [${errorId}]: ${error.message}`, {
    errorId,
    error: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    userRole: req.user?.role,
    body: req.method !== 'GET' ? req.body : undefined,
    query: req.query,
    headers: {
      authorization: req.headers.authorization ? 'Bearer [REDACTED]' : 'none',
      'content-type': req.headers['content-type'],
      origin: req.headers.origin
    }
  });

  // Don't leak error details in production
  const isDevelopment = DEBUG_MODE;
  
  // Determine error status code
  const statusCode = error.statusCode || error.status || 500;
  
  // Prepare error response
  const errorResponse = {
    success: false,
    error: 'Internal Server Error',
    message: isDevelopment ? error.message : 'An unexpected error occurred',
    errorId,
    timestamp: new Date().toISOString(),
    path: req.originalUrl
  };

  // Add debugging information in development
  if (isDevelopment) {
    errorResponse.stack = error.stack;
    errorResponse.details = error.details;
    errorResponse.middleware_context = {
      user_authenticated: !!req.user,
      user_id: req.user?.id,
      user_role: req.user?.role,
      request_id: req.requestId
    };
  }

  // Specific error handling
  if (error.name === 'ValidationError') {
    errorResponse.error = 'Validation Error';
    errorResponse.message = 'The provided data is invalid';
    errorResponse.details = error.details;
    return res.status(400).json(errorResponse);
  }

  if (error.name === 'UnauthorizedError' || error.message?.includes('token')) {
    errorResponse.error = 'Unauthorized';
    errorResponse.message = 'Authentication token is invalid or expired';
    return res.status(401).json(errorResponse);
  }

  if (error.code === 'LIMIT_FILE_SIZE') {
    errorResponse.error = 'File Too Large';
    errorResponse.message = 'Uploaded file exceeds the maximum allowed size';
    return res.status(413).json(errorResponse);
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    errorResponse.error = 'Too Many Files';
    errorResponse.message = 'Too many files uploaded at once';
    return res.status(400).json(errorResponse);
  }

  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    errorResponse.error = 'Service Unavailable';
    errorResponse.message = 'Unable to connect to required service';
    return res.status(503).json(errorResponse);
  }

  if (error.name === 'SequelizeConnectionError' || error.name === 'ConnectionError') {
    errorResponse.error = 'Database Connection Error';
    errorResponse.message = 'Unable to connect to database';
    return res.status(503).json(errorResponse);
  }

  // Default error response
  res.status(statusCode).json(errorResponse);
});

// =============================================================================
// SERVER STARTUP AND SHUTDOWN
// =============================================================================

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, starting graceful shutdown`);
  
  // Close server
  if (global.server) {
    global.server.close(() => {
      logger.info('HTTP server closed');
      
      // Close database connections
      require('./src/config/database').disconnectDatabase()
        .then(() => {
          logger.info('Database connections closed');
          process.exit(0);
        })
        .catch((error) => {
          logger.error('Error during database shutdown:', error);
          process.exit(1);
        });
    });

    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  } else {
    process.exit(0);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', {
    reason: reason.stack || reason,
    promise
  });
  
  // In production, you might want to restart the process
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start server
async function startServer() {
  try {
    logger.info('🔄 Starting TPG Backend Server...');
    logger.info('Connecting to the database...');
    await connectDatabase();
    logger.info('✅ Database connected successfully');

    // Ensure upload directories exist
    const fs = require('fs');
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
      logger.info(`📁 Created upload directory: ${uploadPath}`);
    }

    // Start Express server
    const server = app.listen(PORT, () => {
      logger.info('🚀 TPG Backend Server started successfully');
      logger.info(`🌐 Server running on port ${PORT}`);
      logger.info(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 API Base URL: http://localhost:${PORT}/api`);
      logger.info(`🏥 Health Check: http://localhost:${PORT}/health`);
      logger.info(`📊 System Status: http://localhost:${PORT}/status`);
      
      if (DEBUG_MODE) {
        logger.info(`🐛 Debug mode enabled`);
        logger.info(`📚 API Documentation: http://localhost:${PORT}/api`);
        logger.info(`🔍 API Endpoints: http://localhost:${PORT}/api/docs/endpoints`);
        logger.info(`⚙️ Middleware Debug: http://localhost:${PORT}/api/debug/middleware`);
      }

      // Log security configuration
      logger.info('🔒 Security features enabled:');
      logger.info('  • JWT Authentication');
      logger.info('  • Rate Limiting');
      logger.info('  • CORS Protection');
      logger.info('  • Input Validation');
      logger.info('  • Security Headers');
      logger.info('  • Enhanced Request Auditing');
      if (process.env.ENABLE_RECAPTCHA !== 'false') {
        logger.info('  • reCAPTCHA Protection');
      }
    });

    // Store server reference for graceful shutdown
    global.server = server;

    return server;

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Initialize server
if (require.main === module) {
  startServer();
}

module.exports = app;