// src/models/Ticket.js - TPG Ticket Model with Objection.js
const { Model } = require('objection');
const logger = require('../config/logger');

class Ticket extends Model {
  static get tableName() {
    return 'tickets';
  }

  static get idColumn() {
    return 'id';
  }

  // Define the JSON schema for validation
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['ticket_number', 'title', 'description', 'category', 'user_id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        ticket_number: { type: 'string', maxLength: 20 },
        title: { type: 'string', minLength: 10, maxLength: 500 },
        description: { type: 'string', minLength: 20, maxLength: 5000 },
        category: { 
          type: 'string', 
          enum: [
            'cpd-points',
            'license-management', 
            'performance-issues',
            'payment-gateway',
            'user-interface',
            'data-inconsistencies',
            'system-errors'
          ]
        },
        urgency: { 
          type: 'string', 
          enum: ['low', 'medium', 'high', 'critical'],
          default: 'medium'
        },
        status: { 
          type: 'string', 
          enum: ['open', 'in-progress', 'resolved', 'closed'],
          default: 'open'
        },
        user_id: { type: 'string', format: 'uuid' },
        assigned_to: { type: ['string', 'null'], format: 'uuid' },
        estimated_resolution_hours: { type: ['integer', 'null'], minimum: 1 },
        actual_resolution_hours: { type: ['integer', 'null'], minimum: 0 },
        resolution_notes: { type: ['string', 'null'], maxLength: 2000 },
        satisfaction_rating: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
        satisfaction_comment: { type: ['string', 'null'], maxLength: 1000 },
        tags: { type: 'array', items: { type: 'string' }, default: [] },
        metadata: { type: 'object', default: {} },
        resolved_at: { type: ['string', 'null'], format: 'date-time' },
        closed_at: { type: ['string', 'null'], format: 'date-time' },
        first_response_at: { type: ['string', 'null'], format: 'date-time' }
      }
    };
  }

  // Define relationships
  static get relationMappings() {
    const User = require('./User');
    const TicketComment = require('./TicketComment');
    const TicketAttachment = require('./TicketAttachment');

    return {
      // Ticket creator
      user: {
        relation: Model.BelongsToOneRelation,
        modelClass: User,
        join: {
          from: 'tickets.user_id',
          to: 'users.id'
        }
      },

      // Assigned user (admin)
      assignedUser: {
        relation: Model.BelongsToOneRelation,
        modelClass: User,
        join: {
          from: 'tickets.assigned_to',
          to: 'users.id'
        }
      },

      // Comments on this ticket
      comments: {
        relation: Model.HasManyRelation,
        modelClass: TicketComment,
        join: {
          from: 'tickets.id',
          to: 'ticket_comments.ticket_id'
        }
      },

      // File attachments
      attachments: {
        relation: Model.HasManyRelation,
        modelClass: TicketAttachment,
        join: {
          from: 'tickets.id',
          to: 'ticket_attachments.ticket_id'
        }
      }
    };
  }

  // Hooks - called before insert
  async $beforeInsert(context) {
    await super.$beforeInsert(context);
    
    const now = new Date().toISOString();
    this.created_at = now;
    this.updated_at = now;
    
    // Generate UUID if not provided
    if (!this.id) {
      this.id = require('uuid').v4();
    }

    // Set default metadata
    if (!this.metadata) {
      this.metadata = {};
    }

    // Set default tags
    if (!this.tags) {
      this.tags = [];
    }

    // Set estimated resolution hours based on category if not provided
    if (!this.estimated_resolution_hours) {
      this.estimated_resolution_hours = this.getDefaultResolutionHours();
    }
  }

  // Hooks - called before update
  async $beforeUpdate(context) {
    await super.$beforeUpdate(context);
    this.updated_at = new Date().toISOString();

    // If status is being changed to resolved, set resolved_at
    if (this.status === 'resolved' && !this.resolved_at) {
      this.resolved_at = new Date().toISOString();
      
      // Calculate actual resolution time
      if (this.created_at) {
        const createdAt = new Date(this.created_at);
        const resolvedAt = new Date(this.resolved_at);
        this.actual_resolution_hours = Math.round((resolvedAt - createdAt) / (1000 * 60 * 60));
      }
    }

    // If status is being changed to closed, set closed_at
    if (this.status === 'closed' && !this.closed_at) {
      this.closed_at = new Date().toISOString();
    }
  }

  // Instance methods

  /**
   * Get default resolution hours based on category
   */
  getDefaultResolutionHours() {
    const defaultHours = {
      'cpd-points': 48,
      'license-management': 72,
      'performance-issues': 24,
      'payment-gateway': 24,
      'user-interface': 24,
      'data-inconsistencies': 48,
      'system-errors': 24
    };

    return defaultHours[this.category] || 24;
  }

  /**
   * Check if ticket is overdue
   */
  isOverdue() {
    if (!this.estimated_resolution_hours || this.status === 'resolved' || this.status === 'closed') {
      return false;
    }

    const createdAt = new Date(this.created_at);
    const expectedResolutionTime = new Date(createdAt.getTime() + (this.estimated_resolution_hours * 60 * 60 * 1000));
    
    return new Date() > expectedResolutionTime;
  }

  /**
   * Get ticket age in hours
   */
  getAgeInHours() {
    const createdAt = new Date(this.created_at);
    const now = new Date();
    return Math.round((now - createdAt) / (1000 * 60 * 60));
  }

  /**
   * Get resolution time in hours (if resolved)
   */
  getResolutionTimeInHours() {
    if (!this.resolved_at) {
      return null;
    }

    const createdAt = new Date(this.created_at);
    const resolvedAt = new Date(this.resolved_at);
    return Math.round((resolvedAt - createdAt) / (1000 * 60 * 60));
  }

  /**
   * Check if ticket needs escalation
   */
  needsEscalation() {
    // Escalate if high/critical priority and older than 4 hours without assignment
    if (['high', 'critical'].includes(this.urgency) && !this.assigned_to) {
      const ageInHours = this.getAgeInHours();
      return ageInHours >= 4;
    }

    // Escalate if overdue by more than 12 hours
    if (this.isOverdue()) {
      const overdueHours = this.getAgeInHours() - this.estimated_resolution_hours;
      return overdueHours >= 12;
    }

    return false;
  }

  /**
   * Get priority score for sorting/prioritization
   */
  getPriorityScore() {
    const urgencyScores = {
      'low': 1,
      'medium': 2,
      'high': 3,
      'critical': 4
    };

    let score = urgencyScores[this.urgency] || 1;

    // Increase score if overdue
    if (this.isOverdue()) {
      score += 2;
    }

    // Increase score based on age
    const ageInHours = this.getAgeInHours();
    if (ageInHours > 48) {
      score += 1;
    }

    return score;
  }

  /**
   * Add tag to ticket
   */
  async addTag(tag) {
    if (!this.tags.includes(tag)) {
      const updatedTags = [...this.tags, tag];
      await this.$query().patch({ tags: updatedTags });
    }
  }

  /**
   * Remove tag from ticket
   */
  async removeTag(tag) {
    const updatedTags = this.tags.filter(t => t !== tag);
    await this.$query().patch({ tags: updatedTags });
  }

  /**
   * Update metadata
   */
  async updateMetadata(newMetadata) {
    const updatedMetadata = { ...this.metadata, ...newMetadata };
    await this.$query().patch({ metadata: updatedMetadata });
  }

  /**
   * Check if user can view this ticket
   */
  canBeViewedBy(user) {
    // User can view their own tickets
    if (this.user_id === user.id) {
      return true;
    }

    // Admins can view all tickets
    if (user.hasPermission('tickets.view.all')) {
      return true;
    }

    // Assigned user can view the ticket
    if (this.assigned_to === user.id) {
      return true;
    }

    return false;
  }

  /**
   * Check if user can edit this ticket
   */
  canBeEditedBy(user) {
    // Admins can edit all tickets
    if (user.hasPermission('tickets.edit.all')) {
      return true;
    }

    // Users can edit their own open tickets
    if (this.user_id === user.id && user.hasPermission('tickets.edit.own')) {
      return !['resolved', 'closed'].includes(this.status);
    }

    return false;
  }

  /**
   * Get safe ticket data (removing sensitive information)
   */
  getSafeData() {
    const { metadata, ...safeData } = this;
    
    // Filter sensitive metadata
    const safeMetadata = { ...metadata };
    delete safeMetadata.ip_address;
    delete safeMetadata.user_agent;
    
    return {
      ...safeData,
      metadata: safeMetadata
    };
  }

  // Static methods

  /**
   * Get tickets by status
   */
  static async getByStatus(status, limit = 50) {
    return await this.query()
      .where('status', status)
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  /**
   * Get tickets by category
   */
  static async getByCategory(category, limit = 50) {
    return await this.query()
      .where('category', category)
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  /**
   * Get tickets by urgency
   */
  static async getByUrgency(urgency, limit = 50) {
    return await this.query()
      .where('urgency', urgency)
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  /**
   * Get overdue tickets
   */
  static async getOverdueTickets() {
    const query = `
      SELECT * FROM tickets 
      WHERE status IN ('open', 'in-progress') 
      AND estimated_resolution_hours IS NOT NULL
      AND created_at + (estimated_resolution_hours || ' hours')::interval < NOW()
      ORDER BY created_at ASC
    `;
    
    return await this.query().raw(query);
  }

  /**
   * Get tickets needing escalation
   */
  static async getTicketsNeedingEscalation() {
    const tickets = await this.query()
      .whereIn('status', ['open', 'in-progress'])
      .whereIn('urgency', ['high', 'critical'])
      .orWhere(builder => {
        builder.whereNull('assigned_to')
          .where('created_at', '<', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());
      });

    return tickets.filter(ticket => ticket.needsEscalation());
  }

  /**
   * Search tickets
   */
  static async search(query, filters = {}, limit = 50) {
    let searchQuery = this.query()
      .where(builder => {
        builder
          .where('title', 'ilike', `%${query}%`)
          .orWhere('description', 'ilike', `%${query}%`)
          .orWhere('ticket_number', 'ilike', `%${query}%`);
      });

    // Apply filters
    if (filters.status) {
      searchQuery = searchQuery.where('status', filters.status);
    }

    if (filters.category) {
      searchQuery = searchQuery.where('category', filters.category);
    }

    if (filters.urgency) {
      searchQuery = searchQuery.where('urgency', filters.urgency);
    }

    if (filters.user_id) {
      searchQuery = searchQuery.where('user_id', filters.user_id);
    }

    if (filters.assigned_to) {
      searchQuery = searchQuery.where('assigned_to', filters.assigned_to);
    }

    return await searchQuery
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  /**
   * Get ticket statistics
   */
  static async getStatistics(filters = {}) {
    let query = this.query();

    // Apply date filters
    if (filters.startDate) {
      query = query.where('created_at', '>=', filters.startDate);
    }

    if (filters.endDate) {
      query = query.where('created_at', '<=', filters.endDate);
    }

    // Apply user filter
    if (filters.userId) {
      query = query.where('user_id', filters.userId);
    }

    const tickets = await query;

    return {
      total: tickets.length,
      by_status: this.groupBy(tickets, 'status'),
      by_category: this.groupBy(tickets, 'category'),
      by_urgency: this.groupBy(tickets, 'urgency'),
      resolution_stats: this.calculateResolutionStats(tickets),
      satisfaction_stats: this.calculateSatisfactionStats(tickets)
    };
  }

  /**
   * Helper method to group tickets by field
   */
  static groupBy(tickets, field) {
    return tickets.reduce((acc, ticket) => {
      const key = ticket[field];
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Calculate resolution statistics
   */
  static calculateResolutionStats(tickets) {
    const resolvedTickets = tickets.filter(t => t.resolved_at);
    
    if (resolvedTickets.length === 0) {
      return {
        average_resolution_hours: 0,
        median_resolution_hours: 0,
        resolution_rate: 0
      };
    }

    const resolutionTimes = resolvedTickets.map(t => t.getResolutionTimeInHours());
    const average = resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length;
    
    const sorted = resolutionTimes.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    return {
      average_resolution_hours: Math.round(average),
      median_resolution_hours: median,
      resolution_rate: (resolvedTickets.length / tickets.length) * 100
    };
  }

  /**
   * Calculate satisfaction statistics
   */
  static calculateSatisfactionStats(tickets) {
    const ratedTickets = tickets.filter(t => t.satisfaction_rating);
    
    if (ratedTickets.length === 0) {
      return {
        average_rating: 0,
        total_ratings: 0,
        rating_distribution: {}
      };
    }

    const ratings = ratedTickets.map(t => t.satisfaction_rating);
    const average = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    
    const distribution = ratings.reduce((acc, rating) => {
      acc[rating] = (acc[rating] || 0) + 1;
      return acc;
    }, {});

    return {
      average_rating: Math.round(average * 10) / 10,
      total_ratings: ratedTickets.length,
      rating_distribution: distribution
    };
  }
}

module.exports = Ticket;