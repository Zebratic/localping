const chalk = require('../utils/colors');

class IncidentService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async createIncident(data) {
    try {
      const incident = await this.prisma.incident.create({
        data: {
          title: data.title,
          description: data.description,
          status: data.status || 'investigating', // investigating, identified, monitoring, resolved
          severity: data.severity || 'major', // minor, major, critical
          affectedServices: data.affectedServices || [],
          updates: [
            {
              message: data.description,
              timestamp: new Date().toISOString(),
              status: data.status || 'investigating',
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
}

module.exports = IncidentService;
