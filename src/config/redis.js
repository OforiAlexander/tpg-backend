// src/config/redis.js - Optional Redis Configuration
const Redis = require('ioredis');
const logger = require('./logger');

let redis = null;

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined, 
  db: process.env.REDIS_DB || 0,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  connectTimeout: 10000,
};

// Create Redis client if enabled
if (process.env.DISABLE_REDIS !== 'true') {
  try {
    redis = new Redis(redisConfig);

    // Handle connection events
    redis.on('connect', () => {
      logger.info('✅ Connected to Redis');
    });

    redis.on('error', (err) => {
      logger.warn('⚠️ Redis connection error (will continue without cache):', { 
        error: err.message 
      });
      // Don't crash the app if Redis is unavailable
    });

    redis.on('close', () => {
      logger.warn('⚠️ Redis connection closed');
    });

  } catch (error) {
    logger.warn('⚠️ Redis initialization failed (continuing without cache):', { 
      error: error.message 
    });
    redis = null;
  }
} else {
  logger.info('📝 Redis disabled via DISABLE_REDIS environment variable');
}

// Create a mock Redis client that does nothing if Redis is unavailable
const mockRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 1,
  exists: async () => 0,
  expire: async () => 1,
  ttl: async () => -1,
  flushdb: async () => 'OK',
  keys: async () => [],
  // Add other Redis methods as needed
};

// Export either real Redis or mock Redis
module.exports = redis || mockRedis;