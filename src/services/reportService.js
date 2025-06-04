// src/services/reportService.js - TPG Report Service
const Ticket = require('../models/Ticket');
const TicketComment = require('../models/TicketComment');
const TicketAttachment = require('../models/TicketAttachment');
const User = require('../models/User');
const analyticsService = require('./analyticsService');
const emailService = require('./emailService');
const logger = require('../config/logger');
const { v4: uuidv4 } = require('uuid');

class ReportService {
  constructor() {
    this.reportCache = new Map();
    this.scheduledReports = new Map();
  }

  /**
   * Generate comprehensive report
   */
  async generateReport(options = {}) {
    try {
      const {
        reportType,
        period = '30d',
        filters = {},
        format = 'json',
        includeCharts = false,
        emailRecipients = [],
        requestingUser
      } = options;

      const reportId = uuidv4();
      
      logger.info(`Generating report: ${reportType}`, {
        report_id: reportId,
        requesting_user: requestingUser.id,
        format,
        period
      });

      // Get report data based on type
      const reportData = await this.getReportData(reportType, period, filters, requestingUser);

      // Process and format the report
      const processedReport = await this.processReportData(reportData, reportType, includeCharts);

      // Generate final report in requested format
      const finalReport = await this.formatReport(processedReport, format, reportType);

      // Store report metadata
      const reportMetadata = {
        id: reportId,
        type: reportType,
        period,
        filters,
        format,
        created_at: new Date().toISOString(),
        created_by: requestingUser.id,
        size_bytes: finalReport.data ? finalReport.data.length : 0,
        record_count: reportData.recordCount || 0
      };

      // Send via email if recipients specified
      if (emailRecipients.length > 0) {
        await this.emailReport(finalReport, reportMetadata, emailRecipients);
      }

      // Cache report for future access
      this.cacheReport(reportId, {
        ...finalReport,
        metadata: reportMetadata
      });

      return {
        id: reportId,
        ...finalReport,
        metadata: reportMetadata
      };
    } catch (error) {
      logger.error('ReportService.generateReport error:', error);
      throw error;
    }
  }

  /**
   * Get report data based on type
   */
  async getReportData(reportType, period, filters, requestingUser) {
    const { startDate, endDate } = this.getDateRange(period);

    switch (reportType) {
      case 'summary':
        return await this.getSummaryReportData(startDate, endDate, filters, requestingUser);
      
      case 'detailed_tickets':
        return await this.getDetailedTicketsData(startDate, endDate, filters, requestingUser);
      
      case 'user_activity':
        return await this.getUserActivityData(startDate, endDate, filters, requestingUser);
      
      case 'performance_metrics':
        return await this.getPerformanceMetricsData(startDate, endDate, filters, requestingUser);
      
      case 'satisfaction_analysis':
        return await this.getSatisfactionAnalysisData(startDate, endDate, filters, requestingUser);
      
      case 'category_breakdown':
        return await this.getCategoryBreakdownData(startDate, endDate, filters, requestingUser);
      
      case 'sla_compliance':
        return await this.getSLAComplianceData(startDate, endDate, filters, requestingUser);
      
      case 'trend_analysis':
        return await this.getTrendAnalysisData(startDate, endDate, filters, requestingUser);
      
      case 'executive_summary':
        return await this.getExecutiveSummaryData(startDate, endDate, filters, requestingUser);
      
      case 'operational_report':
        return await this.getOperationalReportData(startDate, endDate, filters, requestingUser);
      
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }
  }

  /**
   * Get summary report data
   */
  async getSummaryReportData(startDate, endDate, filters, requestingUser) {
    const tickets = await this.getFilteredTickets(startDate, endDate, filters, requestingUser);
    
    return {
      title: 'TPG Support Summary Report',
      period: { start: startDate, end: endDate },
      overview: this.calculateOverviewMetrics(tickets),
      category_breakdown: this.calculateCategoryBreakdown(tickets),
      status_distribution: this.calculateStatusDistribution(tickets),
      urgency_analysis: this.calculateUrgencyAnalysis(tickets),
      performance_summary: this.calculatePerformanceSummary(tickets),
      top_issues: this.getTopIssues(tickets),
      recommendations: this.generateRecommendations(tickets),
      recordCount: tickets.length
    };
  }

  /**
   * Get detailed tickets data
   */
  async getDetailedTicketsData(startDate, endDate, filters, requestingUser) {
    const tickets = await this.getFilteredTickets(startDate, endDate, filters, requestingUser, {
      withGraphFetched: '[user, assignedUser, comments, attachments]'
    });

    const detailedTickets = tickets.map(ticket => ({
      ticket_number: ticket.ticket_number,
      title: ticket.title,
      description: ticket.description,
      category: ticket.category,
      urgency: ticket.urgency,
      status: ticket.status,
      created_at: ticket.created_at,
      resolved_at: ticket.resolved_at,
      closed_at: ticket.closed_at,
      resolution_time_hours: ticket.actual_resolution_hours,
      satisfaction_rating: ticket.satisfaction_rating,
      satisfaction_comment: ticket.satisfaction_comment,
      user: {
        username: ticket.user?.username,
        email: ticket.user?.email,
        pharmacy_name: ticket.user?.pharmacy_name
      },
      assigned_user: {
        username: ticket.assignedUser?.username,
        email: ticket.assignedUser?.email
      },
      comments_count: ticket.comments?.length || 0,
      attachments_count: ticket.attachments?.length || 0,
      tags: ticket.tags || []
    }));

    return {
      title: 'Detailed Tickets Report',
      period: { start: startDate, end: endDate },
      tickets: detailedTickets,
      summary: {
        total_tickets: detailedTickets.length,
        avg_resolution_time: this.calculateAverageResolutionTime(tickets),
        avg_satisfaction: this.calculateAverageSatisfaction(tickets)
      },
      recordCount: detailedTickets.length
    };
  }

  /**
   * Get user activity data
   */
  async getUserActivityData(startDate, endDate, filters, requestingUser) {
    const tickets = await this.getFilteredTickets(startDate, endDate, filters, requestingUser);
    const comments = await this.getFilteredComments(startDate, endDate, filters, requestingUser);
    
    // Calculate user activity metrics
    const userActivity = {};
    
    // Process tickets
    tickets.forEach(ticket => {
      if (!userActivity[ticket.user_id]) {
        userActivity[ticket.user_id] = {
          tickets_created: 0,
          tickets_resolved: 0,
          total_comments: 0,
          avg_satisfaction: 0,
          satisfaction_ratings: []
        };
      }
      
      userActivity[ticket.user_id].tickets_created++;
      
      if (ticket.status === 'resolved') {
        userActivity[ticket.user_id].tickets_resolved++;
      }
      
      if (ticket.satisfaction_rating) {
        userActivity[ticket.user_id].satisfaction_ratings.push(ticket.satisfaction_rating);
      }
    });
    
    // Process comments
    comments.forEach(comment => {
      if (userActivity[comment.user_id]) {
        userActivity[comment.user_id].total_comments++;
      }
    });
    
    // Calculate averages and get user details
    const userIds = Object.keys(userActivity);
    const users = userIds.length > 0 ? 
      await User.query().whereIn('id', userIds).select('id', 'username', 'email', 'role', 'pharmacy_name') : [];
    
    const activityReport = users.map(user => {
      const activity = userActivity[user.id];
      const avgSatisfaction = activity.satisfaction_ratings.length > 0 ?
        activity.satisfaction_ratings.reduce((a, b) => a + b, 0) / activity.satisfaction_ratings.length : 0;
      
      return {
        user_id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        pharmacy_name: user.pharmacy_name,
        tickets_created: activity.tickets_created,
        tickets_resolved: activity.tickets_resolved,
        resolution_rate: activity.tickets_created > 0 ? 
          (activity.tickets_resolved / activity.tickets_created * 100).toFixed(1) : 0,
        total_comments: activity.total_comments,
        avg_satisfaction: Math.round(avgSatisfaction * 100) / 100,
        engagement_score: this.calculateEngagementScore(activity)
      };
    });

    return {
      title: 'User Activity Report',
      period: { start: startDate, end: endDate },
      user_activity: activityReport.sort((a, b) => b.tickets_created - a.tickets_created),
      summary: {
        total_active_users: activityReport.length,
        avg_tickets_per_user: activityReport.length > 0 ? 
          activityReport.reduce((sum, u) => sum + u.tickets_created, 0) / activityReport.length : 0,
        top_users: activityReport.slice(0, 5)
      },
      recordCount: activityReport.length
    };
  }

  /**
   * Get performance metrics data
   */
  async getPerformanceMetricsData(startDate, endDate, filters, requestingUser) {
    const tickets = await this.getFilteredTickets(startDate, endDate, filters, requestingUser);
    
    // Calculate detailed performance metrics
    const resolvedTickets = tickets.filter(t => t.resolved_at);
    const responseTimeTickets = tickets.filter(t => t.first_response_at);
    
    const resolutionTimes = resolvedTickets.map(t => 
      (new Date(t.resolved_at) - new Date(t.created_at)) / (1000 * 60 * 60)
    );
    
    const responseTimes = responseTimeTickets.map(t => 
      (new Date(t.first_response_at) - new Date(t.created_at)) / (1000 * 60 * 60)
    );

    const performanceByCategory = {};
    const performanceByUrgency = {};
    const performanceByAssignee = {};

    // Calculate category performance
    tickets.forEach(ticket => {
      if (!performanceByCategory[ticket.category]) {
        performanceByCategory[ticket.category] = {
          total: 0,
          resolved: 0,
          avg_resolution_time: 0,
          resolution_times: []
        };
      }
      
      performanceByCategory[ticket.category].total++;
      
      if (ticket.resolved_at) {
        performanceByCategory[ticket.category].resolved++;
        const resTime = (new Date(ticket.resolved_at) - new Date(ticket.created_at)) / (1000 * 60 * 60);
        performanceByCategory[ticket.category].resolution_times.push(resTime);
      }
    });

    // Calculate averages for categories
    Object.keys(performanceByCategory).forEach(category => {
      const categoryData = performanceByCategory[category];
      categoryData.resolution_rate = categoryData.total > 0 ? 
        (categoryData.resolved / categoryData.total * 100).toFixed(1) : 0;
      categoryData.avg_resolution_time = categoryData.resolution_times.length > 0 ?
        categoryData.resolution_times.reduce((a, b) => a + b, 0) / categoryData.resolution_times.length : 0;
      delete categoryData.resolution_times; // Remove raw data
    });

    return {
      title: 'Performance Metrics Report',
      period: { start: startDate, end: endDate },
      overall_metrics: {
        total_tickets: tickets.length,
        resolved_tickets: resolvedTickets.length,
        resolution_rate: tickets.length > 0 ? (resolvedTickets.length / tickets.length * 100).toFixed(1) : 0,
        avg_resolution_time: resolutionTimes.length > 0 ? 
          resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length : 0,
        median_resolution_time: this.calculateMedian(resolutionTimes),
        avg_first_response_time: responseTimes.length > 0 ? 
          responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0,
        sla_compliance: this.calculateSLACompliance(tickets)
      },
      performance_by_category: performanceByCategory,
      performance_trends: this.calculatePerformanceTrends(tickets),
      sla_analysis: this.calculateSLAAnalysis(tickets),
      recordCount: tickets.length
    };
  }

  /**
   * Get satisfaction analysis data
   */
  async getSatisfactionAnalysisData(startDate, endDate, filters, requestingUser) {
    const tickets = await this.getFilteredTickets(startDate, endDate, filters, requestingUser);
    const ratedTickets = tickets.filter(t => t.satisfaction_rating);
    
    if (ratedTickets.length === 0) {
      return {
        title: 'Customer Satisfaction Analysis',
        period: { start: startDate, end: endDate },
        message: 'No satisfaction ratings found for the selected period',
        recordCount: 0
      };
    }

    const satisfactionDistribution = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0
    };

    const satisfactionByCategory = {};
    const satisfactionByAssignee = {};
    const satisfactionComments = [];

    ratedTickets.forEach(ticket => {
      // Distribution
      satisfactionDistribution[ticket.satisfaction_rating]++;
      
      // By category
      if (!satisfactionByCategory[ticket.category]) {
        satisfactionByCategory[ticket.category] = {
          ratings: [],
          count: 0
        };
      }
      satisfactionByCategory[ticket.category].ratings.push(ticket.satisfaction_rating);
      satisfactionByCategory[ticket.category].count++;
      
      // By assignee
      if (ticket.assigned_to) {
        if (!satisfactionByAssignee[ticket.assigned_to]) {
          satisfactionByAssignee[ticket.assigned_to] = {
            ratings: [],
            count: 0
          };
        }
        satisfactionByAssignee[ticket.assigned_to].ratings.push(ticket.satisfaction_rating);
        satisfactionByAssignee[ticket.assigned_to].count++;
      }
      
      // Comments
      if (ticket.satisfaction_comment) {
        satisfactionComments.push({
          rating: ticket.satisfaction_rating,
          comment: ticket.satisfaction_comment,
          ticket_number: ticket.ticket_number,
          category: ticket.category
        });
      }
    });

    // Calculate averages
    Object.keys(satisfactionByCategory).forEach(category => {
      const ratings = satisfactionByCategory[category].ratings;
      satisfactionByCategory[category].average = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      satisfactionByCategory[category].average = Math.round(satisfactionByCategory[category].average * 100) / 100;
      delete satisfactionByCategory[category].ratings;
    });

    const avgSatisfaction = ratedTickets.reduce((sum, t) => sum + t.satisfaction_rating, 0) / ratedTickets.length;

    return {
      title: 'Customer Satisfaction Analysis',
      period: { start: startDate, end: endDate },
      overall_satisfaction: {
        average_rating: Math.round(avgSatisfaction * 100) / 100,
        total_ratings: ratedTickets.length,
        response_rate: tickets.length > 0 ? (ratedTickets.length / tickets.length * 100).toFixed(1) : 0
      },
      rating_distribution: satisfactionDistribution,
      satisfaction_by_category: satisfactionByCategory,
      satisfaction_trends: this.calculateSatisfactionTrends(ratedTickets),
      satisfaction_comments: satisfactionComments.slice(0, 50), // Limit comments
      insights: this.generateSatisfactionInsights(ratedTickets),
      recordCount: ratedTickets.length
    };
  }

  /**
   * Format report based on requested format
   */
  async formatReport(reportData, format, reportType) {
    switch (format) {
      case 'json':
        return {
          data: reportData,
          filename: `${reportType}_${Date.now()}.json`,
          mimeType: 'application/json'
        };
      
      case 'csv':
        return await this.formatCSVReport(reportData, reportType);
      
      case 'excel':
        return await this.formatExcelReport(reportData, reportType);
      
      case 'pdf':
        return await this.formatPDFReport(reportData, reportType);
      
      default:
        throw new Error(`Unsupported report format: ${format}`);
    }
  }

  /**
   * Format CSV report
   */
  async formatCSVReport(reportData, reportType) {
    try {
      let csvContent = '';
      const filename = `${reportType}_${Date.now()}.csv`;

      // Add header with report info
      csvContent += `TPG Support Report - ${reportData.title}\n`;
      csvContent += `Generated: ${new Date().toISOString()}\n`;
      csvContent += `Period: ${reportData.period.start} to ${reportData.period.end}\n\n`;

      // Format based on report type
      switch (reportType) {
        case 'detailed_tickets':
          csvContent += 'Ticket Number,Title,Category,Urgency,Status,Created,Resolved,Resolution Time (h),User,Assigned To,Satisfaction\n';
          reportData.tickets.forEach(ticket => {
            csvContent += `"${ticket.ticket_number}","${ticket.title}","${ticket.category}","${ticket.urgency}","${ticket.status}","${ticket.created_at}","${ticket.resolved_at || ''}","${ticket.resolution_time_hours || ''}","${ticket.user.username}","${ticket.assigned_user.username || ''}","${ticket.satisfaction_rating || ''}"\n`;
          });
          break;
        
        case 'user_activity':
          csvContent += 'Username,Email,Role,Pharmacy,Tickets Created,Tickets Resolved,Resolution Rate %,Comments,Avg Satisfaction,Engagement Score\n';
          reportData.user_activity.forEach(user => {
            csvContent += `"${user.username}","${user.email}","${user.role}","${user.pharmacy_name || ''}","${user.tickets_created}","${user.tickets_resolved}","${user.resolution_rate}","${user.total_comments}","${user.avg_satisfaction}","${user.engagement_score}"\n`;
          });
          break;
        
        default:
          // Generic format for other report types
          csvContent += 'Metric,Value\n';
          if (reportData.overview) {
            Object.entries(reportData.overview).forEach(([key, value]) => {
              csvContent += `"${key}","${value}"\n`;
            });
          }
      }

      return {
        data: Buffer.from(csvContent, 'utf8'),
        filename,
        mimeType: 'text/csv'
      };
    } catch (error) {
      logger.error('Error formatting CSV report:', error);
      throw new Error('Failed to format CSV report');
    }
  }

  /**
   * Format Excel report (stub implementation)
   */
  async formatExcelReport(reportData, reportType) {
    // This would use a library like ExcelJS to create Excel files
    // For now, return CSV format with Excel MIME type
    const csvReport = await this.formatCSVReport(reportData, reportType);
    
    return {
      data: csvReport.data,
      filename: csvReport.filename.replace('.csv', '.xlsx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
  }

  /**
   * Format PDF report (stub implementation)
   */
  async formatPDFReport(reportData, reportType) {
    // This would use a library like PDFKit or Puppeteer to create PDFs
    // For now, return a simple HTML representation
    const htmlContent = this.formatHTMLReport(reportData, reportType);
    
    return {
      data: Buffer.from(htmlContent, 'utf8'),
      filename: `${reportType}_${Date.now()}.html`,
      mimeType: 'text/html'
    };
  }

  /**
   * Format HTML report
   */
  formatHTMLReport(reportData, reportType) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${reportData.title}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          h1 { color: #2563eb; }
          h2 { color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
          th { background-color: #f3f4f6; }
          .metric { display: inline-block; margin: 10px; padding: 15px; background: #f8fafc; border-radius: 8px; }
        </style>
      </head>
      <body>
        <h1>${reportData.title}</h1>
        <p><strong>Period:</strong> ${reportData.period.start} to ${reportData.period.end}</p>
        <p><strong>Generated:</strong> ${new Date().toISOString()}</p>
        
        ${reportData.overview ? this.formatOverviewHTML(reportData.overview) : ''}
        ${reportData.summary ? this.formatSummaryHTML(reportData.summary) : ''}
        
        <h2>Report Details</h2>
        <pre>${JSON.stringify(reportData, null, 2)}</pre>
      </body>
      </html>
    `;
  }

  formatOverviewHTML(overview) {
    return `
      <h2>Overview</h2>
      <div>
        ${Object.entries(overview).map(([key, value]) => 
          `<div class="metric"><strong>${key.replace(/_/g, ' ')}:</strong> ${value}</div>`
        ).join('')}
      </div>
    `;
  }

  formatSummaryHTML(summary) {
    return `
      <h2>Summary</h2>
      <div>
        ${Object.entries(summary).map(([key, value]) => 
          `<div class="metric"><strong>${key.replace(/_/g, ' ')}:</strong> ${value}</div>`
        ).join('')}
      </div>
    `;
  }

  /**
   * Email report to recipients
   */
  async emailReport(reportData, metadata, recipients) {
    try {
      const subject = `TPG Report: ${metadata.type} - ${new Date().toLocaleDateString()}`;
      
      const emailContent = `
        <h2>TPG Support Report</h2>
        <p><strong>Report Type:</strong> ${metadata.type}</p>
        <p><strong>Period:</strong> ${metadata.period}</p>
        <p><strong>Generated:</strong> ${metadata.created_at}</p>
        <p><strong>Records:</strong> ${metadata.record_count}</p>
        
        <p>Please find the attached report. If you have any questions, please contact the support team.</p>
        
        <p>Best regards,<br>TPG Support Team</p>
      `;

      for (const recipient of recipients) {
        await emailService.sendEmail({
          to: recipient,
          subject,
          html: emailContent,
          attachments: [{
            filename: reportData.filename,
            content: reportData.data
          }]
        });
      }

      logger.info(`Report emailed to ${recipients.length} recipients`, {
        report_id: metadata.id,
        recipients: recipients.length
      });
    } catch (error) {
      logger.error('Error emailing report:', error);
    }
  }

  // Helper methods

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
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    return { startDate, endDate };
  }

  async getFilteredTickets(startDate, endDate, filters, requestingUser, options = {}) {
    let query = Ticket.query()
      .where('created_at', '>=', startDate)
      .where('created_at', '<=', endDate);

    // Apply user permissions
    if (requestingUser.role === 'user') {
      query = query.where('user_id', requestingUser.id);
    }

    // Apply filters
    if (filters.category) {
      query = query.where('category', filters.category);
    }
    if (filters.status) {
      query = query.where('status', filters.status);
    }
    if (filters.urgency) {
      query = query.where('urgency', filters.urgency);
    }
    if (filters.user_id) {
      query = query.where('user_id', filters.user_id);
    }
    if (filters.assigned_to) {
      query = query.where('assigned_to', filters.assigned_to);
    }

    // Apply graph fetching if specified
    if (options.withGraphFetched) {
      query = query.withGraphFetched(options.withGraphFetched);
    }

    return await query;
  }

  async getFilteredComments(startDate, endDate, filters, requestingUser) {
    let query = TicketComment.query()
      .where('created_at', '>=', startDate)
      .where('created_at', '<=', endDate);

    // Apply user permissions
    if (requestingUser.role === 'user') {
      query = query
        .joinRelated('ticket')
        .where('ticket.user_id', requestingUser.id);
    }

    return await query;
  }

  calculateOverviewMetrics(tickets) {
    const total = tickets.length;
    const resolved = tickets.filter(t => t.status === 'resolved').length;
    const closed = tickets.filter(t => t.status === 'closed').length;
    
    return {
      total_tickets: total,
      resolved_tickets: resolved,
      closed_tickets: closed,
      open_tickets: tickets.filter(t => t.status === 'open').length,
      in_progress_tickets: tickets.filter(t => t.status === 'in-progress').length,
      resolution_rate: total > 0 ? ((resolved + closed) / total * 100).toFixed(1) : 0,
      avg_resolution_time: this.calculateAverageResolutionTime(tickets),
      avg_satisfaction: this.calculateAverageSatisfaction(tickets)
    };
  }

  calculateAverageResolutionTime(tickets) {
    const resolvedTickets = tickets.filter(t => t.resolved_at);
    if (resolvedTickets.length === 0) return 0;

    const totalTime = resolvedTickets.reduce((sum, ticket) => {
      const resolutionTime = (new Date(ticket.resolved_at) - new Date(ticket.created_at)) / (1000 * 60 * 60);
      return sum + resolutionTime;
    }, 0);

    return Math.round(totalTime / resolvedTickets.length * 100) / 100;
  }

  calculateAverageSatisfaction(tickets) {
    const ratedTickets = tickets.filter(t => t.satisfaction_rating);
    if (ratedTickets.length === 0) return 0;

    const totalRating = ratedTickets.reduce((sum, ticket) => sum + ticket.satisfaction_rating, 0);
    return Math.round(totalRating / ratedTickets.length * 100) / 100;
  }

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

  calculateEngagementScore(activity) {
    // Simple engagement score calculation
    const baseScore = activity.tickets_created * 10;
    const commentBonus = activity.total_comments * 2;
    const resolutionBonus = activity.tickets_resolved * 5;
    
    return Math.min(100, baseScore + commentBonus + resolutionBonus);
  }

  // Cache management
  cacheReport(reportId, reportData) {
    this.reportCache.set(reportId, {
      data: reportData,
      timestamp: Date.now()
    });
  }

  getCachedReport(reportId) {
    const cached = this.reportCache.get(reportId);
    if (cached && (Date.now() - cached.timestamp) < (24 * 60 * 60 * 1000)) { // 24 hours
      return cached.data;
    }
    return null;
  }

  // Stub methods for additional calculations
  calculateCategoryBreakdown(tickets) {
    const breakdown = {};
    tickets.forEach(ticket => {
      breakdown[ticket.category] = (breakdown[ticket.category] || 0) + 1;
    });
    return breakdown;
  }

  calculateStatusDistribution(tickets) {
    const distribution = {};
    tickets.forEach(ticket => {
      distribution[ticket.status] = (distribution[ticket.status] || 0) + 1;
    });
    return distribution;
  }

  calculateUrgencyAnalysis(tickets) {
    const analysis = {};
    tickets.forEach(ticket => {
      analysis[ticket.urgency] = (analysis[ticket.urgency] || 0) + 1;
    });
    return analysis;
  }

  calculatePerformanceSummary(tickets) {
    return {
      total_tickets: tickets.length,
      avg_resolution_time: this.calculateAverageResolutionTime(tickets),
      sla_compliance: this.calculateSLACompliance(tickets)
    };
  }

  getTopIssues(tickets) {
    // Return top 5 categories by volume
    const categoryCount = {};
    tickets.forEach(ticket => {
      categoryCount[ticket.category] = (categoryCount[ticket.category] || 0) + 1;
    });
    
    return Object.entries(categoryCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));
  }

  generateRecommendations(tickets) {
    const recommendations = [];
    
    // Check for high volume categories
    const categoryCount = this.calculateCategoryBreakdown(tickets);
    const topCategory = Object.entries(categoryCount).sort(([,a], [,b]) => b - a)[0];
    
    if (topCategory && topCategory[1] > tickets.length * 0.3) {
      recommendations.push(`Consider reviewing processes for ${topCategory[0]} as it represents ${((topCategory[1] / tickets.length) * 100).toFixed(1)}% of all tickets`);
    }
    
    // Check resolution rate
    const resolutionRate = this.calculateOverviewMetrics(tickets).resolution_rate;
    if (resolutionRate < 80) {
      recommendations.push(`Current resolution rate of ${resolutionRate}% is below target. Consider reviewing ticket assignment and resolution processes`);
    }
    
    return recommendations;
  }

  calculatePerformanceTrends(tickets) {
    // Stub implementation for performance trends
    return {
      resolution_time_trend: 'stable',
      volume_trend: 'increasing'
    };
  }

  calculateSLAAnalysis(tickets) {
    // Stub implementation for SLA analysis
    return {
      overall_compliance: this.calculateSLACompliance(tickets),
      by_category: {}
    };
  }

  calculateSatisfactionTrends(ratedTickets) {
    // Stub implementation for satisfaction trends
    return {
      trend: 'stable',
      monthly_average: this.calculateAverageSatisfaction(ratedTickets)
    };
  }

  generateSatisfactionInsights(ratedTickets) {
    const insights = [];
    const avgRating = this.calculateAverageSatisfaction(ratedTickets);
    
    if (avgRating >= 4.0) {
      insights.push('Excellent customer satisfaction scores');
    } else if (avgRating >= 3.0) {
      insights.push('Good customer satisfaction with room for improvement');
    } else {
      insights.push('Customer satisfaction scores need attention');
    }
    
    return insights;
  }

  // Additional stub methods for other report types would be implemented here
  async getCategoryBreakdownData(startDate, endDate, filters, requestingUser) {
    const tickets = await this.getFilteredTickets(startDate, endDate, filters, requestingUser);
    return {
      title: 'Category Breakdown Report',
      period: { start: startDate, end: endDate },
      breakdown: this.calculateCategoryBreakdown(tickets),
      recordCount: tickets.length
    };
  }

  async getSLAComplianceData(startDate, endDate, filters, requestingUser) {
    const tickets = await this.getFilteredTickets(startDate, endDate, filters, requestingUser);
    return {
      title: 'SLA Compliance Report',
      period: { start: startDate, end: endDate },
      compliance: this.calculateSLACompliance(tickets),
      recordCount: tickets.length
    };
  }

  async getTrendAnalysisData(startDate, endDate, filters, requestingUser) {
    const tickets = await this.getFilteredTickets(startDate, endDate, filters, requestingUser);
    return {
      title: 'Trend Analysis Report',
      period: { start: startDate, end: endDate },
      trends: this.calculatePerformanceTrends(tickets),
      recordCount: tickets.length
    };
  }

  async getExecutiveSummaryData(startDate, endDate, filters, requestingUser) {
    const tickets = await this.getFilteredTickets(startDate, endDate, filters, requestingUser);
    return {
      title: 'Executive Summary Report',
      period: { start: startDate, end: endDate },
      summary: this.calculateOverviewMetrics(tickets),
      recordCount: tickets.length
    };
  }

  async getOperationalReportData(startDate, endDate, filters, requestingUser) {
    const tickets = await this.getFilteredTickets(startDate, endDate, filters, requestingUser);
    return {
      title: 'Operational Report',
      period: { start: startDate, end: endDate },
      operations: this.calculatePerformanceSummary(tickets),
      recordCount: tickets.length
    };
  }
}

module.exports = new ReportService();