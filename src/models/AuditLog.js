// src/models/AuditLog.js - Placeholder
const { Model } = require('objection');

class AuditLog extends Model {
  static get tableName() {
    return 'audit_logs';
  }
}

module.exports = AuditLog;