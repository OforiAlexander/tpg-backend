// src/models/TicketComment.js - TPG TicketComment Model with Objection.js
const { Model } = require('objection');
const logger = require('../config/logger');

class TicketComment extends Model {
  static get tableName() {
    return 'ticket_comments';
  }

  static get idColumn() {
    return 'id';
  }

  // Define the JSON schema for validation
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['ticket_id', 'user_id', 'content'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        ticket_id: { type: 'string', format: 'uuid' },
        user_id: { type: 'string', format: 'uuid' },
        content: { type: 'string', minLength: 3, maxLength: 3000 },
        is_internal: { type: 'boolean', default: false },
        is_edited: { type: 'boolean', default: false },
        edited_at: { type: ['string', 'null'], format: 'date-time' },
        parent_comment_id: { type: ['string', 'null'], format: 'uuid' },
        metadata: { type: 'object', default: {} }
      }
    };
  }

  // Define relationships
  static get relationMappings() {
    const User = require('./User');
    const Ticket = require('./Ticket');
    const TicketAttachment = require('./TicketAttachment');

    return {
      // Comment author
      user: {
        relation: Model.BelongsToOneRelation,
        modelClass: User,
        join: {
          from: 'ticket_comments.user_id',
          to: 'users.id'
        }
      },

      // Associated ticket
      ticket: {
        relation: Model.BelongsToOneRelation,
        modelClass: Ticket,
        join: {
          from: 'ticket_comments.ticket_id',
          to: 'tickets.id'
        }
      },

      // Parent comment (for threading)
      parentComment: {
        relation: Model.BelongsToOneRelation,
        modelClass: TicketComment,
        join: {
          from: 'ticket_comments.parent_comment_id',
          to: 'ticket_comments.id'
        }
      },

      // Child comments (replies)
      replies: {
        relation: Model.HasManyRelation,
        modelClass: TicketComment,
        join: {
          from: 'ticket_comments.id',
          to: 'ticket_comments.parent_comment_id'
        }
      },

      // Comment attachments
      attachments: {
        relation: Model.HasManyRelation,
        modelClass: TicketAttachment,
        join: {
          from: 'ticket_comments.id',
          to: 'ticket_attachments.comment_id'
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

    // Set default flags
    if (this.is_internal === undefined) {
      this.is_internal = false;
    }

    if (this.is_edited === undefined) {
      this.is_edited = false;
    }

    // Add creation metadata
    this.metadata.created_ip = context.ip;
    this.metadata.created_user_agent = context.userAgent;
    this.metadata.word_count = this.getWordCount();
    this.metadata.character_count = this.content.length;
  }

  // Hooks - called before update
  async $beforeUpdate(context) {
    await super.$beforeUpdate(context);
    this.updated_at = new Date().toISOString();

    // Update word count if content changed
    if (this.content) {
      this.metadata = {
        ...this.metadata,
        word_count: this.getWordCount(),
        character_count: this.content.length,
        last_edited_ip: context.ip,
        last_edited_user_agent: context.userAgent
      };
    }
  }

  // Instance methods

  /**
   * Get word count of comment content
   */
  getWordCount() {
    return this.content.trim().split(/\s+/).length;
  }

  /**
   * Check if comment is a reply
   */
  isReply() {
    return !!this.parent_comment_id;
  }

  /**
   * Check if comment can be edited by user
   */
  canBeEditedBy(user) {
    // User can edit their own comments
    if (this.user_id === user.id) {
      // Check if within edit time limit (24 hours for regular users)
      const commentAge = new Date() - new Date(this.created_at);
      const maxEditTime = user.hasPermission('tickets.edit.all') ? 
        Infinity : 24 * 60 * 60 * 1000; // 24 hours for regular users
      
      return commentAge <= maxEditTime;
    }

    // Admins can edit any comment
    return user.hasPermission('tickets.edit.all');
  }

  /**
   * Check if comment can be deleted by user
   */
  canBeDeletedBy(user) {
    // User can delete their own comments
    if (this.user_id === user.id) {
      return true;
    }

    // Admins can delete any comment
    return user.hasPermission('tickets.delete.all');
  }

  /**
   * Check if comment is visible to user
   */
  isVisibleTo(user) {
    // Internal comments are only visible to admins
    if (this.is_internal && !user.hasPermission('tickets.view.all')) {
      return false;
    }

    return true;
  }

  /**
   * Get comment age in hours
   */
  getAgeInHours() {
    const createdAt = new Date(this.created_at);
    const now = new Date();
    return Math.round((now - createdAt) / (1000 * 60 * 60));
  }

  /**
   * Get comment age in human-readable format
   */
  getAgeFormatted() {
    const ageInHours = this.getAgeInHours();
    
    if (ageInHours < 1) {
      const ageInMinutes = Math.round((new Date() - new Date(this.created_at)) / (1000 * 60));
      return `${ageInMinutes} minute${ageInMinutes !== 1 ? 's' : ''} ago`;
    } else if (ageInHours < 24) {
      return `${ageInHours} hour${ageInHours !== 1 ? 's' : ''} ago`;
    } else {
      const ageInDays = Math.floor(ageInHours / 24);
      return `${ageInDays} day${ageInDays !== 1 ? 's' : ''} ago`;
    }
  }

  /**
   * Extract mentioned users from comment content
   */
  extractMentionedUsers() {
    // Look for @username patterns
    const mentionPattern = /@([a-zA-Z0-9._-]+)/g;
    const matches = this.content.match(mentionPattern);
    
    if (!matches) return [];
    
    return matches.map(match => match.substring(1)); // Remove @ symbol
  }

  /**
   * Extract URLs from comment content
   */
  extractUrls() {
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return this.content.match(urlPattern) || [];
  }

  /**
   * Check if comment contains code blocks
   */
  hasCodeBlocks() {
    return this.content.includes('```') || this.content.includes('`');
  }

  /**
   * Get sanitized content for display
   */
  getSanitizedContent() {
    // Basic sanitization - in production, use a proper sanitization library
    return this.content
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]*>/g, '')
      .trim();
  }

  /**
   * Generate content preview (first 100 characters)
   */
  getContentPreview(maxLength = 100) {
    const sanitized = this.getSanitizedContent();
    if (sanitized.length <= maxLength) {
      return sanitized;
    }
    return sanitized.substring(0, maxLength).trim() + '...';
  }

  /**
   * Mark comment as edited
   */
  async markAsEdited(editReason = null) {
    const updates = {
      is_edited: true,
      edited_at: new Date().toISOString(),
      metadata: {
        ...this.metadata,
        edit_reason: editReason,
        edit_count: (this.metadata.edit_count || 0) + 1
      }
    };

    return await this.$query().patchAndFetch(updates);
  }

  /**
   * Add reaction to comment
   */
  async addReaction(userId, reactionType) {
    const reactions = this.metadata.reactions || {};
    const userReactions = reactions[userId] || [];
    
    if (!userReactions.includes(reactionType)) {
      userReactions.push(reactionType);
      reactions[userId] = userReactions;
      
      await this.$query().patch({
        metadata: {
          ...this.metadata,
          reactions
        }
      });
    }
  }

  /**
   * Remove reaction from comment
   */
  async removeReaction(userId, reactionType) {
    const reactions = this.metadata.reactions || {};
    const userReactions = reactions[userId] || [];
    
    const updatedReactions = userReactions.filter(r => r !== reactionType);
    if (updatedReactions.length > 0) {
      reactions[userId] = updatedReactions;
    } else {
      delete reactions[userId];
    }
    
    await this.$query().patch({
      metadata: {
        ...this.metadata,
        reactions
      }
    });
  }

  /**
   * Get reaction summary
   */
  getReactionSummary() {
    const reactions = this.metadata.reactions || {};
    const summary = {};
    
    Object.values(reactions).flat().forEach(reaction => {
      summary[reaction] = (summary[reaction] || 0) + 1;
    });
    
    return summary;
  }

  // Static methods

  /**
   * Get comments by ticket ID
   */
  static async getByTicketId(ticketId, options = {}) {
    const {
      includeInternal = false,
      limit = 50,
      offset = 0,
      order = 'asc'
    } = options;

    let query = this.query()
      .where('ticket_id', ticketId)
      .withGraphFetched('[user.[select(id, username, email, role)], attachments]')
      .orderBy('created_at', order);

    if (!includeInternal) {
      query = query.where('is_internal', false);
    }

    if (limit) {
      query = query.limit(limit).offset(offset);
    }

    return await query;
  }

  /**
   * Get comments by user ID
   */
  static async getByUserId(userId, limit = 50) {
    return await this.query()
      .where('user_id', userId)
      .withGraphFetched('[ticket.[select(id, ticket_number, title, status)]]')
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  /**
   * Search comments
   */
  static async search(query, filters = {}, limit = 50) {
    let searchQuery = this.query()
      .where('content', 'ilike', `%${query}%`)
      .withGraphFetched('[user.[select(id, username, email)], ticket.[select(id, ticket_number, title)]]');

    // Apply filters
    if (filters.ticketId) {
      searchQuery = searchQuery.where('ticket_id', filters.ticketId);
    }

    if (filters.userId) {
      searchQuery = searchQuery.where('user_id', filters.userId);
    }

    if (filters.isInternal !== undefined) {
      searchQuery = searchQuery.where('is_internal', filters.isInternal);
    }

    if (filters.startDate) {
      searchQuery = searchQuery.where('created_at', '>=', filters.startDate);
    }

    if (filters.endDate) {
      searchQuery = searchQuery.where('created_at', '<=', filters.endDate);
    }

    return await searchQuery
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  /**
   * Get recent comments
   */
  static async getRecent(limit = 20, includeInternal = false) {
    let query = this.query()
      .withGraphFetched('[user.[select(id, username, email)], ticket.[select(id, ticket_number, title)]]')
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (!includeInternal) {
      query = query.where('is_internal', false);
    }

    return await query;
  }

  /**
   * Get comment statistics
   */
  static async getStatistics(filters = {}) {
    let query = this.query();

    // Apply filters
    if (filters.startDate) {
      query = query.where('created_at', '>=', filters.startDate);
    }

    if (filters.endDate) {
      query = query.where('created_at', '<=', filters.endDate);
    }

    if (filters.ticketId) {
      query = query.where('ticket_id', filters.ticketId);
    }

    if (filters.userId) {
      query = query.where('user_id', filters.userId);
    }

    const comments = await query;

    return {
      total_comments: comments.length,
      public_comments: comments.filter(c => !c.is_internal).length,
      internal_comments: comments.filter(c => c.is_internal).length,
      edited_comments: comments.filter(c => c.is_edited).length,
      average_length: comments.length > 0 ? 
        Math.round(comments.reduce((sum, c) => sum + c.content.length, 0) / comments.length) : 0,
      total_word_count: comments.reduce((sum, c) => sum + c.getWordCount(), 0),
      comments_with_attachments: comments.filter(c => c.attachments && c.attachments.length > 0).length,
      unique_commenters: [...new Set(comments.map(c => c.user_id))].length
    };
  }

  /**
   * Get top commenters
   */
  static async getTopCommenters(limit = 10, startDate = null, endDate = null) {
    let query = this.query()
      .select('user_id')
      .count('* as comment_count')
      .withGraphFetched('[user.[select(id, username, email)]]')
      .groupBy('user_id')
      .orderBy('comment_count', 'desc')
      .limit(limit);

    if (startDate) {
      query = query.where('created_at', '>=', startDate);
    }

    if (endDate) {
      query = query.where('created_at', '<=', endDate);
    }

    return await query;
  }

  /**
   * Delete old comments (cleanup utility)
   */
  static async deleteOld(daysOld = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const deletedCount = await this.query()
      .delete()
      .where('created_at', '<', cutoffDate.toISOString())
      .where('is_internal', false); // Never delete internal comments

    logger.info(`Deleted ${deletedCount} old comments (older than ${daysOld} days)`);
    return deletedCount;
  }
}

module.exports = TicketComment;