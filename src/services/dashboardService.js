// src/services/dashboardService.js - TPG Dashboard Service
const Ticket = require('../models/Ticket');
const TicketComment = require('../models/TicketComment');
const TicketAttachment = require('../models/TicketAttachment');
const User = require('../models/User');
const analyticsService = require('./analyticsService');
const logger = require('../config/logger');

class DashboardService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 2 * 60 * 1000; // 2 minutes cache for dashboard
    }

    /**
     * Get comprehensive dashboard overview
     */
    async getDashboardOverview(options = {}) {
        try {
            const {
                period = '30d',
                userId,
                category,
                includeTrends = true,
                includeComparisons = true,
                requestingUser
            } = options;

            const cacheKey = `dashboard_${JSON.stringify({
                period,
                userId,
                category,
                requestingUserId: requestingUser.id
            })}`;
             const cached = this.getFromCache(cacheKey);
            if (cached) return cached;

            // Get date ranges
            const { startDate, endDate } = this.getDateRange(period);
            const { startDate: prevStartDate, endDate: prevEndDate } = this.getPreviousPeriodRange(period);

            // Build queries with user permissions
            let currentQuery = this.buildBaseQuery(startDate, endDate, { userId, category }, requestingUser);
            let previousQuery = includeComparisons ?
                this.buildBaseQuery(prevStartDate, prevEndDate, { userId, category }, requestingUser) : null;

            // Execute queries
            const [currentTickets, previousTickets] = await Promise.all([
                currentQuery.withGraphFetched('[user, assignedUser, comments, attachments]'),
                previousQuery ? previousQuery : Promise.resolve([])
            ]);

            // Build dashboard data
            const dashboard = {
                summary: this.buildSummaryCards(currentTickets, previousTickets),
                charts: await this.buildChartData(currentTickets, period),
                tables: await this.buildTableData(currentTickets),
                alerts: await this.generateAlerts(currentTickets),
                activity_feed: await this.getRecentActivity(requestingUser),
                performance_indicators: this.calculateKPIs(currentTickets, previousTickets)
            };

            if (includeTrends) {
                dashboard.trends = await this.calculateDashboardTrends(currentTickets, period);
            }

            if (includeComparisons && previousTickets.length > 0) {
                dashboard.comparisons = this.calculatePeriodComparisons(currentTickets, previousTickets);
            }

            // Cache the result
            this.setCache(cacheKey, dashboard);

            return dashboard;
        } catch (error) {
            logger.error('DashboardService.getDashboardOverview error:', error);
            throw error;
        }
    }

    /**
     * Build summary cards for dashboard
     */
    buildSummaryCards(currentTickets, previousTickets = []) {
        const current = this.calculateBasicMetrics(currentTickets);
        const previous = previousTickets.length > 0 ? this.calculateBasicMetrics(previousTickets) : null;

        return {
            total_tickets: {
                value: current.total,
                change: previous ? this.calculatePercentageChange(current.total, previous.total) : null,
                trend: previous ? (current.total > previous.total ? 'up' : 'down') : null,
                icon: 'tickets',
                color: 'blue'
            },
            open_tickets: {
                value: current.open,
                change: previous ? this.calculatePercentageChange(current.open, previous.open) : null,
                trend: previous ? (current.open > previous.open ? 'up' : 'down') : null,
                icon: 'alert-circle',
                color: 'orange'
            },
            resolved_tickets: {
                value: current.resolved,
                change: previous ? this.calculatePercentageChange(current.resolved, previous.resolved) : null,
                trend: previous ? (current.resolved > previous.resolved ? 'up' : 'down') : null,
                icon: 'check-circle',
                color: 'green'
            },
            avg_resolution_time: {
                value: current.avgResolutionTime,
                formatted_value: `${current.avgResolutionTime}h`,
                change: previous ? this.calculatePercentageChange(current.avgResolutionTime, previous.avgResolutionTime) : null,
                trend: previous ? (current.avgResolutionTime < previous.avgResolutionTime ? 'up' : 'down') : null,
                icon: 'clock',
                color: 'purple'
            },
            customer_satisfaction: {
                value: current.avgSatisfaction,
                formatted_value: `${current.avgSatisfaction}/5`,
                change: previous ? this.calculatePercentageChange(current.avgSatisfaction, previous.avgSatisfaction) : null,
                trend: previous ? (current.avgSatisfaction > previous.avgSatisfaction ? 'up' : 'down') : null,
                icon: 'star',
                color: 'yellow'
            },
            overdue_tickets: {
                value: current.overdue,
                change: previous ? this.calculatePercentageChange(current.overdue, previous.overdue) : null,
                trend: previous ? (current.overdue < previous.overdue ? 'up' : 'down') : null,
                icon: 'alert-triangle',
                color: 'red'
            }
        };
    }

    /**
     * Build chart data for dashboard
     */
    async buildChartData(tickets, period) {
        return {
            ticket_volume: this.buildVolumeChart(tickets, period),
            category_distribution: this.buildCategoryChart(tickets),
            status_breakdown: this.buildStatusChart(tickets),
            resolution_trend: this.buildResolutionTrendChart(tickets, period),
            urgency_distribution: this.buildUrgencyChart(tickets),
            satisfaction_trend: this.buildSatisfactionChart(tickets, period),
            performance_metrics: this.buildPerformanceChart(tickets),
            assignee_workload: await this.buildAssigneeWorkloadChart(tickets)
        };
    }

    /**
     * Build table data for dashboard
     */
    async buildTableData(tickets) {
        return {
            recent_tickets: this.getRecentTickets(tickets, 10),
            overdue_tickets: this.getOverdueTickets(tickets),
            top_categories: this.getTopCategories(tickets),
            active_users: await this.getActiveUsers(tickets),
            escalated_tickets: this.getEscalatedTickets(tickets)
        };
    }

    /**
     * Generate dashboard alerts
     */
    async generateAlerts(tickets) {
        const alerts = [];

        // Check for overdue tickets
        const overdueTickets = tickets.filter(t => this.isTicketOverdue(t));
        if (overdueTickets.length > 0) {
            alerts.push({
                type: 'warning',
                level: overdueTickets.length > 10 ? 'high' : 'medium',
                message: `${overdueTickets.length} ticket(s) are overdue`,
                action: 'view_overdue_tickets',
                count: overdueTickets.length
            });
        }

        // Check for high priority unassigned tickets
        const unassignedHighPriority = tickets.filter(t =>
            ['high', 'critical'].includes(t.urgency) && !t.assigned_to && t.status === 'open'
        );
        if (unassignedHighPriority.length > 0) {
            alerts.push({
                type: 'error',
                level: 'high',
                message: `${unassignedHighPriority.length} high priority ticket(s) unassigned`,
                action: 'assign_tickets',
                count: unassignedHighPriority.length
            });
        }

        // Check for low satisfaction scores
        const lowSatisfactionTickets = tickets.filter(t =>
            t.satisfaction_rating && t.satisfaction_rating <= 2
        );
        if (lowSatisfactionTickets.length > 0) {
            alerts.push({
                type: 'warning',
                level: 'medium',
                message: `${lowSatisfactionTickets.length} ticket(s) have low satisfaction ratings`,
                action: 'review_satisfaction',
                count: lowSatisfactionTickets.length
            });
        }

        // Check for stale tickets (no activity in 7 days)
        const staleTickets = await this.getStaleTickets(tickets);
        if (staleTickets.length > 0) {
            alerts.push({
                type: 'info',
                level: 'low',
                message: `${staleTickets.length} ticket(s) have no recent activity`,
                action: 'review_stale_tickets',
                count: staleTickets.length
            });
        }

        return alerts.sort((a, b) => {
            const levelOrder = { high: 3, medium: 2, low: 1 };
            return levelOrder[b.level] - levelOrder[a.level];
        });
    }

    /**
     * Get recent activity feed
     */
    async getRecentActivity(requestingUser, limit = 20) {
        try {
            const activities = [];

            // Get recent tickets
            let recentTicketsQuery = Ticket.query()
                .orderBy('created_at', 'desc')
                .limit(limit / 2)
                .withGraphFetched('[user]');

            // Apply user permissions
            if (requestingUser.role === 'user') {
                recentTicketsQuery = recentTicketsQuery.where('user_id', requestingUser.id);
            }

            const recentTickets = await recentTicketsQuery;

            recentTickets.forEach(ticket => {
                activities.push({
                    type: 'ticket_created',
                    timestamp: ticket.created_at,
                    title: `New ticket: ${ticket.title}`,
                    description: `${ticket.category} • ${ticket.urgency} priority`,
                    user: ticket.user,
                    ticket_id: ticket.id,
                    ticket_number: ticket.ticket_number
                });
            });

            // Get recent comments
            let recentCommentsQuery = TicketComment.query()
                .orderBy('created_at', 'desc')
                .limit(limit / 2)
                .withGraphFetched('[user, ticket]');

            // Apply user permissions for comments
            if (requestingUser.role === 'user') {
                recentCommentsQuery = recentCommentsQuery
                    .joinRelated('ticket')
                    .where('ticket.user_id', requestingUser.id);
            }

            const recentComments = await recentCommentsQuery;

            recentComments.forEach(comment => {
                if (!comment.is_internal || requestingUser.hasPermission('tickets.view.all')) {
                    activities.push({
                        type: 'comment_added',
                        timestamp: comment.created_at,
                        title: `Comment on ${comment.ticket.ticket_number}`,
                        description: comment.content.length > 100 ?
                            comment.content.substring(0, 100) + '...' : comment.content,
                        user: comment.user,
                        ticket_id: comment.ticket_id,
                        ticket_number: comment.ticket.ticket_number
                    });
                }
            });

            // Sort by timestamp and limit
            return activities
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, limit);
        } catch (error) {
            logger.error('Error getting recent activity:', error);
            return [];
        }
    }

    /**
     * Calculate Key Performance Indicators
     */
    calculateKPIs(currentTickets, previousTickets = []) {
        const current = this.calculateBasicMetrics(currentTickets);
        const previous = previousTickets.length > 0 ? this.calculateBasicMetrics(previousTickets) : null;

        return {
            resolution_rate: {
                value: current.total > 0 ? (current.resolved / current.total * 100).toFixed(1) : 0,
                target: 85, // 85% target resolution rate
                status: current.total > 0 ? (current.resolved / current.total * 100 >= 85 ? 'good' : 'poor') : 'neutral'
            },
            first_response_time: {
                value: current.avgFirstResponseTime,
                target: 4, // 4 hours target
                status: current.avgFirstResponseTime <= 4 ? 'good' : 'poor'
            },
            sla_compliance: {
                value: this.calculateSLACompliance(currentTickets),
                target: 90, // 90% SLA compliance target
                status: this.calculateSLACompliance(currentTickets) >= 90 ? 'good' : 'poor'
            },
            customer_satisfaction: {
                value: current.avgSatisfaction,
                target: 4.0, // 4.0/5 target satisfaction
                status: current.avgSatisfaction >= 4.0 ? 'good' : current.avgSatisfaction >= 3.0 ? 'fair' : 'poor'
            }
        };
    }

    /**
     * Build volume chart data
     */
    buildVolumeChart(tickets, period) {
        const timeGranularity = this.getTimeGranularity(period);
        const { startDate, endDate } = this.getDateRange(period);

        const chartData = [];
        const current = new Date(startDate);

        while (current <= endDate) {
            const periodStart = new Date(current);
            const periodEnd = new Date(current);

            // Set period end based on granularity
            switch (timeGranularity) {
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

            // Count tickets in this period
            const periodTickets = tickets.filter(t => {
                const ticketDate = new Date(t.created_at);
                return ticketDate >= periodStart && ticketDate < periodEnd;
            });

            const resolvedInPeriod = tickets.filter(t => {
                if (!t.resolved_at) return false;
                const resolvedDate = new Date(t.resolved_at);
                return resolvedDate >= periodStart && resolvedDate < periodEnd;
            });

            chartData.push({
                period: periodStart.toISOString(),
                created: periodTickets.length,
                resolved: resolvedInPeriod.length,
                net: periodTickets.length - resolvedInPeriod.length
            });

            // Move to next period
            switch (timeGranularity) {
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

        return {
            type: 'line',
            data: chartData,
            config: {
                x_axis: 'period',
                y_axes: ['created', 'resolved'],
                colors: {
                    created: '#3b82f6',
                    resolved: '#10b981'
                }
            }
        };
    }

    /**
     * Build category distribution chart
     */
    buildCategoryChart(tickets) {
        const categories = {};
        tickets.forEach(ticket => {
            categories[ticket.category] = (categories[ticket.category] || 0) + 1;
        });

        const data = Object.entries(categories).map(([category, count]) => ({
            category: this.formatCategoryName(category),
            count,
            percentage: tickets.length > 0 ? (count / tickets.length * 100).toFixed(1) : 0
        }));

        return {
            type: 'pie',
            data: data.sort((a, b) => b.count - a.count),
            config: {
                value_field: 'count',
                label_field: 'category',
                colors: this.getCategoryColors()
            }
        };
    }

    /**
     * Build status breakdown chart
     */
    buildStatusChart(tickets) {
        const statuses = {
            open: 0,
            'in-progress': 0,
            resolved: 0,
            closed: 0
        };

        tickets.forEach(ticket => {
            statuses[ticket.status] = (statuses[ticket.status] || 0) + 1;
        });

        const data = Object.entries(statuses).map(([status, count]) => ({
            status: this.formatStatusName(status),
            count,
            percentage: tickets.length > 0 ? (count / tickets.length * 100).toFixed(1) : 0
        }));

        return {
            type: 'donut',
            data,
            config: {
                value_field: 'count',
                label_field: 'status',
                colors: {
                    'Open': '#f59e0b',
                    'In Progress': '#3b82f6',
                    'Resolved': '#10b981',
                    'Closed': '#6b7280'
                }
            }
        };
    }

    /**
     * Build assignee workload chart
     */
    async buildAssigneeWorkloadChart(tickets) {
        const assigneeWorkload = {};

        // Get all assignees
        const assigneeIds = [...new Set(tickets.map(t => t.assigned_to).filter(Boolean))];
        const assignees = assigneeIds.length > 0 ?
            await User.query().whereIn('id', assigneeIds).select('id', 'username') : [];

        // Calculate workload
        assignees.forEach(assignee => {
            const assignedTickets = tickets.filter(t => t.assigned_to === assignee.id);
            const openTickets = assignedTickets.filter(t => ['open', 'in-progress'].includes(t.status));

            assigneeWorkload[assignee.username] = {
                total: assignedTickets.length,
                open: openTickets.length,
                resolved: assignedTickets.filter(t => t.status === 'resolved').length,
                avg_resolution_time: this.calculateAverageResolutionTime(assignedTickets.filter(t => t.resolved_at))
            };
        });

        const data = Object.entries(assigneeWorkload).map(([username, metrics]) => ({
            assignee: username,
            ...metrics
        }));

        return {
            type: 'bar',
            data: data.sort((a, b) => b.total - a.total),
            config: {
                x_axis: 'assignee',
                y_axes: ['total', 'open', 'resolved'],
                colors: {
                    total: '#6b7280',
                    open: '#f59e0b',
                    resolved: '#10b981'
                }
            }
        };
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
            default:
                startDate.setDate(endDate.getDate() - 30);
        }

        return { startDate, endDate };
    }

    getPreviousPeriodRange(period) {
        const { startDate, endDate } = this.getDateRange(period);
        const periodLength = endDate - startDate;

        const prevEndDate = new Date(startDate);
        const prevStartDate = new Date(prevEndDate.getTime() - periodLength);

        return { startDate: prevStartDate, endDate: prevEndDate };
    }

    buildBaseQuery(startDate, endDate, filters, requestingUser) {
        let query = Ticket.query()
            .where('created_at', '>=', startDate)
            .where('created_at', '<=', endDate);

        // Apply user permissions
        if (requestingUser.role === 'user') {
            query = query.where('user_id', requestingUser.id);
        }

        // Apply filters
        if (filters.userId) {
            query = query.where('user_id', filters.userId);
        }

        if (filters.category) {
            query = query.where('category', filters.category);
        }

        return query;
    }

    calculateBasicMetrics(tickets) {
        const total = tickets.length;
        const resolved = tickets.filter(t => t.status === 'resolved').length;
        const open = tickets.filter(t => t.status === 'open').length;
        const overdue = tickets.filter(t => this.isTicketOverdue(t)).length;

        // Calculate average resolution time
        const resolvedTickets = tickets.filter(t => t.resolved_at);
        const avgResolutionTime = resolvedTickets.length > 0 ?
            resolvedTickets.reduce((sum, ticket) => {
                return sum + ((new Date(ticket.resolved_at) - new Date(ticket.created_at)) / (1000 * 60 * 60));
            }, 0) / resolvedTickets.length : 0;

        // Calculate average satisfaction
        const ratedTickets = tickets.filter(t => t.satisfaction_rating);
        const avgSatisfaction = ratedTickets.length > 0 ?
            ratedTickets.reduce((sum, ticket) => sum + ticket.satisfaction_rating, 0) / ratedTickets.length : 0;

        // Calculate average first response time
        const responseTickets = tickets.filter(t => t.first_response_at);
        const avgFirstResponseTime = responseTickets.length > 0 ?
            responseTickets.reduce((sum, ticket) => {
                return sum + ((new Date(ticket.first_response_at) - new Date(ticket.created_at)) / (1000 * 60 * 60));
            }, 0) / responseTickets.length : 0;

        return {
            total,
            resolved,
            open,
            overdue,
            avgResolutionTime: Math.round(avgResolutionTime * 100) / 100,
            avgSatisfaction: Math.round(avgSatisfaction * 100) / 100,
            avgFirstResponseTime: Math.round(avgFirstResponseTime * 100) / 100
        };
    }

    calculatePercentageChange(current, previous) {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
    }

    getTimeGranularity(period) {
        switch (period) {
            case '1d':
                return 'hour';
            case '7d':
                return 'day';
            case '30d':
                return 'day';
            case '90d':
                return 'week';
            default:
                return 'day';
        }
    }

    formatCategoryName(category) {
        return category.split('-').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    formatStatusName(status) {
        return status.split('-').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    getCategoryColors() {
        return {
            'CPD Points': '#3b82f6',
            'License Management': '#10b981',
            'Performance Issues': '#f59e0b',
            'Payment Gateway': '#ef4444',
            'User Interface': '#8b5cf6',
            'Data Inconsistencies': '#f97316',
            'System Errors': '#dc2626'
        };
    }

    isTicketOverdue(ticket) {
        if (!ticket.estimated_resolution_hours || ['resolved', 'closed'].includes(ticket.status)) {
            return false;
        }

        const createdAt = new Date(ticket.created_at);
        const expectedResolution = new Date(createdAt.getTime() + (ticket.estimated_resolution_hours * 60 * 60 * 1000));
        return new Date() > expectedResolution;
    }

    calculateAverageResolutionTime(tickets) {
        if (tickets.length === 0) return 0;

        const totalTime = tickets.reduce((sum, ticket) => {
            const resolutionTime = (new Date(ticket.resolved_at) - new Date(ticket.created_at)) / (1000 * 60 * 60);
            return sum + resolutionTime;
        }, 0);

        return Math.round(totalTime / tickets.length * 100) / 100;
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

    async getStaleTickets(tickets) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const staleTickets = [];

        for (const ticket of tickets) {
            if (['resolved', 'closed'].includes(ticket.status)) continue;

            // Check if there's been any recent activity
            const recentComments = await TicketComment.query()
                .where('ticket_id', ticket.id)
                .where('created_at', '>', sevenDaysAgo.toISOString())
                .limit(1);

            if (recentComments.length === 0 && new Date(ticket.updated_at) < sevenDaysAgo) {
                staleTickets.push(ticket);
            }
        }

        return staleTickets;
    }

    getRecentTickets(tickets, limit = 10) {
        return tickets
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, limit)
            .map(ticket => ({
                id: ticket.id,
                ticket_number: ticket.ticket_number,
                title: ticket.title,
                category: ticket.category,
                urgency: ticket.urgency,
                status: ticket.status,
                created_at: ticket.created_at,
                user: ticket.user ? {
                    id: ticket.user.id,
                    username: ticket.user.username,
                    email: ticket.user.email
                } : null
            }));
    }

    getOverdueTickets(tickets) {
        return tickets
            .filter(t => this.isTicketOverdue(t))
            .sort((a, b) => {
                const overdueA = (new Date() - new Date(a.created_at)) - (a.estimated_resolution_hours * 60 * 60 * 1000);
                const overdueB = (new Date() - new Date(b.created_at)) - (b.estimated_resolution_hours * 60 * 60 * 1000);
                return overdueB - overdueA;
            })
            .map(ticket => ({
                id: ticket.id,
                ticket_number: ticket.ticket_number,
                title: ticket.title,
                urgency: ticket.urgency,
                created_at: ticket.created_at,
                estimated_resolution_hours: ticket.estimated_resolution_hours,
                overdue_hours: Math.round(((new Date() - new Date(ticket.created_at)) / (1000 * 60 * 60)) - ticket.estimated_resolution_hours)
            }));
    }

    getTopCategories(tickets) {
        const categories = {};
        tickets.forEach(ticket => {
            categories[ticket.category] = (categories[ticket.category] || 0) + 1;
        });

        return Object.entries(categories)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([category, count]) => ({
                category: this.formatCategoryName(category),
                count,
                percentage: tickets.length > 0 ? (count / tickets.length * 100).toFixed(1) : 0
            }));
    }

    async getActiveUsers(tickets) {
        const userActivity = {};

        tickets.forEach(ticket => {
            if (!userActivity[ticket.user_id]) {
                userActivity[ticket.user_id] = {
                    tickets_created: 0,
                    tickets_resolved: 0,
                    avg_satisfaction: 0
                };
            }

            userActivity[ticket.user_id].tickets_created++;
            if (ticket.status === 'resolved') {
                userActivity[ticket.user_id].tickets_resolved++;
            }
        });

        // Get user details
        const userIds = Object.keys(userActivity);
        const users = userIds.length > 0 ?
            await User.query().whereIn('id', userIds).select('id', 'username', 'email') : [];

        return users.map(user => ({
            ...user,
            activity: userActivity[user.id]
        })).sort((a, b) => b.activity.tickets_created - a.activity.tickets_created).slice(0, 10);
    }

    getEscalatedTickets(tickets) {
        return tickets
            .filter(t => ['high', 'critical'].includes(t.urgency) && t.status !== 'resolved')
            .sort((a, b) => {
                const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                return urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
            })
            .slice(0, 10)
            .map(ticket => ({
                id: ticket.id,
                ticket_number: ticket.ticket_number,
                title: ticket.title,
                urgency: ticket.urgency,
                category: ticket.category,
                created_at: ticket.created_at,
                assigned_to: ticket.assignedUser ? ticket.assignedUser.username : 'Unassigned'
            }));
    }

    // Cache management
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

    // Additional helper methods for trends and comparisons would be implemented here
    async calculateDashboardTrends(tickets, period) {
        // Implementation for dashboard trends
        return {
            ticket_volume_trend: 'increasing',
            resolution_rate_trend: 'stable',
            satisfaction_trend: 'improving'
        };
    }

    calculatePeriodComparisons(current, previous) {
        const currentMetrics = this.calculateBasicMetrics(current);
        const previousMetrics = this.calculateBasicMetrics(previous);

        return {
            tickets_change: this.calculatePercentageChange(currentMetrics.total, previousMetrics.total),
            resolution_rate_change: this.calculatePercentageChange(
                currentMetrics.resolved / currentMetrics.total * 100,
                previousMetrics.resolved / previousMetrics.total * 100
            ),
            satisfaction_change: this.calculatePercentageChange(currentMetrics.avgSatisfaction, previousMetrics.avgSatisfaction)
        };
    }
}

module.exports = new DashboardService();