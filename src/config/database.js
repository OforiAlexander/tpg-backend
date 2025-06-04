// src/config/database.js - TPG Database Configuration
const { Model } = require('objection');
const Knex = require('knex');
const logger = require('./logger');

// Database configuration for different environments
const databaseConfig = {
  development: {
    client: 'postgresql',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'tpg_ticketing_dev',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      ssl: false
    },
    pool: {
      min: 2,
      max: 10,
      createTimeoutMillis: 3000,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 100,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: '../database/migrations'
    },
    seeds: {
      directory: '../database/seeds'
    }
  },

  staging: {
    client: 'postgresql',
    connection: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: false }
    },
    pool: {
      min: 2,
      max: 20
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: '../database/migrations'
    }
  },

  production: {
    client: 'postgresql',
    connection: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: true }
    },
    pool: {
      min: 5,
      max: 30,
      createTimeoutMillis: 3000,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 100,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: '../database/migrations'
    },
    acquireConnectionTimeout: 60000
  }
};

const environment = process.env.NODE_ENV || 'development';
const config = databaseConfig[environment];

let knex;

/**
 * Initialize database connection
 */
async function connectDatabase() {
  try {
    // Validate required environment variables for production
    if (environment === 'production') {
      const requiredVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
      const missingVars = requiredVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
      }
    }

    // Initialize Knex connection
    knex = Knex(config);

    // Test the connection
    await knex.raw('SELECT 1');
    
    // Give Objection.js the knex instance
    Model.knex(knex);

    logger.info(`Database connected successfully to ${config.connection.database} on ${config.connection.host}:${config.connection.port}`);
    logger.info(`Database environment: ${environment}`);

    // Run migrations in production/staging
    if (environment !== 'development') {
      logger.info('Running database migrations...');
      await knex.migrate.latest();
      logger.info('Database migrations completed');
    }

    return knex;

  } catch (error) {
    logger.error('Database connection failed:', {
      error: error.message,
      stack: error.stack,
      config: {
        host: config.connection.host,
        port: config.connection.port,
        database: config.connection.database,
        user: config.connection.user
      }
    });
    throw error;
  }
}

/**
 * Close database connection
 */
async function disconnectDatabase() {
  if (knex) {
    try {
      await knex.destroy();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection:', error);
    }
  }
}

/**
 * Get current database connection
 */
function getDatabase() {
  if (!knex) {
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  return knex;
}

/**
 * Check database health
 */
async function checkDatabaseHealth() {
  try {
    await knex.raw('SELECT 1');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: config.connection.database,
      environment
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      database: config.connection.database,
      environment
    };
  }
}

/**
 * Execute database transaction
 */
async function executeTransaction(callback) {
  const trx = await knex.transaction();
  try {
    const result = await callback(trx);
    await trx.commit();
    return result;
  } catch (error) {
    await trx.rollback();
    throw error;
  }
}

/**
 * Get database statistics
 */
async function getDatabaseStats() {
  try {
    const stats = await knex.raw(`
      SELECT 
        schemaname,
        tablename,
        attname,
        n_distinct,
        correlation
      FROM pg_stats 
      WHERE schemaname = 'public'
      ORDER BY tablename, attname
    `);

    const tableStats = await knex.raw(`
      SELECT 
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes
      FROM pg_stat_user_tables
      ORDER BY tablename
    `);

    return {
      columnStats: stats.rows,
      tableStats: tableStats.rows,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error getting database stats:', error);
    return null;
  }
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getDatabase,
  checkDatabaseHealth,
  executeTransaction,
  getDatabaseStats,
  config: databaseConfig[environment]
};
