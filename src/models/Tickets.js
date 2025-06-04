// src/models/Ticket.js - Placeholder
const { Model } = require('objection');

class Ticket extends Model {
  static get tableName() {
    return 'tickets';
  }
}

module.exports = Ticket;