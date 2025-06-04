// src/models/TicketComment.js - Placeholder  
const { Model } = require('objection');

class TicketComment extends Model {
  static get tableName() {
    return 'ticket_comments';
  }
}

module.exports = TicketComment;