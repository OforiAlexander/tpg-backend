const cors = require('cors');

/**
 * CORS Configuration for TPG Backend
 * Supports both development and production environments
 * Configure via environment variables for security
 */

// Get environment configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_DEBUG = process.env.CORS_DEBUG === 'true';

// Default allowed origins for development
const DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',     // React default
  'http://localhost:8080',     // Your frontend
  'http://localhost:5173',     // Vite default
  'http://localhost:4200',     // Angular default
  'http://127.0.0.1:3000',     // Alternative localhost
  'http://127.0.0.1:8080',     // Alternative localhost
  'http://127.0.0.1:5173',     // Alternative localhost
  'http://localhost:8081',     // Additional dev port
  'http://localhost:3001',     // Additional dev port
];

// Production origins from environment variables
const PRODUCTION_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [];

// Combine origins based on environment
const getAllowedOrigins = () => {
  let origins = [];
  
  if (NODE_ENV === 'development') {
    origins = [...DEVELOPMENT_ORIGINS];
    
    // Add any additional dev origins from env
    if (process.env.DEV_ORIGINS) {
      const additionalDevOrigins = process.env.DEV_ORIGINS.split(',').map(o => o.trim());
      origins.push(...additionalDevOrigins);
    }
  }
  
  if (NODE_ENV === 'production') {
    origins = [...PRODUCTION_ORIGINS];
  }
  
  if (NODE_ENV === 'staging' || NODE_ENV === 'testing') {
    // Include both dev and production origins for staging
    origins = [...DEVELOPMENT_ORIGINS, ...PRODUCTION_ORIGINS];
  }
  
  return [...new Set(origins)]; // Remove duplicates
};

// CORS Options Configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = getAllowedOrigins();
    
    // Allow requests with no origin (mobile apps, curl, Postman, etc.)
    if (!origin) {
      if (CORS_DEBUG) {
        console.log('✅ CORS: Allowing request with no origin');
      }
      return callback(null, true);
    }
    
    // Check if origin is allowed
    if (allowedOrigins.includes(origin)) {
      if (CORS_DEBUG) {
        console.log(`✅ CORS: Allowing origin: ${origin}`);
      }
      callback(null, true);
    } else {
      if (CORS_DEBUG || NODE_ENV === 'development') {
        console.log(`❌ CORS: Blocking origin: ${origin}`);
        console.log(`🔍 CORS: Allowed origins:`, allowedOrigins);
      }
      
      // Log security event
      if (logger && logger.security) {
        logger.security.logSuspiciousActivity(
          'cors_blocked',
          { origin, allowedOrigins },
          null,
          null
        );
      }
      
      callback(new Error('Not allowed by CORS'));
    }
  },
  
  // Allow credentials (cookies, authorization headers)
  credentials: true,
  
  // Successful preflight response status
  optionsSuccessStatus: 200,
  
  // Allowed HTTP methods
  methods: [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'OPTIONS',
    'HEAD'
  ],
  
  // Allowed headers
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-API-Key',
    'X-Forwarded-For',
    'X-Real-IP',
    'User-Agent',
    'Cache-Control',
    'Pragma',
    'X-Request-ID'
  ],
  
  // Headers exposed to the client
  exposedHeaders: [
    'X-Total-Count',
    'X-Request-ID',
    'X-Response-Time',
    'X-Rate-Limit-Remaining',
    'X-Rate-Limit-Reset'
  ],
  
  // Preflight cache duration (24 hours)
  maxAge: 86400,
  
  // Handle preflight requests
  preflightContinue: false
};

// Development override - allow all origins if explicitly enabled
if (NODE_ENV === 'development' && process.env.CORS_ALLOW_ALL === 'true') {
  console.log('⚠️  CORS: Development mode - allowing ALL origins');
  corsOptions.origin = true;
}

// Apply CORS middleware
const configureCORS = (app) => {
  // Apply CORS with options
  app.use(cors(corsOptions));
  
  // Additional CORS headers for specific routes if needed
  app.use('/api/auth', cors({
    ...corsOptions,
    // More restrictive for auth endpoints if needed
    maxAge: 3600 // 1 hour cache for auth preflight
  }));
  
  // Log CORS configuration on startup
  if (NODE_ENV === 'development' || CORS_DEBUG) {
    console.log('🌐 CORS Configuration:');
    console.log(`   Environment: ${NODE_ENV}`);
    console.log(`   Allowed Origins: ${getAllowedOrigins().join(', ')}`);
    console.log(`   Credentials: ${corsOptions.credentials}`);
    console.log(`   Methods: ${corsOptions.methods.join(', ')}`);
    console.log(`   Debug Mode: ${CORS_DEBUG}`);
  }
  
  return app;
};

// CORS Error Handler
const corsErrorHandler = (err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    // Log the blocked request
    if (logger && logger.security) {
      logger.security.logSuspiciousActivity(
        'cors_violation',
        {
          origin: req.headers.origin,
          referer: req.headers.referer,
          userAgent: req.headers['user-agent'],
          ip: req.ip
        },
        req.ip,
        req.headers['user-agent']
      );
    }
    
    return res.status(403).json({
      success: false,
      error: 'CORS_ERROR',
      message: 'Cross-origin request blocked',
      timestamp: new Date().toISOString(),
      ...(NODE_ENV === 'development' && {
        debug: {
          origin: req.headers.origin,
          allowedOrigins: getAllowedOrigins()
        }
      })
    });
  }
  
  next(err);
};

// Environment Variables Documentation
const CORS_ENV_DOCS = `
CORS Environment Variables:
==========================

Required for Production:
- ALLOWED_ORIGINS: Comma-separated list of allowed origins
  Example: ALLOWED_ORIGINS="https://tpg.gov.gh,https://www.tpg.gov.gh"

Optional:
- CORS_DEBUG: Enable CORS debugging (true/false)
- CORS_ALLOW_ALL: Allow all origins in development (true/false) - DANGEROUS
- DEV_ORIGINS: Additional development origins (comma-separated)

Example .env file:
NODE_ENV=production
ALLOWED_ORIGINS="https://tpg.gov.gh,https://api.tpg.gov.gh"
CORS_DEBUG=false
`;

// Export configuration and helper functions
module.exports = {
  configureCORS,
  corsErrorHandler,
  corsOptions,
  getAllowedOrigins,
  CORS_ENV_DOCS
};