// src/models/TicketAttachment.js - TPG TicketAttachment Model with Objection.js
const { Model } = require('objection');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../config/logger');

class TicketAttachment extends Model {
  static get tableName() {
    return 'ticket_attachments';
  }

  static get idColumn() {
    return 'id';
  }

  // Define the JSON schema for validation
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['ticket_id', 'user_id', 'filename', 'original_filename', 'file_path', 'file_size', 'mime_type'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        ticket_id: { type: 'string', format: 'uuid' },
        comment_id: { type: ['string', 'null'], format: 'uuid' },
        user_id: { type: 'string', format: 'uuid' },
        filename: { type: 'string', maxLength: 255 },
        original_filename: { type: 'string', maxLength: 255 },
        file_path: { type: 'string', maxLength: 500 },
        file_size: { type: 'integer', minimum: 0 },
        mime_type: { type: 'string', maxLength: 100 },
        virus_scan_status: { 
          type: 'string', 
          enum: ['pending', 'clean', 'infected', 'error'],
          default: 'pending'
        },
        virus_scan_details: { type: ['string', 'null'] },
        download_count: { type: 'integer', minimum: 0, default: 0 },
        metadata: { type: 'object', default: {} }
      }
    };
  }

  // Define relationships
  static get relationMappings() {
    const User = require('./User');
    const Ticket = require('./Ticket');
    const TicketComment = require('./TicketComment');

    return {
      // User who uploaded the file
      user: {
        relation: Model.BelongsToOneRelation,
        modelClass: User,
        join: {
          from: 'ticket_attachments.user_id',
          to: 'users.id'
        }
      },

      // Associated ticket
      ticket: {
        relation: Model.BelongsToOneRelation,
        modelClass: Ticket,
        join: {
          from: 'ticket_attachments.ticket_id',
          to: 'tickets.id'
        }
      },

      // Associated comment (optional)
      comment: {
        relation: Model.BelongsToOneRelation,
        modelClass: TicketComment,
        join: {
          from: 'ticket_attachments.comment_id',
          to: 'ticket_comments.id'
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

    // Set default download count
    if (this.download_count === undefined) {
      this.download_count = 0;
    }

    // Add upload metadata
    this.metadata.upload_ip = context.ip;
    this.metadata.upload_user_agent = context.userAgent;
    this.metadata.upload_timestamp = now;
  }

  // Hooks - called before update
  async $beforeUpdate(context) {
    await super.$beforeUpdate(context);
    this.updated_at = new Date().toISOString();
  }

  // Instance methods

  /**
   * Get file extension
   */
  getFileExtension() {
    return path.extname(this.original_filename).toLowerCase();
  }

  /**
   * Check if file is an image
   */
  isImage() {
    const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    return imageTypes.includes(this.mime_type);
  }

  /**
   * Check if file is a document
   */
  isDocument() {
    const docTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv'
    ];
    return docTypes.includes(this.mime_type);
  }

  /**
   * Check if file is safe (not infected)
   */
  isSafe() {
    return this.virus_scan_status === 'clean';
  }

  /**
   * Check if file scan is pending
   */
  isScanPending() {
    return this.virus_scan_status === 'pending';
  }

  /**
   * Check if file is infected
   */
  isInfected() {
    return this.virus_scan_status === 'infected';
  }

  /**
   * Get human-readable file size
   */
  getFormattedFileSize() {
    const bytes = this.file_size;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Check if user can download this file
   */
  canBeDownloadedBy(user) {
    // File must be clean to download
    if (!this.isSafe()) {
      return false;
    }

    // User can download files from their own tickets
    if (this.ticket && this.ticket.user_id === user.id) {
      return true;
    }

    // Admins can download any file
    if (user.hasPermission('tickets.view.all')) {
      return true;
    }

    // Assigned user can download files
    if (this.ticket && this.ticket.assigned_to === user.id) {
      return true;
    }

    return false;
  }

  /**
   * Check if user can delete this file
   */
  canBeDeletedBy(user) {
    // User can delete their own uploads
    if (this.user_id === user.id) {
      return true;
    }

    // Admins can delete any file
    if (user.hasPermission('tickets.delete.all')) {
      return true;
    }

    return false;
  }

  /**
   * Increment download count
   */
  async incrementDownloadCount() {
    await this.$query().increment('download_count', 1);
  }

  /**
   * Mark file as virus scanned
   */
  async markAsScanned(status, details = null) {
    const validStatuses = ['clean', 'infected', 'error'];
    if (!validStatuses.includes(status)) {
      throw new Error('Invalid virus scan status');
    }

    await this.$query().patch({
      virus_scan_status: status,
      virus_scan_details: details,
      metadata: {
        ...this.metadata,
        scan_completed_at: new Date().toISOString()
      }
    });

    // Log scan result
    logger.info(`File ${this.filename} scanned: ${status}`, {
      file_id: this.id,
      ticket_id: this.ticket_id,
      scan_status: status,
      scan_details: details
    });
  }

  /**
   * Get file content (for small text files)
   */
  async getContent(maxSize = 1024 * 1024) { // 1MB limit
    if (this.file_size > maxSize) {
      throw new Error('File too large to read content');
    }

    if (!this.isDocument() && !this.mime_type.startsWith('text/')) {
      throw new Error('Cannot read content of binary files');
    }

    try {
      return await fs.readFile(this.file_path, 'utf8');
    } catch (error) {
      logger.error(`Failed to read file content: ${this.file_path}`, error);
      throw new Error('Failed to read file content');
    }
  }

  /**
   * Delete physical file
   */
  async deletePhysicalFile() {
    try {
      await fs.unlink(this.file_path);
      logger.info(`Deleted physical file: ${this.file_path}`);
    } catch (error) {
      logger.error(`Failed to delete physical file: ${this.file_path}`, error);
    }
  }

  /**
   * Generate thumbnail for images
   */
  async generateThumbnail() {
    if (!this.isImage()) {
      return null;
    }

    // This would integrate with an image processing library like Sharp
    // For now, just return a placeholder
    const thumbnailPath = this.file_path.replace(/(\.[^.]+)$/, '_thumb$1');
    
    // TODO: Implement actual thumbnail generation
    // const sharp = require('sharp');
    // await sharp(this.file_path)
    //   .resize(150, 150)
    //   .jpeg({ quality: 80 })
    //   .toFile(thumbnailPath);

    return thumbnailPath;
  }

  /**
   * Get file metadata (EXIF for images, etc.)
   */
  async extractMetadata() {
    if (this.isImage()) {
      // TODO: Extract EXIF data for images
      // const ExifReader = require('exifreader');
      // const tags = ExifReader.load(await fs.readFile(this.file_path));
      return {
        type: 'image',
        dimensions: null, // TODO: Get image dimensions
        camera_info: null // TODO: Extract camera info
      };
    }

    if (this.isDocument()) {
      return {
        type: 'document',
        pages: null, // TODO: Get page count for PDFs
        author: null, // TODO: Extract document metadata
        created_date: null
      };
    }

    return { type: 'unknown' };
  }

  // Static methods

  /**
   * Get attachments by ticket ID
   */
  static async getByTicketId(ticketId) {
    return await this.query()
      .where('ticket_id', ticketId)
      .withGraphFetched('[user.[select(id, username, email)]]')
      .orderBy('created_at', 'desc');
  }

  /**
   * Get attachments by comment ID
   */
  static async getByCommentId(commentId) {
    return await this.query()
      .where('comment_id', commentId)
      .withGraphFetched('[user.[select(id, username, email)]]')
      .orderBy('created_at', 'desc');
  }

  /**
   * Get attachments by user ID
   */
  static async getByUserId(userId, limit = 50) {
    return await this.query()
      .where('user_id', userId)
      .withGraphFetched('[ticket.[select(id, ticket_number, title)]]')
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  /**
   * Get allowed file types
   */
  static getAllowedFileTypes() {
    const allowedTypes = process.env.UPLOAD_ALLOWED_TYPES || 'jpg,jpeg,png,pdf,doc,docx,txt,csv';
    return allowedTypes.split(',').map(type => type.trim().toLowerCase());
  }

  /**
   * Get allowed MIME types
   */
  static getAllowedMimeTypes() {
    return {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'txt': 'text/plain',
      'csv': 'text/csv',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
  }

  /**
   * Get maximum file size
   */
  static getMaxFileSize() {
    return parseInt(process.env.UPLOAD_MAX_SIZE) || 10 * 1024 * 1024; // 10MB default
  }

  /**
   * Validate file type
   */
  static isValidFileType(filename, mimeType) {
    const extension = path.extname(filename).toLowerCase().substring(1);
    const allowedTypes = this.getAllowedFileTypes();
    const allowedMimes = this.getAllowedMimeTypes();

    return allowedTypes.includes(extension) && 
           Object.values(allowedMimes).includes(mimeType);
  }

  /**
   * Generate unique filename
   */
  static generateUniqueFilename(originalFilename) {
    const extension = path.extname(originalFilename);
    const baseName = path.basename(originalFilename, extension);
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    
    return `${baseName}_${timestamp}_${random}${extension}`;
  }

  /**
   * Get upload path
   */
  static getUploadPath() {
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    return path.join(uploadPath, 'tickets', year.toString(), month);
  }

  /**
   * Search attachments
   */
  static async search(query, filters = {}, limit = 50) {
    let searchQuery = this.query()
      .where('original_filename', 'ilike', `%${query}%`)
      .withGraphFetched('[user.[select(id, username, email)], ticket.[select(id, ticket_number, title)]]');

    // Apply filters
    if (filters.ticketId) {
      searchQuery = searchQuery.where('ticket_id', filters.ticketId);
    }

    if (filters.userId) {
      searchQuery = searchQuery.where('user_id', filters.userId);
    }

    if (filters.mimeType) {
      searchQuery = searchQuery.where('mime_type', 'like', `${filters.mimeType}%`);
    }

    if (filters.minSize) {
      searchQuery = searchQuery.where('file_size', '>=', filters.minSize);
    }

    if (filters.maxSize) {
      searchQuery = searchQuery.where('file_size', '<=', filters.maxSize);
    }

    if (filters.virusScanStatus) {
      searchQuery = searchQuery.where('virus_scan_status', filters.virusScanStatus);
    }

    return await searchQuery
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  /**
   * Get attachment statistics
   */
  static async getStatistics(filters = {}) {
    let query = this.query();

    if (filters.startDate) {
      query = query.where('created_at', '>=', filters.startDate);
    }

    if (filters.endDate) {
      query = query.where('created_at', '<=', filters.endDate);
    }

    const attachments = await query;

    const totalSize = attachments.reduce((sum, att) => sum + att.file_size, 0);
    const mimeTypes = {};
    const scanStatuses = {};

    attachments.forEach(att => {
      mimeTypes[att.mime_type] = (mimeTypes[att.mime_type] || 0) + 1;
      scanStatuses[att.virus_scan_status] = (scanStatuses[att.virus_scan_status] || 0) + 1;
    });

    return {
      total_attachments: attachments.length,
      total_size_bytes: totalSize,
      total_size_formatted: this.formatBytes(totalSize),
      average_size_bytes: attachments.length > 0 ? Math.round(totalSize / attachments.length) : 0,
      by_mime_type: mimeTypes,
      by_scan_status: scanStatuses,
      total_downloads: attachments.reduce((sum, att) => sum + att.download_count, 0)
    };
  }

  /**
   * Clean up old attachments
   */
  static async cleanupOld(daysOld = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const oldAttachments = await this.query()
      .where('created_at', '<', cutoffDate.toISOString())
      .where('download_count', 0); // Only delete unused files

    let deletedCount = 0;
    for (const attachment of oldAttachments) {
      try {
        await attachment.deletePhysicalFile();
        await attachment.$query().delete();
        deletedCount++;
      } catch (error) {
        logger.error(`Failed to delete old attachment ${attachment.id}:`, error);
      }
    }

    logger.info(`Cleaned up ${deletedCount} old attachments (older than ${daysOld} days)`);
    return deletedCount;
  }

  /**
   * Format bytes to human readable
   */
  static formatBytes(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}

module.exports = TicketAttachment;