// src/routes/api/analytics/analytics.controller.js - TPG Analytics Controller
const analyticsService = require('../../../services/analyticsService');
const dashboardService = require('../../../services/dashboardService');
const reportService = require('../../../services/reportService');
const logger = require('../../../config/logger');
const { validateAnalyticsQuery, validateDashboardQuery, validateReportQuery } = require('./analytics.validation');

class AnalyticsController {
  /**
   * Get dashboard overview statistics
   * GET /api/analytics/dashboard
   * Permissions: analytics.view (admin+)
   */
  async getDashboardStats(req, res) {
    try {
      // Validate query parameters
      const { error, value } = validateDashboardQuery(req.query);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const { 
        period = '30d',
        user_id,
        category,
        include_trends = true,
        include_comparisons = true 
      } = value;

      // Get dashboard data
      const dashboardData = await dashboardService.getDashboardOverview({
        period,
        userId: user_id,
        category,
        includeTrends: include_trends,
        includeComparisons: include_comparisons,
        requestingUser: req.user
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'dashboard_analytics',
        'overview',
        req.ip
      );

      res.json({
        success: true,
        period,
        data: dashboardData,
        generated_at: new Date().toISOString(),
        cache_ttl: 300 // 5 minutes cache TTL
      });
    } catch (error) {
      logger.error('Get dashboard stats error:', error);
      res.status(500).json({
        error: 'Failed to retrieve dashboard statistics',
        message: 'An error occurred while fetching dashboard data'
      });
    }
  }

  /**
   * Get detailed ticket analytics
   * GET /api/analytics/tickets
   * Permissions: analytics.view (admin+)
   */
  async getTicketAnalytics(req, res) {
    try {
      // Validate query parameters
      const { error, value } = validateAnalyticsQuery(req.query);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const {
        period = '30d',
        group_by = 'day',
        category,
        status,
        urgency,
        assigned_to,
        user_id,
        include_trends = true,
        include_forecasts = false
      } = value;

      // Get ticket analytics
      const analytics = await analyticsService.getTicketAnalytics({
        period,
        groupBy: group_by,
        filters: {
          category,
          status,
          urgency,
          assignedTo: assigned_to,
          userId: user_id
        },
        includeTrends: include_trends,
        includeForecasts: include_forecasts,
        requestingUser: req.user
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'ticket_analytics',
        `${period}_${group_by}`,
        req.ip
      );

      res.json({
        success: true,
        period,
        group_by,
        filters: { category, status, urgency, assigned_to, user_id },
        analytics,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get ticket analytics error:', error);
      res.status(500).json({
        error: 'Failed to retrieve ticket analytics',
        message: 'An error occurred while fetching ticket analytics'
      });
    }
  }

  /**
   * Get user activity analytics
   * GET /api/analytics/users
   * Permissions: analytics.view (admin+)
   */
  async getUserAnalytics(req, res) {
    try {
      // Validate query parameters
      const { error, value } = validateAnalyticsQuery(req.query);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message
        });
      }

      const {
        period = '30d',
        group_by = 'day',
        user_id,
        role,
        include_activity = true,
        include_performance = true
      } = value;

      // Get user analytics
      const analytics = await analyticsService.getUserAnalytics({
        period,
        groupBy: group_by,
        filters: {
          userId: user_id,
          role
        },
        includeActivity: include_activity,
        includePerformance: include_performance,
        requestingUser: req.user
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'user_analytics',
        user_id || 'all_users',
        req.ip
      );

      res.json({
        success: true,
        period,
        group_by,
        filters: { user_id, role },
        analytics,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get user analytics error:', error);
      res.status(500).json({
        error: 'Failed to retrieve user analytics',
        message: 'An error occurred while fetching user analytics'
      });
    }
  }

  /**
   * Get performance metrics
   * GET /api/analytics/performance
   * Permissions: analytics.view (admin+)
   */
  async getPerformanceMetrics(req, res) {
    try {
      const { 
        period = '30d',
        metric_type = 'all',
        include_sla = true,
        include_benchmarks = true
      } = req.query;

      // Get performance metrics
      const metrics = await analyticsService.getPerformanceMetrics({
        period,
        metricType: metric_type,
        includeSLA: include_sla,
        includeBenchmarks: include_benchmarks,
        requestingUser: req.user
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'performance_analytics',
        metric_type,
        req.ip
      );

      res.json({
        success: true,
        period,
        metric_type,
        metrics,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get performance metrics error:', error);
      res.status(500).json({
        error: 'Failed to retrieve performance metrics',
        message: 'An error occurred while fetching performance data'
      });
    }
  }

  /**
   * Get satisfaction analytics
   * GET /api/analytics/satisfaction
   * Permissions: analytics.view (admin+)
   */
  async getSatisfactionAnalytics(req, res) {
    try {
      const {
        period = '30d',
        group_by = 'week',
        category,
        assigned_to,
        include_comments = true
      } = req.query;

      // Get satisfaction analytics
      const analytics = await analyticsService.getSatisfactionAnalytics({
        period,
        groupBy: group_by,
        filters: {
          category,
          assignedTo: assigned_to
        },
        includeComments: include_comments,
        requestingUser: req.user
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'satisfaction_analytics',
        `${period}_${group_by}`,
        req.ip
      );

      res.json({
        success: true,
        period,
        group_by,
        filters: { category, assigned_to },
        analytics,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get satisfaction analytics error:', error);
      res.status(500).json({
        error: 'Failed to retrieve satisfaction analytics',
        message: 'An error occurred while fetching satisfaction data'
      });
    }
  }

  /**
   * Get trend analysis
   * GET /api/analytics/trends
   * Permissions: analytics.view (admin+)
   */
  async getTrendAnalysis(req, res) {
    try {
      const {
        metric = 'tickets_created',
        period = '90d',
        granularity = 'day',
        compare_period = false,
        include_forecast = false
      } = req.query;

      // Get trend analysis
      const trends = await analyticsService.getTrendAnalysis({
        metric,
        period,
        granularity,
        comparePeriod: compare_period,
        includeForecast: include_forecast,
        requestingUser: req.user
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'trend_analytics',
        `${metric}_${period}`,
        req.ip
      );

      res.json({
        success: true,
        metric,
        period,
        granularity,
        trends,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get trend analysis error:', error);
      res.status(500).json({
        error: 'Failed to retrieve trend analysis',
        message: 'An error occurred while fetching trend data'
      });
    }
  }

  /**
   * Generate detailed report
   * POST /api/analytics/reports
   * Permissions: analytics.reports (admin+)
   */
  async generateReport(req, res) {
    try {
      // Validate report request
      const { error, value } = validateReportQuery(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.details[0].message,
          details: error.details
        });
      }

      const {
        report_type,
        period,
        filters = {},
        format = 'json',
        include_charts = false,
        email_recipients = []
      } = value;

      // Generate report
      const report = await reportService.generateReport({
        reportType: report_type,
        period,
        filters,
        format,
        includeCharts: include_charts,
        emailRecipients: email_recipients,
        requestingUser: req.user
      });

      // Log report generation
      logger.security.logAdminAction(
        req.user.id,
        'report_generated',
        report.id,
        {
          report_type,
          period,
          format,
          filters
        },
        req.ip
      );

      if (format === 'json') {
        res.json({
          success: true,
          report,
          generated_at: new Date().toISOString()
        });
      } else {
        // For PDF/CSV/Excel formats, send file
        res.setHeader('Content-Type', report.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
        res.send(report.data);
      }
    } catch (error) {
      logger.error('Generate report error:', error);
      res.status(500).json({
        error: 'Failed to generate report',
        message: 'An error occurred while generating the report'
      });
    }
  }

  /**
   * Get real-time statistics
   * GET /api/analytics/realtime
   * Permissions: analytics.view (admin+)
   */
  async getRealtimeStats(req, res) {
    try {
      const { metrics = 'all' } = req.query;

      // Get real-time statistics
      const realtimeData = await analyticsService.getRealtimeStatistics({
        metrics,
        requestingUser: req.user
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'realtime_analytics',
        metrics,
        req.ip
      );

      res.json({
        success: true,
        metrics,
        data: realtimeData,
        timestamp: new Date().toISOString(),
        cache_ttl: 30 // 30 seconds cache TTL for real-time data
      });
    } catch (error) {
      logger.error('Get realtime stats error:', error);
      res.status(500).json({
        error: 'Failed to retrieve real-time statistics',
        message: 'An error occurred while fetching real-time data'
      });
    }
  }

  /**
   * Get category performance analytics
   * GET /api/analytics/categories
   * Permissions: analytics.view (admin+)
   */
  async getCategoryAnalytics(req, res) {
    try {
      const {
        period = '30d',
        include_subcategories = false,
        sort_by = 'volume',
        include_trends = true
      } = req.query;

      // Get category analytics
      const analytics = await analyticsService.getCategoryAnalytics({
        period,
        includeSubcategories: include_subcategories,
        sortBy: sort_by,
        includeTrends: include_trends,
        requestingUser: req.user
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'category_analytics',
        period,
        req.ip
      );

      res.json({
        success: true,
        period,
        sort_by,
        analytics,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get category analytics error:', error);
      res.status(500).json({
        error: 'Failed to retrieve category analytics',
        message: 'An error occurred while fetching category data'
      });
    }
  }

  /**
   * Get system health analytics
   * GET /api/analytics/system-health
   * Permissions: system.health (super_admin only)
   */
  async getSystemHealthAnalytics(req, res) {
    try {
      const {
        period = '24h',
        include_alerts = true,
        include_performance = true
      } = req.query;

      // Get system health analytics
      const healthData = await analyticsService.getSystemHealthAnalytics({
        period,
        includeAlerts: include_alerts,
        includePerformance: include_performance,
        requestingUser: req.user
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'system_health_analytics',
        period,
        req.ip
      );

      res.json({
        success: true,
        period,
        health_data: healthData,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get system health analytics error:', error);
      res.status(500).json({
        error: 'Failed to retrieve system health analytics',
        message: 'An error occurred while fetching system health data'
      });
    }
  }

  /**
   * Export analytics data
   * POST /api/analytics/export
   * Permissions: analytics.export (admin+)
   */
  async exportAnalytics(req, res) {
    try {
      const {
        data_type,
        period = '30d',
        format = 'csv',
        filters = {},
        include_metadata = true
      } = req.body;

      // Validate export request
      if (!['tickets', 'users', 'comments', 'attachments', 'all'].includes(data_type)) {
        return res.status(400).json({
          error: 'Invalid data type',
          message: 'Data type must be one of: tickets, users, comments, attachments, all'
        });
      }

      // Generate export
      const exportData = await analyticsService.exportAnalyticsData({
        dataType: data_type,
        period,
        format,
        filters,
        includeMetadata: include_metadata,
        requestingUser: req.user
      });

      // Log export
      logger.security.logAdminAction(
        req.user.id,
        'analytics_exported',
        null,
        {
          data_type,
          period,
          format,
          record_count: exportData.recordCount
        },
        req.ip
      );

      // Set appropriate headers and send file
      res.setHeader('Content-Type', exportData.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${exportData.filename}"`);
      res.send(exportData.data);
    } catch (error) {
      logger.error('Export analytics error:', error);
      res.status(500).json({
        error: 'Failed to export analytics data',
        message: 'An error occurred while exporting data'
      });
    }
  }

  /**
   * Get available analytics metrics
   * GET /api/analytics/metrics
   * Permissions: analytics.view (admin+)
   */
  async getAvailableMetrics(req, res) {
    try {
      const metrics = await analyticsService.getAvailableMetrics({
        requestingUser: req.user
      });

      res.json({
        success: true,
        metrics,
        total_metrics: metrics.length,
        categories: [...new Set(metrics.map(m => m.category))]
      });
    } catch (error) {
      logger.error('Get available metrics error:', error);
      res.status(500).json({
        error: 'Failed to retrieve available metrics',
        message: 'An error occurred while fetching metrics list'
      });
    }
  }

  /**
   * Get analytics summary for email reports
   * GET /api/analytics/summary
   * Permissions: analytics.view (admin+)
   */
  async getAnalyticsSummary(req, res) {
    try {
      const {
        period = '7d',
        email_format = false,
        include_recommendations = true
      } = req.query;

      // Get analytics summary
      const summary = await analyticsService.getAnalyticsSummary({
        period,
        emailFormat: email_format,
        includeRecommendations: include_recommendations,
        requestingUser: req.user
      });

      // Log access
      logger.security.logDataAccess(
        req.user.id,
        'view',
        'analytics_summary',
        period,
        req.ip
      );

      res.json({
        success: true,
        period,
        summary,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get analytics summary error:', error);
      res.status(500).json({
        error: 'Failed to retrieve analytics summary',
        message: 'An error occurred while fetching summary data'
      });
    }
  }
}

module.exports = new AnalyticsController();