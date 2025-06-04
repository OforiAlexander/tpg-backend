// src/routes/api/users/users.routes.js - TPG Users Routes
const express = require('express');
const router = express.Router();

// Users CRUD endpoints (placeholders for now)
router.get('/', (req, res) => {
  res.json({ 
    message: 'TPG Get users endpoint - Implementation coming in Week 2',
    endpoint: 'GET /api/users',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

router.post('/', (req, res) => {
  res.json({ 
    message: 'TPG Create user endpoint - Implementation coming in Week 2',
    endpoint: 'POST /api/users',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

router.get('/:id', (req, res) => {
  res.json({ 
    message: 'TPG Get user by ID endpoint - Implementation coming in Week 2',
    endpoint: `GET /api/users/${req.params.id}`,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

router.put('/:id', (req, res) => {
  res.json({ 
    message: 'TPG Update user endpoint - Implementation coming in Week 2',
    endpoint: `PUT /api/users/${req.params.id}`,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

router.delete('/:id', (req, res) => {
  res.json({ 
    message: 'TPG Delete user endpoint - Implementation coming in Week 2',
    endpoint: `DELETE /api/users/${req.params.id}`,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

router.get('/status', (req, res) => {
  res.json({
    service: 'TPG Users Service',
    status: 'Development Mode',
    endpoints: {
      list: 'GET /api/users',
      create: 'POST /api/users',
      get: 'GET /api/users/:id',
      update: 'PUT /api/users/:id',
      delete: 'DELETE /api/users/:id'
    },
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

module.exports = router;