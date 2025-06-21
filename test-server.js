console.log('Starting server...');

try {
    console.log('Loading dotenv...');
    require('dotenv').config();
    console.log('✅ Dotenv loaded');

    console.log('Loading express...');
    const express = require('express');
    console.log('✅ Express loaded');

    console.log('Loading basic npm packages...');
    const cors = require('cors');
    const helmet = require('helmet');
    const compression = require('compression');
    const morgan = require('morgan');
    const path = require('path');
    console.log('✅ Basic packages loaded');

    console.log('Testing database import...');
    const { connectDatabase } = require('./src/config/database');
    console.log('✅ Database module loaded');

    console.log('Testing security middleware...');
    const securityMiddleware = require('./src/middleware/security');
    console.log('✅ Security middleware loaded');

    console.log('Testing audit middleware...');
    const auditMiddleware = require('./src/middleware/audit');
    console.log('✅ Audit middleware loaded');

    console.log('Testing logger...');
    const logger = require('./src/config/logger');
    console.log('✅ Logger loaded');

    console.log('Testing cookie-parser...');
    require('cookie-parser');
    console.log('✅ Cookie-parser loaded');

    console.log('Testing route imports...');
    
    console.log('Testing auth routes...');
    const authRoutes = require('./src/routes/api/auth/auth.routes');
    console.log('✅ Auth routes loaded');

    console.log('Testing ticket routes (this previously failed)...');
    const ticketRoutes = require('./src/routes/api/tickets/tickets.routes');
    console.log('✅ Ticket routes loaded');

    console.log('Testing user routes...');
    const userRoutes = require('./src/routes/api/users/users.routes');
    console.log('✅ User routes loaded');

    console.log('Testing analytics routes...');
    const analyticsRoutes = require('./src/routes/api/analytics/analytics.routes');
    console.log('✅ Analytics routes loaded');

    console.log('Testing auth middleware...');
    const authMiddleware = require('./src/middleware/auth');
    console.log('✅ Auth middleware loaded');

    console.log('🎉 All imports successful! Now testing server startup...');

    // Try to actually start the server
    console.log('Creating Express app...');
    const app = express();
    console.log('✅ Express app created');

    console.log('Testing database connection...');
    connectDatabase().then(() => {
        console.log('✅ Database connected successfully');
        
        console.log('🚀 Everything looks good! The server should work now.');
        console.log('Try running: npm run dev');
        
    }).catch(error => {
        console.error('❌ Database connection failed:', error.message);
        console.log('💡 Make sure PostgreSQL is running and the database exists');
    });

} catch (error) {
    console.error('❌ Error during startup:', error.message);
    console.error('Stack trace:', error.stack);
    
    // Specific suggestions based on the error
    if (error.message.includes('Cannot find module')) {
        console.log('\n💡 Suggestion: Check the import paths in your route files');
        console.log('Your models are in src/models/ but the import path might be wrong');
    }
}