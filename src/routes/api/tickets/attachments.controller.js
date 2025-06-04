// src/routes/api/tickets/attachments.controller.js - TPG Ticket Attachments Controller
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const TicketAttachment = require('../../../models/TicketAttachment');
const Ticket = require('../../../models/Ticket');
const TicketComment = require('../../../models/TicketComment');
const logger = require('../../../config/logger');
const { validateAttachmentUpload } = require('./attachments.validation');

class AttachmentsController {
  constructor() {
    this.setupMulter();
  }

  /**
   * Set up Multer for file uploads
   */
  setupMulter() {
    // Configure storage
    const storage = multer.diskStorage({
      destination: async (req, file, cb) => {
        try {
          const uploadPath = TicketAttachment.getUploadPath();
          await fs.mkdir(uploadPath, { recursive: true });
          cb(null, uploadPath);
        } catch (error) {
          cb(error);
        }
      },
      filename: (req, file, cb) => {
        const uniqueFilename = TicketAttachment.generateUniqueFilename(file.originalname);
        cb(null, uniqueFilename);
      }
    });

    // File filter
    const fileFilter = (req, file, cb) => {
      const isValid = TicketAttachment.isValidFileType(file.originalname, file.mimetype);
      if (isValid) {
        cb(null, true);
      } else {
        cb(new Error(`File type not allowed. Allowed types: ${TicketAttachment.getAllowedFileTypes().join(', ')}`));
      }
    };

    this.upload = multer({
      storage,
      fileFilter,
      limits: {
        fileSize: TicketAttachment.getMaxFileSize(),
        files: 5 // Maximum 5 files per upload
      }
    });
  }

  /**
   * Get attachments for a ticket
   * GET /api/tickets/:ticketId/attachments
   */
  async getAttachments(req, res) {
    try {
      const { ticketId } = req.params;
      const { comment_id, include_metadata = false } = req.query;

      // Check if ticket exists and user has permission
      const ticket = await Ticket.query().findById(ticketId);
      if (!ticket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: 'The requested ticket does not exist'
        });
      }

      const canView = req.user.hasPermission('tickets.view.all') || 
                     (req.user.hasPermission('tickets.view.own') && ticket.user_id === req.user.id);

      if (!canView) {
        logger.security.logPermissionDenied(
          req.user.id,
          'tickets.view',
          `ticket_${ticketId}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only view attachments on your own tickets'
        });
      }

      // Get attachments
      let query = TicketAttachment.query()
        .where('ticket_id', ticketId)
        .withGraphFetched('[user.[select(id, username, email)]]');

      // Filter by comment if specified
      if (comment_id) {
        query = query.where('comment_id', comment_id);
      }

      const attachments = await query.orderBy('created_at', 'desc');

      // Filter out sensitive metadata for non-admin users
      const safeAttachments = attachments.map(attachment => {
        const data = { ...attachment };
        
        if (!req.user.hasPermission('tickets.view.all') || !include_metadata) {
          // Remove sensitive metadata
          if (data.metadata) {
            const { upload_ip, upload_user_agent, ...safeMeta } = data.metadata;
            data.metadata = safeMeta;
          }
        }

        return data;
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'ticket_attachments',
        ticketId,
        req.ip
      );

      res.json({
        success: true,
        attachments: safeAttachments,
        count: safeAttachments.length
      });
    } catch (error) {
      logger.error('Get attachments error:', error);
      res.status(500).json({
        error: 'Failed to retrieve attachments',
        message: 'An error occurred while fetching attachments'
      });
    }
  }

  /**
   * Upload attachment
   * POST /api/tickets/:ticketId/attachments
   */
  async uploadAttachment(req, res) {
    try {
      // Use multer middleware
      this.upload.array('files', 5)(req, res, async (uploadError) => {
        if (uploadError) {
          if (uploadError.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: 'File too large',
              message: `File size exceeds maximum allowed size of ${TicketAttachment.getMaxFileSize() / (1024 * 1024)}MB`
            });
          }

          if (uploadError.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
              error: 'Too many files',
              message: 'Maximum 5 files can be uploaded at once'
            });
          }

          return res.status(400).json({
            error: 'Upload failed',
            message: uploadError.message
          });
        }

        try {
          const { ticketId } = req.params;
          const { comment_id } = req.body;

          // Validate input
          const { error, value } = validateAttachmentUpload({ comment_id });
          if (error) {
            // Clean up uploaded files
            await this.cleanupUploadedFiles(req.files);
            return res.status(400).json({
              error: 'Validation failed',
              message: error.details[0].message
            });
          }

          // Check if files were uploaded
          if (!req.files || req.files.length === 0) {
            return res.status(400).json({
              error: 'No files uploaded',
              message: 'Please select at least one file to upload'
            });
          }

          // Check if ticket exists and user has permission
          const ticket = await Ticket.query().findById(ticketId);
          if (!ticket) {
            await this.cleanupUploadedFiles(req.files);
            return res.status(404).json({
              error: 'Ticket not found',
              message: 'The requested ticket does not exist'
            });
          }

          const canUpload = req.user.hasPermission('tickets.view.all') || 
                           (req.user.hasPermission('tickets.view.own') && ticket.user_id === req.user.id);

          if (!canUpload) {
            await this.cleanupUploadedFiles(req.files);
            logger.security.logPermissionDenied(
              req.user.id,
              'tickets.upload',
              `ticket_${ticketId}`,
              req.ip,
              req.get('User-Agent')
            );
            
            return res.status(403).json({
              error: 'Access denied',
              message: 'You can only upload attachments to your own tickets'
            });
          }

          // Validate comment exists if specified
          if (value.comment_id) {
            const comment = await TicketComment.query()
              .findById(value.comment_id)
              .where('ticket_id', ticketId);

            if (!comment) {
              await this.cleanupUploadedFiles(req.files);
              return res.status(404).json({
                error: 'Comment not found',
                message: 'The specified comment does not exist'
              });
            }
          }

          // Process uploaded files
          const attachments = [];
          for (const file of req.files) {
            try {
              // Calculate file hash for integrity checking
              const fileHash = await this.calculateFileHash(file.path);

              // Create attachment record
              const attachment = await TicketAttachment.query().insert({
                ticket_id: ticketId,
                comment_id: value.comment_id || null,
                user_id: req.user.id,
                filename: file.filename,
                original_filename: file.originalname,
                file_path: file.path,
                file_size: file.size,
                mime_type: file.mimetype,
                virus_scan_status: 'pending',
                metadata: {
                  file_hash: fileHash,
                  upload_ip: req.ip,
                  upload_user_agent: req.get('User-Agent')
                }
              });

              // Queue for virus scanning
              await this.queueVirusScan(attachment);

              attachments.push(attachment);

              // Log upload
              logger.security.logDataAccess(
                req.user.id,
                'upload',
                'attachment',
                attachment.id,
                req.ip
              );

            } catch (fileError) {
              logger.error(`Failed to process file ${file.originalname}:`, fileError);
              // Clean up the failed file
              try {
                await fs.unlink(file.path);
              } catch (cleanupError) {
                logger.error(`Failed to cleanup file ${file.path}:`, cleanupError);
              }
            }
          }

          if (attachments.length === 0) {
            return res.status(500).json({
              error: 'Upload failed',
              message: 'No files were successfully processed'
            });
          }

          // Update ticket timestamp
          await ticket.$query().patch({ updated_at: new Date().toISOString() });

          res.status(201).json({
            success: true,
            message: `${attachments.length} file(s) uploaded successfully`,
            attachments: attachments.map(att => ({
              id: att.id,
              filename: att.original_filename,
              size: att.file_size,
              mime_type: att.mime_type,
              virus_scan_status: att.virus_scan_status
            }))
          });

        } catch (error) {
          // Clean up uploaded files on error
          await this.cleanupUploadedFiles(req.files);
          throw error;
        }
      });
    } catch (error) {
      logger.error('Upload attachment error:', error);
      res.status(500).json({
        error: 'Upload failed',
        message: 'An error occurred while uploading files'
      });
    }
  }

  /**
   * Download attachment
   * GET /api/tickets/:ticketId/attachments/:attachmentId
   */
  async downloadAttachment(req, res) {
    try {
      const { ticketId, attachmentId } = req.params;

      // Get attachment with relations
      const attachment = await TicketAttachment.query()
        .findById(attachmentId)
        .where('ticket_id', ticketId)
        .withGraphFetched('[ticket, user]');

      if (!attachment) {
        return res.status(404).json({
          error: 'Attachment not found',
          message: 'The requested attachment does not exist'
        });
      }

      // Check permissions
      if (!attachment.canBeDownloadedBy(req.user)) {
        logger.security.logPermissionDenied(
          req.user.id,
          'attachments.download',
          `attachment_${attachmentId}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to download this file'
        });
      }

      // Check if file is safe
      if (!attachment.isSafe()) {
        if (attachment.isInfected()) {
          return res.status(403).json({
            error: 'File infected',
            message: 'This file has been identified as infected and cannot be downloaded'
          });
        }

        if (attachment.isScanPending()) {
          return res.status(202).json({
            error: 'Scan pending',
            message: 'File is still being scanned for viruses. Please try again in a few minutes.'
          });
        }

        return res.status(403).json({
          error: 'File not safe',
          message: 'This file cannot be downloaded due to security concerns'
        });
      }

      // Check if file exists
      try {
        await fs.access(attachment.file_path);
      } catch (error) {
        logger.error(`Attachment file not found: ${attachment.file_path}`);
        return res.status(404).json({
          error: 'File not found',
          message: 'The attachment file could not be found on the server'
        });
      }

      // Increment download count
      await attachment.incrementDownloadCount();

      // Log download
      logger.security.logDataAccess(
        req.user.id,
        'download',
        'attachment',
        attachmentId,
        req.ip
      );

      // Set appropriate headers
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.original_filename}"`);
      res.setHeader('Content-Type', attachment.mime_type);
      res.setHeader('Content-Length', attachment.file_size);
      res.setHeader('Cache-Control', 'no-cache');

      // Stream file to response
      const fileStream = require('fs').createReadStream(attachment.file_path);
      fileStream.pipe(res);

      fileStream.on('error', (error) => {
        logger.error(`Error streaming file ${attachment.file_path}:`, error);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Download failed',
            message: 'An error occurred while downloading the file'
          });
        }
      });

    } catch (error) {
      logger.error('Download attachment error:', error);
      res.status(500).json({
        error: 'Download failed',
        message: 'An error occurred while downloading the file'
      });
    }
  }

  /**
   * Delete attachment
   * DELETE /api/tickets/:ticketId/attachments/:attachmentId
   */
  async deleteAttachment(req, res) {
    try {
      const { ticketId, attachmentId } = req.params;
      const { reason = 'User requested deletion' } = req.body;

      // Get attachment
      const attachment = await TicketAttachment.query()
        .findById(attachmentId)
        .where('ticket_id', ticketId)
        .withGraphFetched('[ticket, user]');

      if (!attachment) {
        return res.status(404).json({
          error: 'Attachment not found',
          message: 'The requested attachment does not exist'
        });
      }

      // Check permissions
      if (!attachment.canBeDeletedBy(req.user)) {
        logger.security.logPermissionDenied(
          req.user.id,
          'attachments.delete',
          `attachment_${attachmentId}`,
          req.ip,
          req.get('User-Agent')
        );
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only delete your own attachments'
        });
      }

      // Delete physical file
      try {
        await attachment.deletePhysicalFile();
      } catch (fileError) {
        logger.error(`Failed to delete physical file: ${attachment.file_path}`, fileError);
        // Continue with database deletion even if file deletion fails
      }

      // Delete database record
      await attachment.$query().delete();

      // Log deletion
      logger.security.logAdminAction(
        req.user.id,
        'attachment_deleted',
        attachmentId,
        {
          ticket_id: ticketId,
          filename: attachment.original_filename,
          reason
        },
        req.ip
      );

      res.json({
        success: true,
        message: 'Attachment deleted successfully'
      });
    } catch (error) {
      logger.error('Delete attachment error:', error);
      res.status(500).json({
        error: 'Deletion failed',
        message: 'An error occurred while deleting the attachment'
      });
    }
  }

  /**
   * Get attachment metadata
   * GET /api/tickets/:ticketId/attachments/:attachmentId/metadata
   */
  async getAttachmentMetadata(req, res) {
    try {
      const { ticketId, attachmentId } = req.params;

      const attachment = await TicketAttachment.query()
        .findById(attachmentId)
        .where('ticket_id', ticketId)
        .withGraphFetched('[ticket, user]');

      if (!attachment) {
        return res.status(404).json({
          error: 'Attachment not found',
          message: 'The requested attachment does not exist'
        });
      }

      // Check permissions
      if (!attachment.canBeDownloadedBy(req.user)) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to view this attachment metadata'
        });
      }

      // Extract additional metadata if possible
      let extractedMetadata = {};
      try {
        extractedMetadata = await attachment.extractMetadata();
      } catch (error) {
        logger.warn(`Failed to extract metadata for attachment ${attachmentId}:`, error);
      }

      const metadata = {
        id: attachment.id,
        filename: attachment.original_filename,
        size: attachment.file_size,
        formatted_size: attachment.getFormattedFileSize(),
        mime_type: attachment.mime_type,
        extension: attachment.getFileExtension(),
        is_image: attachment.isImage(),
        is_document: attachment.isDocument(),
        virus_scan_status: attachment.virus_scan_status,
        download_count: attachment.download_count,
        uploaded_by: attachment.user ? {
          id: attachment.user.id,
          username: attachment.user.username,
          email: attachment.user.email
        } : null,
        uploaded_at: attachment.created_at,
        extracted_metadata: extractedMetadata
      };

      // Include sensitive metadata for admins
      if (req.user.hasPermission('tickets.view.all')) {
        metadata.upload_ip = attachment.metadata?.upload_ip;
        metadata.file_hash = attachment.metadata?.file_hash;
        metadata.virus_scan_details = attachment.virus_scan_details;
      }

      res.json({
        success: true,
        metadata
      });
    } catch (error) {
      logger.error('Get attachment metadata error:', error);
      res.status(500).json({
        error: 'Failed to retrieve metadata',
        message: 'An error occurred while fetching attachment metadata'
      });
    }
  }

  // Helper methods

  /**
   * Calculate file hash for integrity checking
   */
  async calculateFileHash(filePath) {
    const hash = crypto.createHash('sha256');
    const fileBuffer = await fs.readFile(filePath);
    hash.update(fileBuffer);
    return hash.digest('hex');
  }

  /**
   * Queue file for virus scanning
   */
  async queueVirusScan(attachment) {
    // In a production environment, this would integrate with ClamAV or similar
    // For now, we'll simulate a scan
    try {
      // TODO: Integrate with actual virus scanning service
      // For development, mark as clean after a short delay
      if (process.env.NODE_ENV === 'development') {
        setTimeout(async () => {
          try {
            await attachment.markAsScanned('clean', 'Development mode - no actual scan performed');
          } catch (error) {
            logger.error(`Failed to mark attachment ${attachment.id} as scanned:`, error);
          }
        }, 2000);
      }

      logger.info(`Queued virus scan for attachment ${attachment.id}`);
    } catch (error) {
      logger.error(`Failed to queue virus scan for attachment ${attachment.id}:`, error);
      await attachment.markAsScanned('error', error.message);
    }
  }

  /**
   * Clean up uploaded files on error
   */
  async cleanupUploadedFiles(files) {
    if (!files || !Array.isArray(files)) return;

    for (const file of files) {
      try {
        await fs.unlink(file.path);
        logger.info(`Cleaned up uploaded file: ${file.path}`);
      } catch (error) {
        logger.error(`Failed to cleanup uploaded file ${file.path}:`, error);
      }
    }
  }
}

module.exports = new AttachmentsController();