// src/services/analyticsService.js - TPG Analytics Service
const Ticket = require('../models/Ticket');
const TicketComment = require('../models/TicketComment');
const TicketAttachment = require('../models/TicketAttachment');
const User = require('../models/User');
const logger = require('../config/logger');

class AnalyticsService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
  }

  /**
   * Get comprehensive ticket analytics
   */
  async getTicketAnalytics(options = {}) {
    try {
      const {
        period = '30d',
        groupBy = 'day',
        filters = {},
        includeTrends = true,
        includeForecasts = false,
        requestingUser
      } = options;

      const cacheKey = `ticket_analytics_${JSON.stringify({ period, groupBy, filters })}`;
      const cached = this.getFromCache(cacheKey);
      if (cached) return cached;

      // Get date range
      const { startDate, endDate } = this.getDateRange(period);

      // Build base query
      let query = Ticket.query()
        .where('created_at', '>=', startDate)
        .where('created_at', '<=', endDate);

      // Apply filters
      query = this.applyFilters(query, filters, requestingUser);

      // Get tickets with relations
      const tickets = await query.withGraphFetched('[user, assignedUser, comments, attachments]');

      // Process analytics data
      const analytics = {
        overview: this.calculateOverviewMetrics(tickets),
        timeline: this.generateTimeline(tickets, groupBy, startDate, endDate),
        categories: this.calculateCategoryMetrics(tickets),
        status_flow: this.calculateStatusFlow(tickets),
        performance: this.calculatePerformanceMetrics(tickets),
        user_metrics: this.calculateUserMetrics(tickets)
      };

      // Add trends if requested
      if (includeTrends) {
        analytics.trends = await this.calculateTrends(tickets, period);
      }

      // Add forecasts if requested
      if (includeForecasts) {
        analytics.forecasts = await this.generateForecasts(analytics.timeline, 30);
      }

      // Cache results
      this.setCache(cacheKey, analytics);

      return analytics;
    } catch (error) {
      logger.error('AnalyticsService.getTicketAnalytics error:', error);
      throw error;
    }
  }

  /**
   * Get user activity analytics
   */
  async getUserAnalytics(options = {}) {
    try {
      const {
        period = '30d',
        groupBy = 'day',
        filters = {},
        includeActivity = true,
        includePerformance = true,
        requestingUser
      } = options;

      const { startDate, endDate } = this.getDateRange(period);

      // Get users with activity data
      let userQuery = User.query();

      if (filters.userId) {
        userQuery = userQuery.where('id', filters.userId);
      }

      if (filters.role) {
        userQuery = userQuery.where('role', filters.role);
      }

      const users = await userQuery.withGraphFetched(`[
        tickets(inPeriod).[comments, attachments],
        assignedTickets(inPeriod).[comments, attachments],
        comments(inPeriod)
      ]`).modifiers({
        inPeriod: builder => builder
          .where('created_at', '>=', startDate)
          .where('created_at', '<=', endDate)
      });

      const analytics = {
        overview: this.calculateUserOverview(users),
        activity_timeline: includeActivity ? this.generateUserActivityTimeline(users, groupBy, startDate, endDate) : null,
        performance_metrics: includePerformance ? this.calculateUserPerformanceMetrics(users) : null,
        top_performers: this.getTopPerformers(users),
        engagement_metrics: this.calculateEngagementMetrics(users)
      };

      return analytics;
    } catch (error) {
      logger.error('AnalyticsService.getUserAnalytics error:', error);
      throw error;
    }
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(options = {}) {
    try {
      const {
        period = '30d',
        metricType = 'all',
        includeSLA = true,
        includeBenchmarks = true,
        requestingUser
      } = options;

      const { startDate, endDate } = this.getDateRange(period);

      // Get tickets for performance analysis
      const tickets = await Ticket.query()
        .where('created_at', '>=', startDate)
        .where('created_at', '<=', endDate)
        .withGraphFetched('[comments(orderByCreated)]')
        .modifiers({
          orderByCreated: builder => builder.orderBy('created_at', 'asc')
        });

      const metrics = {};

      if (metricType === 'all' || metricType === 'resolution') {
        metrics.resolution = this.calculateResolutionMetrics(tickets);
      }

      if (metricType === 'all' || metricType === 'response') {
        metrics.response = this.calculateResponseMetrics(tickets);
      }

      if (metricType === 'all' || metricType === 'satisfaction') {
        metrics.satisfaction = this.calculateSatisfactionMetrics(tickets);
      }

      if (metricType === 'all' || metricType === 'sla') {
        metrics.sla = includeSLA ? this.calculateSLAMetrics(tickets) : null;
      }

      if (includeBenchmarks) {
        metrics.benchmarks = await this.getBenchmarkComparisons(metrics, period);
      }

      return metrics;
    } catch (error) {
      logger.error('AnalyticsService.getPerformanceMetrics error:', error);
      throw error;
    }
  }

  /**
   * Get satisfaction analytics
   */
  async getSatisfactionAnalytics(options = {}) {
    try {
      const {
        period = '30d',
        groupBy = 'week',
        filters = {},
        includeComments = true,
        requestingUser
      } = options;

      const { startDate, endDate } = this.getDateRange(period);

      // Get tickets with satisfaction ratings
      let query = Ticket.query()
        .whereNotNull('satisfaction_rating')
        .where('created_at', '>=', startDate)
        .where('created_at', '<=', endDate);

      query = this.applyFilters(query, filters, requestingUser);

      const tickets = await query.withGraphFetched('[user, assignedUser]');

      const analytics = {
        overview: this.calculateSatisfactionOverview(tickets),
        timeline: this.generateSatisfactionTimeline(tickets, groupBy, startDate, endDate),
        by_category: this.calculateSatisfactionByCategory(tickets),
        by_assignee: this.calculateSatisfactionByAssignee(tickets),
        correlations: this.calculateSatisfactionCorrelations(tickets)
      };

      if (includeComments) {
        analytics.comment_analysis = await this.analyzeSatisfactionComments(tickets);
      }

      return analytics;
    } catch (error) {
      logger.error('AnalyticsService.getSatisfactionAnalytics error:', error);
      throw error;
    }
  }

  /**
   * Get trend analysis
   */
  async getTrendAnalysis(options = {}) {
    try {
      const {
        metric = 'tickets_created',
        period = '90d',
        granularity = 'day',
        comparePeriod = false,
        includeForecast = false,
        requestingUser
      } = options;

      const { startDate, endDate } = this.getDateRange(period);
      
      // Get data for trend analysis
      const data = await this.getTrendData(metric, startDate, endDate, granularity);

      const trends = {
        metric,
        period,
        granularity,
        data_points: data,
        statistics: this.calculateTrendStatistics(data),
        insights: this.generateTrendInsights(data, metric)
      };

      // Add comparison period if requested
      if (comparePeriod) {
        const comparisonStart = new Date(startDate);
        const comparisonEnd = new Date(endDate);
        const periodLength = endDate - startDate;
        comparisonStart.setTime(comparisonStart.getTime() - periodLength);
        comparisonEnd.setTime(comparisonEnd.getTime() - periodLength);

        const comparisonData = await this.getTrendData(metric, comparisonStart, comparisonEnd, granularity);
        trends.comparison = {
          data_points: comparisonData,
          statistics: this.calculateTrendStatistics(comparisonData),
          change: this.calculatePeriodChange(data, comparisonData)
        };
      }

      // Add forecast if requested
      if (includeForecast) {
        trends.forecast = this.generateTrendForecast(data, 30);
      }

      return trends;
    } catch (error) {
      logger.error('AnalyticsService.getTrendAnalysis error:', error);
      throw error;
    }
  }

  /**
   * Get real-time statistics
   */
  async getRealtimeStatistics(options = {}) {
    try {
      const { metrics = 'all', requestingUser } = options;

      const realtimeData = {};

      if (metrics === 'all' || metrics.includes('tickets')) {
        realtimeData.tickets = await this.getRealtimeTicketStats();
      }

      if (metrics === 'all' || metrics.includes('users')) {
        realtimeData.users = await this.getRealtimeUserStats();
      }

      if (metrics === 'all' || metrics.includes('performance')) {
        realtimeData.performance = await this.getRealtimePerformanceStats();
      }

      if (metrics === 'all' || metrics.includes('system')) {
        realtimeData.system = await this.getRealtimeSystemStats();
      }

      return {
        ...realtimeData,
        last_updated: new Date().toISOString(),
        refresh_rate: 30 // seconds
      };
    } catch (error) {
      logger.error('AnalyticsService.getRealtimeStatistics error:', error);
      throw error;
    }
  }

  /**
   * Get category analytics
   */
  async getCategoryAnalytics(options = {}) {
    try {
      const {
        period = '30d',
        includeSubcategories = false,
        sortBy = 'volume',
        includeTrends = true,
        requestingUser
      } = options;

      const { startDate, endDate } = this.getDateRange(period);

      const tickets = await Ticket.query()
        .where('created_at', '>=', startDate)
        .where('created_at', '<=', endDate)
        .withGraphFetched('[user, assignedUser, comments]');

      const analytics = {
        overview: this.calculateCategoryOverview(tickets),
        performance_by_category: this.calculateCategoryPerformance(tickets),
        trends_by_category: includeTrends ? this.calculateCategoryTrends(tickets, period) : null,
        volume_distribution: this.calculateVolumeDistribution(tickets),
        resolution_efficiency: this.calculateCategoryResolutionEfficiency(tickets)
      };

      // Sort categories based on sortBy parameter
      analytics.sorted_categories = this.sortCategories(analytics.overview, sortBy);

      return analytics;
    } catch (error) {
      logger.error('AnalyticsService.getCategoryAnalytics error:', error);
      throw error;
    }
  }

  /**
   * Get system health analytics
   */
  async getSystemHealthAnalytics(options = {}) {
    try {
      const {
        period = '24h',
        includeAlerts = true,
        includePerformance = true,
        requestingUser
      } = options;

      const healthData = {
        database: await this.getDatabaseHealthMetrics(),
        api_performance: await this.getAPIPerformanceMetrics(period),
        error_rates: await this.getErrorRateMetrics(period),
        resource_usage: await this.getResourceUsageMetrics()
      };

      if (includeAlerts) {
        healthData.alerts = await this.getSystemAlerts();
      }

      if (includePerformance) {
        healthData.performance_trends = await this.getPerformanceTrends(period);
      }

      return healthData;
    } catch (error) {
      logger.error('AnalyticsService.getSystemHealthAnalytics error:', error);
      throw error;
    }
  }

  /**
   * Export analytics data
   */
  async exportAnalyticsData(options = {}) {
    try {
      const {
        dataType,
        period = '30d',
        format = 'csv',
        filters = {},
        includeMetadata = true,
        requestingUser
      } = options;

      const { startDate, endDate } = this.getDateRange(period);

      let data, headers;
switch (dataType) {
  case 'tickets':
    ({ data, headers } = await this.exportTicketData(startDate, endDate, filters, includeMetadata));
    break;
  case 'users':
    ({ data, headers } = await this.exportUserData(startDate, endDate, filters, includeMetadata));
    break;
  case 'comments':
    ({ data, headers } = await this.exportCommentData(startDate, endDate, filters, includeMetadata));
    break;
  case 'attachments':
    ({ data, headers } = await this.exportAttachmentData(startDate, endDate, filters, includeMetadata));
    break;
  case 'all':
    ({ data, headers } = await this.exportAllData(startDate, endDate, filters, includeMetadata));
    break;
  default:
    throw new Error('Invalid data type for export');
}


      // Format data based on requested format
      const formattedData = await this.formatExportData(data, headers, format);

      return {
        data: formattedData.data,
        filename: formattedData.filename,
        mimeType: formattedData.mimeType,
        recordCount: data.length
      };
    } catch (error) {
      logger.error('AnalyticsService.exportAnalyticsData error:', error);
      throw error;
    }
  }

  /**
   * Get available metrics
   */
  async getAvailableMetrics(options = {}) {
    return [
      {
        name: 'tickets_created',
        category: 'Volume',
        description: 'Number of tickets created over time',
        data_type: 'count',
        aggregation: ['sum', 'avg']
      },
      {
        name: 'tickets_resolved',
        category: 'Resolution',
        description: 'Number of tickets resolved over time',
        data_type: 'count',
        aggregation: ['sum', 'avg']
      },
      {
        name: 'resolution_time',
        category: 'Performance',
        description: 'Average time to resolve tickets',
        data_type: 'duration',
        aggregation: ['avg', 'median', 'p95']
      },
      {
        name: 'first_response_time',
        category: 'Performance',
        description: 'Time to first response on tickets',
        data_type: 'duration',
        aggregation: ['avg', 'median', 'p95']
      },
      {
        name: 'user_satisfaction',
        category: 'Quality',
        description: 'User satisfaction ratings',
        data_type: 'rating',
        aggregation: ['avg', 'distribution']
      },
      {
        name: 'user_activity',
        category: 'Engagement',
        description: 'User activity and engagement metrics',
        data_type: 'count',
        aggregation: ['sum', 'unique_users']
      },
      {
        name: 'category_distribution',
        category: 'Classification',
        description: 'Distribution of tickets by category',
        data_type: 'percentage',
        aggregation: ['distribution']
      },
      {
        name: 'urgency_distribution',
        category: 'Classification',
        description: 'Distribution of tickets by urgency',
        data_type: 'percentage',
        aggregation: ['distribution']
      }
    ];
  }

  /**
   * Get analytics summary
   */
  async getAnalyticsSummary(options = {}) {
    try {
      const {
        period = '7d',
        emailFormat = false,
        includeRecommendations = true,
        requestingUser
      } = options;

      const { startDate, endDate } = this.getDateRange(period);

      // Get key metrics
      const tickets = await Ticket.query()
        .where('created_at', '>=', startDate)
        .where('created_at', '<=', endDate)
        .withGraphFetched('[comments, attachments]');

      const summary = {
        period: {
          start: startDate,
          end: endDate,
          days: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
        },
        key_metrics: {
          total_tickets: tickets.length,
          resolved_tickets: tickets.filter(t => t.status === 'resolved').length,
          avg_resolution_time: this.calculateAverageResolutionTime(tickets),
          customer_satisfaction: this.calculateAverageSatisfaction(tickets),
          overdue_tickets: tickets.filter(t => this.isTicketOverdue(t)).length
        },
        highlights: this.generateSummaryHighlights(tickets),
        alerts: this.generateSummaryAlerts(tickets)
      };

      if (includeRecommendations) {
        summary.recommendations = this.generateRecommendations(summary);
      }

      if (emailFormat) {
        summary.email_content = this.formatForEmail(summary);
      }

      return summary;
    } catch (error) {
      logger.error('AnalyticsService.getAnalyticsSummary error:', error);
      throw error;
    }
  }

  // Helper methods

  /**
   * Get date range based on period
   */
  getDateRange(period) {
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case '1d':
        startDate.setDate(endDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      case '180d':
        startDate.setDate(endDate.getDate() - 180);
        break;
      case '1y':
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      case 'all':
        startDate.setFullYear(2020); // Set to a reasonable start date
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    return { startDate, endDate };
  }

  /**
   * Apply filters to query
   */
  applyFilters(query, filters, requestingUser) {
    // Apply user permission filters
    if (requestingUser.role === 'user') {
      query = query.where('user_id', requestingUser.id);
    }

    // Apply explicit filters
    if (filters.category) {
      if (Array.isArray(filters.category)) {
        query = query.whereIn('category', filters.category);
      } else {
        query = query.where('category', filters.category);
      }
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query = query.whereIn('status', filters.status);
      } else {
        query = query.where('status', filters.status);
      }
    }

    if (filters.urgency) {
      if (Array.isArray(filters.urgency)) {
        query = query.whereIn('urgency', filters.urgency);
      } else {
        query = query.where('urgency', filters.urgency);
      }
    }

    if (filters.assignedTo) {
      query = query.where('assigned_to', filters.assignedTo);
    }

    if (filters.userId) {
      query = query.where('user_id', filters.userId);
    }

    return query;
  }

  /**
   * Calculate overview metrics
   */
  calculateOverviewMetrics(tickets) {
    const total = tickets.length;
    const resolved = tickets.filter(t => t.status === 'resolved').length;
    const closed = tickets.filter(t => t.status === 'closed').length;
    const overdue = tickets.filter(t => this.isTicketOverdue(t)).length;

    return {
      total_tickets: total,
      resolved_tickets: resolved,
      closed_tickets: closed,
      open_tickets: tickets.filter(t => t.status === 'open').length,
      in_progress_tickets: tickets.filter(t => t.status === 'in-progress').length,
      overdue_tickets: overdue,
      resolution_rate: total > 0 ? ((resolved + closed) / total * 100).toFixed(2) : 0,
      avg_resolution_time: this.calculateAverageResolutionTime(tickets),
      avg_satisfaction: this.calculateAverageSatisfaction(tickets)
    };
  }

  /**
   * Generate timeline data
   */
  generateTimeline(tickets, groupBy, startDate, endDate) {
    const timeline = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const periodStart = new Date(current);
      const periodEnd = new Date(current);

      // Set period end based on groupBy
      switch (groupBy) {
        case 'hour':
          periodEnd.setHours(periodEnd.getHours() + 1);
          break;
        case 'day':
          periodEnd.setDate(periodEnd.getDate() + 1);
          break;
        case 'week':
          periodEnd.setDate(periodEnd.getDate() + 7);
          break;
        case 'month':
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          break;
      }

      // Filter tickets for this period
      const periodTickets = tickets.filter(t => {
        const ticketDate = new Date(t.created_at);
        return ticketDate >= periodStart && ticketDate < periodEnd;
      });

      timeline.push({
        period: periodStart.toISOString(),
        created: periodTickets.length,
        resolved: periodTickets.filter(t => {
          return t.resolved_at && new Date(t.resolved_at) >= periodStart && new Date(t.resolved_at) < periodEnd;
        }).length,
        avg_resolution_time: this.calculateAverageResolutionTime(periodTickets.filter(t => t.resolved_at))
      });

      // Move to next period
      switch (groupBy) {
        case 'hour':
          current.setHours(current.getHours() + 1);
          break;
        case 'day':
          current.setDate(current.getDate() + 1);
          break;
        case 'week':
          current.setDate(current.getDate() + 7);
          break;
        case 'month':
          current.setMonth(current.getMonth() + 1);
          break;
      }
    }

    return timeline;
  }

  /**
   * Calculate performance metrics
   */
  calculatePerformanceMetrics(tickets) {
    const resolvedTickets = tickets.filter(t => t.resolved_at);
    const resolutionTimes = resolvedTickets.map(t => {
      return (new Date(t.resolved_at) - new Date(t.created_at)) / (1000 * 60 * 60); // hours
    });

    const responseTimeTickets = tickets.filter(t => t.first_response_at);
    const responseTimes = responseTimeTickets.map(t => {
      return (new Date(t.first_response_at) - new Date(t.created_at)) / (1000 * 60 * 60); // hours
    });

    return {
      avg_resolution_time: resolutionTimes.length > 0 ? 
        resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length : 0,
      median_resolution_time: this.calculateMedian(resolutionTimes),
      avg_first_response_time: responseTimes.length > 0 ? 
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0,
      median_first_response_time: this.calculateMedian(responseTimes),
      sla_compliance: this.calculateSLACompliance(tickets)
    };
  }

  /**
   * Cache management
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Check if ticket is overdue
   */
  isTicketOverdue(ticket) {
    if (!ticket.estimated_resolution_hours || ['resolved', 'closed'].includes(ticket.status)) {
      return false;
    }

    const createdAt = new Date(ticket.created_at);
    const expectedResolution = new Date(createdAt.getTime() + (ticket.estimated_resolution_hours * 60 * 60 * 1000));
    return new Date() > expectedResolution;
  }

  /**
   * Calculate average resolution time
   */
  calculateAverageResolutionTime(tickets) {
    const resolvedTickets = tickets.filter(t => t.resolved_at);
    if (resolvedTickets.length === 0) return 0;

    const totalTime = resolvedTickets.reduce((sum, ticket) => {
      const resolutionTime = (new Date(ticket.resolved_at) - new Date(ticket.created_at)) / (1000 * 60 * 60);
      return sum + resolutionTime;
    }, 0);

    return Math.round(totalTime / resolvedTickets.length * 100) / 100;
  }

  /**
   * Calculate average satisfaction
   */
  calculateAverageSatisfaction(tickets) {
    const ratedTickets = tickets.filter(t => t.satisfaction_rating);
    if (ratedTickets.length === 0) return 0;

    const totalRating = ratedTickets.reduce((sum, ticket) => sum + ticket.satisfaction_rating, 0);
    return Math.round(totalRating / ratedTickets.length * 100) / 100;
  }

  /**
   * Calculate median
   */
  calculateMedian(values) {
    if (values.length === 0) return 0;
    
    const sorted = values.sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    } else {
      return sorted[middle];
    }
  }

  /**
   * Calculate SLA compliance
   */
  calculateSLACompliance(tickets) {
    const slaTickets = tickets.filter(t => t.estimated_resolution_hours);
    if (slaTickets.length === 0) return 100;

    const compliantTickets = slaTickets.filter(t => {
      if (!t.resolved_at) return false;
      
      const resolutionTime = (new Date(t.resolved_at) - new Date(t.created_at)) / (1000 * 60 * 60);
      return resolutionTime <= t.estimated_resolution_hours;
    });

    return Math.round((compliantTickets.length / slaTickets.length) * 100);
  }

  // Additional helper methods would be implemented here...
  // For brevity, I'm including stubs for some methods

  async calculateTrends(tickets, period) {
    // Implementation for trend calculation
    return {
      direction: 'increasing',
      percentage_change: 12.5,
      confidence: 0.85
    };
  }

  async generateForecasts(timeline, days) {
    // Implementation for forecast generation
    return {
      forecast_days: days,
      predicted_tickets: timeline.length > 0 ? timeline[timeline.length - 1].created * 1.1 : 0
    };
  }

  calculateCategoryMetrics(tickets) {
    const categories = {};
    tickets.forEach(ticket => {
      if (!categories[ticket.category]) {
        categories[ticket.category] = {
          count: 0,
          resolved: 0,
          avg_resolution_time: 0,
          satisfaction: 0
        };
      }
      categories[ticket.category].count++;
      if (ticket.status === 'resolved') {
        categories[ticket.category].resolved++;
      }
    });
    return categories;
  }

  calculateStatusFlow(tickets) {
    // Calculate status transitions and flow
    return {
      open_to_progress: 0,
      progress_to_resolved: 0,
      resolved_to_closed: 0
    };
  }

  calculateUserMetrics(tickets) {
    const users = {};
    tickets.forEach(ticket => {
      if (!users[ticket.user_id]) {
        users[ticket.user_id] = { count: 0, resolved: 0 };
      }
      users[ticket.user_id].count++;
      if (ticket.status === 'resolved') {
        users[ticket.user_id].resolved++;
      }
    });
    return users;
  }

  // More helper methods would be implemented here for real-time stats,
  // export functionality, etc.
}

module.exports = new AnalyticsService();