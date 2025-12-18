const chalk = require('../utils/colors');

class IncidentService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async createIncident(data) {
    try {
      // Ensure isScheduled is a boolean, not a string or date
      const isScheduled = (data.isScheduled === true || data.isScheduled === 'true') && data.scheduledStart;
      const initialStatus = isScheduled && new Date(data.scheduledStart) > new Date() 
        ? 'scheduled' 
        : (data.status || 'investigating');

      const incident = await this.prisma.incident.create({
        data: {
          title: data.title,
          description: data.description,
          status: initialStatus, // investigating, identified, monitoring, resolved, scheduled
          severity: data.severity || 'major', // minor, major, critical
          affectedServices: data.affectedServices || [],
          isScheduled: Boolean(isScheduled),
          scheduledStart: data.scheduledStart ? new Date(data.scheduledStart) : null,
          scheduledEnd: data.scheduledEnd ? new Date(data.scheduledEnd) : null,
          updates: [
            {
              message: data.description,
              timestamp: new Date().toISOString(),
              status: initialStatus,
            },
          ],
          resolvedAt: data.status === 'resolved' ? new Date() : null,
        },
      });

      // Send external notifications (non-blocking)
      setImmediate(async () => {
        try {
          const notificationService = require('./notificationService');
          await notificationService.notifyIncident(incident, false);
        } catch (error) {
          // Silently fail - notifications are not critical
          if (process.env.NODE_ENV === 'development') {
            console.error(chalk.yellow('Notification error for incident:'), error.message);
          }
        }
      });

      return { success: true, incidentId: incident.id, incident };
    } catch (error) {
      console.error(chalk.red('Error creating incident:'), error.message);
      throw error;
    }
  }

  async getIncidents(filters = {}) {
    try {
      const where = {};
      if (filters.status) where.status = filters.status;
      if (filters.severity) where.severity = filters.severity;

      const incidents = await this.prisma.incident.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      return incidents;
    } catch (error) {
      console.error(chalk.red('Error fetching incidents:'), error.message);
      throw error;
    }
  }

  async getIncidentById(incidentId) {
    try {
      const incident = await this.prisma.incident.findUnique({
        where: { id: incidentId },
      });

      return incident;
    } catch (error) {
      console.error(chalk.red('Error fetching incident:'), error.message);
      throw error;
    }
  }

  async updateIncident(incidentId, data) {
    try {
      const updateData = {};

      if (data.title !== undefined) updateData.title = data.title;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.severity !== undefined) updateData.severity = data.severity;
      if (data.affectedServices !== undefined) updateData.affectedServices = data.affectedServices;
      if (data.isScheduled !== undefined) updateData.isScheduled = Boolean(data.isScheduled === true || data.isScheduled === 'true');
      if (data.scheduledStart !== undefined) updateData.scheduledStart = data.scheduledStart ? new Date(data.scheduledStart) : null;
      if (data.scheduledEnd !== undefined) updateData.scheduledEnd = data.scheduledEnd ? new Date(data.scheduledEnd) : null;

      if (data.status === 'resolved') {
        updateData.resolvedAt = new Date();
      }

      // Add update to the updates array
      if (data.updateMessage) {
        const existingIncident = await this.prisma.incident.findUnique({
          where: { id: incidentId },
        });

        if (existingIncident) {
          const updates = existingIncident.updates || [];
          updates.push({
            message: data.updateMessage,
            timestamp: new Date().toISOString(),
            status: data.status || 'update',
          });
          updateData.updates = updates;
        }
      }

      const result = await this.prisma.incident.update({
        where: { id: incidentId },
        data: updateData,
      });

      if (result) {
        // Send external notifications (non-blocking)
        setImmediate(async () => {
          try {
            const updatedIncident = await this.getIncidentById(incidentId);
            if (updatedIncident) {
              const notificationService = require('./notificationService');
              await notificationService.notifyIncident(updatedIncident, true);
            }
          } catch (error) {
            // Silently fail - notifications are not critical
            if (process.env.NODE_ENV === 'development') {
              console.error(chalk.yellow('Notification error for incident update:'), error.message);
            }
          }
        });
      }

      return true;
    } catch (error) {
      if (error.code === 'P2025') {
        // Record not found
        return false;
      }
      console.error(chalk.red('Error updating incident:'), error.message);
      throw error;
    }
  }

  async deleteIncident(incidentId) {
    try {
      await this.prisma.incident.delete({
        where: { id: incidentId },
      });
      return true;
    } catch (error) {
      if (error.code === 'P2025') {
        // Record not found
        return false;
      }
      console.error(chalk.red('Error deleting incident:'), error.message);
      throw error;
    }
  }

  async getPublicIncidents() {
    try {
      // Return active incidents for the public status page
      const incidents = await this.prisma.incident.findMany({
        where: { status: { not: 'resolved' } },
        orderBy: { createdAt: 'desc' },
      });

      return incidents;
    } catch (error) {
      console.error(chalk.red('Error fetching public incidents:'), error.message);
      throw error;
    }
  }

  /**
   * Process scheduled incidents - activate them when start time arrives, resolve when end time passes
   */
  async processScheduledIncidents() {
    try {
      const now = new Date();
      
      // Find scheduled incidents that need to be activated (start time has passed, status is still 'scheduled')
      const scheduledToActivate = await this.prisma.incident.findMany({
        where: {
          isScheduled: true,
          status: 'scheduled',
          scheduledStart: { lte: now },
        },
      });

      for (const incident of scheduledToActivate) {
        // Activate the incident
        await this.prisma.incident.update({
          where: { id: incident.id },
          data: {
            status: 'investigating',
            updates: [
              ...(incident.updates || []),
              {
                message: 'Scheduled maintenance window has started',
                timestamp: now.toISOString(),
                status: 'investigating',
              },
            ],
          },
        });
        console.log(chalk.green(`✓ Activated scheduled incident: ${incident.title}`));
      }

      // Find active scheduled incidents that should be resolved (end time has passed)
      const scheduledToResolve = await this.prisma.incident.findMany({
        where: {
          isScheduled: true,
          status: { not: 'resolved' },
          scheduledEnd: { lte: now },
        },
      });

      for (const incident of scheduledToResolve) {
        // Resolve the incident
        await this.prisma.incident.update({
          where: { id: incident.id },
          data: {
            status: 'resolved',
            resolvedAt: now,
            updates: [
              ...(incident.updates || []),
              {
                message: 'Scheduled maintenance window has ended',
                timestamp: now.toISOString(),
                status: 'resolved',
              },
            ],
          },
        });
        console.log(chalk.green(`✓ Resolved scheduled incident: ${incident.title}`));
      }

      return {
        activated: scheduledToActivate.length,
        resolved: scheduledToResolve.length,
      };
    } catch (error) {
      console.error(chalk.red('Error processing scheduled incidents:'), error.message);
      throw error;
    }
  }
}

module.exports = IncidentService;
