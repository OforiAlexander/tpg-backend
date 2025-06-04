// src/routes/api/tickets/tickets.routes.js - TPG Ticket Management Routes
const express = require('express');
const router = express.Router();

// Import middleware
const { 
  authenticate, 
  requireRole, 
  requirePermission, 
  requireTicketAccess,
  authRateLimit 
} = require('../../../middleware/auth');
const { apiRateLimit } = require('../../../middleware/security');
const { auditUserAction } = require('../../../middleware/audit');
const recaptchaService = require('../../../services/recaptchaService');

// Import controllers
const ticketsController = require('./tickets.controller');
const commentsController = require('./comments.controller');
const attachmentsController = require('./attachments.controller');

// Apply authentication to all routes
router.use(authenticate);

// Apply rate limiting
router.use(apiRateLimit);

/**
 * Ticket CRUD Routes
 */

// GET /api/tickets - List tickets with filtering and pagination
router.get('/', 
  auditUserAction('list'),
  ticketsController.getTickets
);

// GET /api/tickets/stats - Get ticket statistics
router.get('/stats',
  auditUserAction('view_stats'),
  ticketsController.getTicketStats
);

// POST /api/tickets - Create new ticket
router.post('/',
  requirePermission('tickets.create'),
  authRateLimit, // Additional rate limiting for ticket creation
  recaptchaService.middleware({ 
    action: 'create_ticket', 
    required: true,
    skipInDevelopment: true 
  }),
  auditUserAction('create'),
  ticketsController.createTicket
);

// GET /api/tickets/:id - Get single ticket
router.get('/:id',
  requireTicketAccess('view'),
  auditUserAction('view'),
  ticketsController.getTicket
);

// PUT /api/tickets/:id - Update ticket
router.put('/:id',
  requireTicketAccess('edit'),
  auditUserAction('update'),
  ticketsController.updateTicket
);

// DELETE /api/tickets/:id - Delete ticket (soft delete)
router.delete('/:id',
  requireTicketAccess('delete'),
  auditUserAction('delete'),
  ticketsController.deleteTicket
);

/**
 * Ticket Assignment and Status Routes
 */

// PUT /api/tickets/:id/assign - Assign ticket to user
router.put('/:id/assign',
  requirePermission('tickets.assign'),
  auditUserAction('assign'),
  ticketsController.assignTicket
);

// PUT /api/tickets/:id/status - Update ticket status
router.put('/:id/status',
  requireTicketAccess('edit'),
  auditUserAction('status_update'),
  ticketsController.updateTicketStatus
);

/**
 * Comment Routes
 */

// GET /api/tickets/:ticketId/comments - Get comments for ticket
router.get('/:ticketId/comments',
  requireTicketAccess('view'),
  auditUserAction('view_comments'),
  commentsController.getComments
);

// POST /api/tickets/:ticketId/comments - Add comment to ticket
router.post('/:ticketId/comments',
  requireTicketAccess('view'),
  authRateLimit, // Rate limit comment creation
  auditUserAction('add_comment'),
  commentsController.addComment
);

// GET /api/tickets/:ticketId/comments/stats - Get comment statistics
router.get('/:ticketId/comments/stats',
  requireTicketAccess('view'),
  auditUserAction('view_comment_stats'),
  commentsController.getCommentStats
);

// GET /api/tickets/:ticketId/comments/:commentId - Get single comment
router.get('/:ticketId/comments/:commentId',
  requireTicketAccess('view'),
  auditUserAction('view_comment'),
  commentsController.getComment
);

// PUT /api/tickets/:ticketId/comments/:commentId - Update comment
router.put('/:ticketId/comments/:commentId',
  auditUserAction('update_comment'),
  commentsController.updateComment
);

// DELETE /api/tickets/:ticketId/comments/:commentId - Delete comment
router.delete('/:ticketId/comments/:commentId',
  auditUserAction('delete_comment'),
  commentsController.deleteComment
);

// PUT /api/tickets/:ticketId/comments/:commentId/internal - Toggle internal status (Admin only)
router.put('/:ticketId/comments/:commentId/internal',
  requirePermission('tickets.edit.all'),
  auditUserAction('toggle_comment_internal'),
  commentsController.toggleInternalStatus
);

/**
 * Attachment Routes
 */

// GET /api/tickets/:ticketId/attachments - Get attachments for ticket
router.get('/:ticketId/attachments',
  requireTicketAccess('view'),
  auditUserAction('view_attachments'),
  attachmentsController.getAttachments
);

// POST /api/tickets/:ticketId/attachments - Upload attachment
router.post('/:ticketId/attachments',
  requireTicketAccess('view'),
  authRateLimit, // Rate limit file uploads
  auditUserAction('upload_attachment'),
  attachmentsController.uploadAttachment
);

// GET /api/tickets/:ticketId/attachments/:attachmentId - Download attachment
router.get('/:ticketId/attachments/:attachmentId',
  requireTicketAccess('view'),
  auditUserAction('download_attachment'),
  attachmentsController.downloadAttachment
);

// DELETE /api/tickets/:ticketId/attachments/:attachmentId - Delete attachment
router.delete('/:ticketId/attachments/:attachmentId',
  auditUserAction('delete_attachment'),
  attachmentsController.deleteAttachment
);

/**
 * Advanced Ticket Operations (Admin only)
 */

// PUT /api/tickets/:id/escalate - Escalate ticket
router.put('/:id/escalate',
  requirePermission('tickets.escalate'),
  auditUserAction('escalate'),
  ticketsController.escalateTicket
);

// PUT /api/tickets/:id/merge - Merge tickets
router.put('/:id/merge',
  requirePermission('tickets.merge'),
  auditUserAction('merge'),
  ticketsController.mergeTickets
);

// POST /api/tickets/bulk - Bulk ticket operations
router.post('/bulk',
  requirePermission('tickets.edit.all'),
  auditUserAction('bulk_operation'),
  ticketsController.bulkTicketOperation
);

/**
 * Search and Export Routes
 */

// GET /api/tickets/search - Advanced search
router.get('/search',
  auditUserAction('search'),
  ticketsController.searchTickets
);

// POST /api/tickets/export - Export tickets
router.post('/export',
  requirePermission('tickets.export'),
  auditUserAction('export'),
  ticketsController.exportTickets
);

/**
 * Reporting Routes
 */

// GET /api/tickets/reports/summary - Get summary report
router.get('/reports/summary',
  requirePermission('analytics.view'),
  auditUserAction('view_summary_report'),
  ticketsController.getSummaryReport
);

// GET /api/tickets/reports/resolution-time - Get resolution time report
router.get('/reports/resolution-time',
  requirePermission('analytics.view'),
  auditUserAction('view_resolution_report'),
  ticketsController.getResolutionTimeReport
);

// GET /api/tickets/reports/satisfaction - Get satisfaction report
router.get('/reports/satisfaction',
  requirePermission('analytics.view'),
  auditUserAction('view_satisfaction_report'),
  ticketsController.getSatisfactionReport
);

/**
 * Notification and Subscription Routes
 */

// POST /api/tickets/:id/subscribe - Subscribe to ticket updates
router.post('/:id/subscribe',
  requireTicketAccess('view'),
  auditUserAction('subscribe'),
  ticketsController.subscribeToTicket
);

// DELETE /api/tickets/:id/subscribe - Unsubscribe from ticket updates
router.delete('/:id/subscribe',
  requireTicketAccess('view'),
  auditUserAction('unsubscribe'),
  ticketsController.unsubscribeFromTicket
);

/**
 * Ticket History Routes
 */

// GET /api/tickets/:id/history - Get ticket history/audit trail
router.get('/:id/history',
  requireTicketAccess('view'),
  auditUserAction('view_history'),
  ticketsController.getTicketHistory
);

// GET /api/tickets/:id/timeline - Get ticket timeline
router.get('/:id/timeline',
  requireTicketAccess('view'),
  auditUserAction('view_timeline'),
  ticketsController.getTicketTimeline
);

/**
 * Quick Actions Routes
 */

// PUT /api/tickets/:id/quick-close - Quick close ticket
router.put('/:id/quick-close',
  requirePermission('tickets.close'),
  auditUserAction('quick_close'),
  ticketsController.quickCloseTicket
);

// PUT /api/tickets/:id/quick-resolve - Quick resolve ticket
router.put('/:id/quick-resolve',
  requirePermission('tickets.resolve'),
  auditUserAction('quick_resolve'),
  ticketsController.quickResolveTicket
);

// PUT /api/tickets/:id/reopen - Reopen closed ticket
router.put('/:id/reopen',
  requirePermission('tickets.reopen'),
  auditUserAction('reopen'),
  ticketsController.reopenTicket
);

/**
 * Template and Auto-response Routes
 */

// GET /api/tickets/templates - Get ticket templates
router.get('/templates',
  requirePermission('tickets.templates'),
  auditUserAction('view_templates'),
  ticketsController.getTicketTemplates
);

// POST /api/tickets/templates - Create ticket template
router.post('/templates',
  requirePermission('tickets.templates.create'),
  auditUserAction('create_template'),
  ticketsController.createTicketTemplate
);

/**
 * Health and Status Routes
 */

// GET /api/tickets/health - Check ticket system health
router.get('/health',
  requirePermission('system.health'),
  ticketsController.getSystemHealth
);

/**
 * Route-specific error handling middleware
 */
router.use((error, req, res, next) => {
  // Log ticket-specific errors
  req.logger.error('Tickets API Error:', {
    error: error.message,
    stack: error.stack,
    user_id: req.user?.id,
    ticket_id: req.params?.id || req.params?.ticketId,
    route: req.route?.path,
    method: req.method
  });

  // Handle specific validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: error.message,
      details: error.details
    });
  }

  // Handle permission errors
  if (error.message?.includes('permission') || error.message?.includes('access')) {
    return res.status(403).json({
      error: 'Access Denied',
      message: 'You do not have permission to perform this action'
    });
  }

  // Handle ticket not found errors
  if (error.message?.includes('not found')) {
    return res.status(404).json({
      error: 'Ticket Not Found',
      message: 'The requested ticket does not exist'
    });
  }

  // Handle file upload errors
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'File Too Large',
      message: 'Uploaded file exceeds the maximum allowed size'
    });
  }

  // Handle reCAPTCHA errors
  if (error.message?.includes('reCAPTCHA')) {
    return res.status(400).json({
      error: 'Security Verification Failed',
      message: 'Please complete the security verification'
    });
  }

  // Handle rate limiting errors
  if (error.status === 429) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Please slow down and try again later'
    });
  }

  // Pass to global error handler
  next(error);
});

module.exports = router;