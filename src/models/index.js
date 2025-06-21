// src/models/index.js - Central export for all models
const User = require('./User');
const Ticket = require('./Tickets');
const TicketComment = require('./TicketComment');
const TicketAttachment = require('./TicketAttachment');
const AuditLog = require('./AuditLog');

module.exports = {
  User,
  Ticket,
  TicketComment,
  TicketAttachment,
  AuditLog
};