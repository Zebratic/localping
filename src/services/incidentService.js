const chalk = require('../utils/colors');

class IncidentService {
  constructor(db) {
    this.db = db;
  }

  async createIncident(data) {
    try {
      const incident = {
        title: data.title,
        description: data.description,
        status: data.status || 'investigating', // investigating, identified, monitoring, resolved
        severity: data.severity || 'major', // minor, major, critical
        affectedServices: data.affectedServices || [],
        updates: [
          {
            message: data.description,
            timestamp: new Date(),
            status: data.status || 'investigating'
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: data.status === 'resolved' ? new Date() : null
      };

      const result = await this.db.collection('incidents').insertOne(incident);
      return { success: true, incidentId: result.insertedId, incident: { ...incident, _id: result.insertedId } };
    } catch (error) {
      console.error(chalk.red('Error creating incident:'), error.message);
      throw error;
    }
  }

  async getIncidents(filters = {}) {
    try {
      const query = {};
      if (filters.status) query.status = filters.status;
      if (filters.severity) query.severity = filters.severity;

      const incidents = await this.db
        .collection('incidents')
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      return incidents;
    } catch (error) {
      console.error(chalk.red('Error fetching incidents:'), error.message);
      throw error;
    }
  }

  async getIncidentById(incidentId) {
    try {
      const incident = await this.db
        .collection('incidents')
        .findOne({ _id: incidentId });

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

      updateData.updatedAt = new Date();
      if (data.status === 'resolved') {
        updateData.resolvedAt = new Date();
      }

      // Add update to the updates array
      if (data.updateMessage) {
        await this.db.collection('incidents').updateOne(
          { _id: incidentId },
          {
            $push: {
              updates: {
                message: data.updateMessage,
                timestamp: new Date(),
                status: data.status || 'update'
              }
            }
          }
        );
      }

      const result = await this.db
        .collection('incidents')
        .updateOne({ _id: incidentId }, { $set: updateData });

      return result.modifiedCount > 0;
    } catch (error) {
      console.error(chalk.red('Error updating incident:'), error.message);
      throw error;
    }
  }

  async deleteIncident(incidentId) {
    try {
      const result = await this.db
        .collection('incidents')
        .deleteOne({ _id: incidentId });

      return result.deletedCount > 0;
    } catch (error) {
      console.error(chalk.red('Error deleting incident:'), error.message);
      throw error;
    }
  }

  async getPublicIncidents() {
    try {
      // Return active incidents for the public status page
      const incidents = await this.db
        .collection('incidents')
        .find({ status: { $ne: 'resolved' } })
        .sort({ createdAt: -1 })
        .toArray();

      return incidents;
    } catch (error) {
      console.error(chalk.red('Error fetching public incidents:'), error.message);
      throw error;
    }
  }
}

module.exports = IncidentService;
