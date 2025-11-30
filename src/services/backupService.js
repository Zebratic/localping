const { getPrisma } = require('../config/prisma');
const path = require('path');
const fs = require('fs');

/**
 * Export data from the database
 * @param {Object} options - Export options
 * @param {boolean} options.full - Export everything
 * @param {boolean} options.monitors - Export monitors (targets)
 * @param {boolean} options.incidents - Export incidents
 * @param {boolean} options.posts - Export blog posts
 * @param {boolean} options.dataPoints - Export ping results and statistics
 * @param {boolean} options.actions - Export actions
 * @param {boolean} options.alerts - Export alerts
 * @param {boolean} options.settings - Export admin and public UI settings
 * @param {boolean} options.favicons - Export favicons
 * @returns {Promise<Object>} Exported data
 */
async function exportData(options = {}) {
  const prisma = getPrisma();
  const exportResult = {
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    data: {}
  };

  // If full export, set all options to true
  if (options.full) {
    options.monitors = true;
    options.incidents = true;
    options.posts = true;
    options.dataPoints = true;
    options.actions = true;
    options.alerts = true;
    options.settings = true;
    options.favicons = true;
  }

  // Export monitors (targets)
  if (options.monitors) {
    const targets = await prisma.target.findMany();
    // Map id to _id for compatibility
    exportResult.data.targets = targets.map(target => ({
      ...target,
      _id: target.id,
    }));
  }

  // Export incidents
  if (options.incidents) {
    const incidents = await prisma.incident.findMany();
    exportResult.data.incidents = incidents.map(inc => ({ ...inc, _id: inc.id }));
  }

  // Export posts
  if (options.posts) {
    const posts = await prisma.post.findMany();
    exportResult.data.posts = posts.map(post => ({ ...post, _id: post.id }));
  }

  // Export data points (ping results and statistics)
  if (options.dataPoints) {
    const pingResults = await prisma.pingResult.findMany();
    const statistics = await prisma.statistic.findMany();

    // Map id to _id for compatibility
    exportResult.data.pingResults = pingResults.map(pr => ({ ...pr, _id: pr.id }));
    exportResult.data.statistics = statistics.map(s => ({ ...s, _id: s.id }));

    // Legacy format names for compatibility
    exportResult.data.ping_results = exportResult.data.pingResults;
    exportResult.data.daily_stats = exportResult.data.statistics;
  }

  // Export actions
  if (options.actions) {
    const actions = await prisma.action.findMany();
    exportResult.data.actions = actions.map(a => ({ ...a, _id: a.id }));
  }

  // Export alerts
  if (options.alerts) {
    const alerts = await prisma.alert.findMany();
    exportResult.data.alerts = alerts.map(a => ({ ...a, _id: a.id }));
  }

  // Export settings
  if (options.settings) {
    const adminSettings = await prisma.adminSettings.findUnique({ where: { id: 'settings' } });
    const publicUISettings = await prisma.publicUISettings.findUnique({ where: { id: 'settings' } });
    exportResult.data.adminSettings = adminSettings ? { ...adminSettings, _id: adminSettings.id } : null;
    exportResult.data.publicUISettings = publicUISettings ? { ...publicUISettings, _id: publicUISettings.id } : null;
  }

  // Export favicons
  if (options.favicons) {
    const favicons = await prisma.favicon.findMany();
    exportResult.data.favicons = favicons.map(f => ({ ...f, _id: f.id }));
  }

  return exportResult;
}

/**
 * Import data into the database
 * @param {Object} importData - Data to import
 * @param {Object} options - Import options
 * @param {boolean} options.overwrite - Overwrite existing data
 * @returns {Promise<Object>} Import result
 */
async function importData(importDataObj, options = {}) {
  const prisma = getPrisma();
  const results = {
    imported: {},
    errors: []
  };

  try {
    // Validate import data structure
    if (!importDataObj.data || typeof importDataObj.data !== 'object') {
      throw new Error('Invalid import data format');
    }

    // Import targets (monitors)
    if (importDataObj.data.targets && Array.isArray(importDataObj.data.targets)) {
      try {
        let imported = 0;
        let updated = 0;
        let skipped = 0;
        for (const target of importDataObj.data.targets) {
          try {
            const targetId = target.id || target._id;
            // Check if target exists by id
            const existingById = await prisma.target.findUnique({ where: { id: targetId } });
            if (existingById) {
              if (options.overwrite) {
                const { id, _id, ...updateData } = target;
                await prisma.target.update({
                  where: { id: targetId },
                  data: updateData,
                });
                updated++;
              } else {
                skipped++;
              }
            } else {
              // Check if target with same name exists (UNIQUE constraint on name)
              const existingByName = await prisma.target.findUnique({ where: { name: target.name } });
              if (existingByName) {
                if (options.overwrite) {
                  const { id, _id, ...updateData } = target;
                  await prisma.target.update({
                    where: { id: existingByName.id },
                    data: updateData,
                  });
                  updated++;
                } else {
                  skipped++;
                }
              } else {
                const { _id, ...insertData } = target;
                await prisma.target.create({
                  data: {
                    id: targetId,
                    ...insertData,
                  },
                });
                imported++;
              }
            }
          } catch (error) {
            // Handle individual target errors (e.g., UNIQUE constraint)
            if (error.code === 'P2002') {
              skipped++;
            } else {
              throw error;
            }
          }
        }
        results.imported.targets = { imported, updated, skipped };
      } catch (error) {
        results.errors.push({ type: 'targets', error: error.message });
      }
    }

    // Import incidents
    if (importDataObj.data.incidents && Array.isArray(importDataObj.data.incidents)) {
      try {
        let imported = 0;
        let updated = 0;
        for (const incident of importDataObj.data.incidents) {
          const incidentId = incident.id || incident._id;
          const existing = await prisma.incident.findUnique({ where: { id: incidentId } });
          if (existing) {
            if (options.overwrite) {
              const { id, _id, ...updateData } = incident;
              await prisma.incident.update({ where: { id: incidentId }, data: updateData });
              updated++;
            }
          } else {
            const { _id, ...insertData } = incident;
            await prisma.incident.create({ data: { id: incidentId, ...insertData } });
            imported++;
          }
        }
        results.imported.incidents = { imported, updated };
      } catch (error) {
        results.errors.push({ type: 'incidents', error: error.message });
      }
    }

    // Import posts
    if (importDataObj.data.posts && Array.isArray(importDataObj.data.posts)) {
      try {
        let imported = 0;
        let updated = 0;
        for (const post of importDataObj.data.posts) {
          const postId = post.id || post._id;
          const existing = await prisma.post.findUnique({ where: { id: postId } });
          if (existing) {
            if (options.overwrite) {
              const { id, _id, ...updateData } = post;
              await prisma.post.update({ where: { id: postId }, data: updateData });
              updated++;
            }
          } else {
            const { _id, ...insertData } = post;
            await prisma.post.create({ data: { id: postId, ...insertData } });
            imported++;
          }
        }
        results.imported.posts = { imported, updated };
      } catch (error) {
        results.errors.push({ type: 'posts', error: error.message });
      }
    }

    // Import data points
    if (importDataObj.data.pingResults && Array.isArray(importDataObj.data.pingResults)) {
      try {
        let imported = 0;
        for (const pingResult of importDataObj.data.pingResults) {
          const pingResultId = pingResult.id || pingResult._id;
          const existing = await prisma.pingResult.findUnique({ where: { id: pingResultId } });
          if (!existing) {
            const { _id, ...insertData } = pingResult;
            await prisma.pingResult.create({ data: { id: pingResultId, ...insertData } });
            imported++;
          }
        }
        results.imported.pingResults = { imported };
      } catch (error) {
        results.errors.push({ type: 'pingResults', error: error.message });
      }
    }

    if (importDataObj.data.statistics && Array.isArray(importDataObj.data.statistics)) {
      try {
        let imported = 0;
        for (const stat of importDataObj.data.statistics) {
          const statId = stat.id || stat._id;
          const existing = await prisma.statistic.findUnique({ where: { id: statId } });
          if (!existing) {
            const { _id, ...insertData } = stat;
            await prisma.statistic.create({ data: { id: statId, ...insertData } });
            imported++;
          }
        }
        results.imported.statistics = { imported };
      } catch (error) {
        results.errors.push({ type: 'statistics', error: error.message });
      }
    }

    // Import ping_results (legacy format) - convert to pingResults
    if (importDataObj.data.ping_results && Array.isArray(importDataObj.data.ping_results)) {
      try {
        let imported = 0;
        for (const pingResult of importDataObj.data.ping_results) {
          try {
            await prisma.pingResult.create({
              data: {
                targetId: pingResult.targetId,
                success: pingResult.success === 1 || pingResult.success === true,
                responseTime: pingResult.responseTime || null,
                timestamp: pingResult.timestamp ? new Date(pingResult.timestamp) : new Date(),
                statusCode: pingResult.statusCode || null,
                error: pingResult.error || null,
                protocol: pingResult.protocol || null,
              },
            });
            imported++;
          } catch (error) {
            // Skip duplicates
          }
        }
        results.imported.ping_results = { imported };
      } catch (error) {
        results.errors.push({ type: 'ping_results', error: error.message });
      }
    }

    // Import daily_stats (legacy format) - convert to statistics
    if (importDataObj.data.daily_stats && Array.isArray(importDataObj.data.daily_stats)) {
      try {
        let imported = 0;
        for (const stat of importDataObj.data.daily_stats) {
          try {
            await prisma.statistic.create({
              data: {
                targetId: stat.targetId,
                date: stat.date ? new Date(stat.date) : new Date(),
                totalPings: stat.totalPings || 0,
                successfulPings: stat.successfulPings || 0,
                failedPings: (stat.totalPings || 0) - (stat.successfulPings || 0),
                uptime: stat.totalPings > 0 ? (stat.successfulPings / stat.totalPings) * 100 : 0,
                lastResponseTime: 0,
                avgResponseTime: stat.avgResponseTime || 0,
                minResponseTime: stat.minResponseTime || null,
                maxResponseTime: stat.maxResponseTime || null,
              },
            });
            imported++;
          } catch (error) {
            // Skip duplicates
          }
        }
        results.imported.daily_stats = { imported };
      } catch (error) {
        results.errors.push({ type: 'daily_stats', error: error.message });
      }
    }

    // Import actions
    if (importDataObj.data.actions && Array.isArray(importDataObj.data.actions)) {
      try {
        let imported = 0;
        let updated = 0;
        for (const action of importDataObj.data.actions) {
          const actionId = action.id || action._id;
          const existing = await prisma.action.findUnique({ where: { id: actionId } });
          if (existing) {
            if (options.overwrite) {
              const { id, _id, ...updateData } = action;
              await prisma.action.update({ where: { id: actionId }, data: updateData });
              updated++;
            }
          } else {
            const { _id, ...insertData } = action;
            await prisma.action.create({ data: { id: actionId, ...insertData } });
            imported++;
          }
        }
        results.imported.actions = { imported, updated };
      } catch (error) {
        results.errors.push({ type: 'actions', error: error.message });
      }
    }

    // Import alerts
    if (importDataObj.data.alerts && Array.isArray(importDataObj.data.alerts)) {
      try {
        let imported = 0;
        for (const alert of importDataObj.data.alerts) {
          const alertId = alert.id || alert._id;
          const existing = await prisma.alert.findUnique({ where: { id: alertId } });
          if (!existing) {
            const { _id, ...insertData } = alert;
            await prisma.alert.create({ data: { id: alertId, ...insertData } });
            imported++;
          }
        }
        results.imported.alerts = { imported };
      } catch (error) {
        results.errors.push({ type: 'alerts', error: error.message });
      }
    }

    // Import settings
    if (importDataObj.data.adminSettings) {
      try {
        const existing = await prisma.adminSettings.findUnique({ where: { id: 'settings' } });
        const { id, _id, ...settingsData } = importDataObj.data.adminSettings;
        if (existing) {
          if (options.overwrite) {
            await prisma.adminSettings.update({ where: { id: 'settings' }, data: settingsData });
            results.imported.adminSettings = { updated: 1 };
          }
        } else {
          await prisma.adminSettings.create({ data: { id: 'settings', ...settingsData } });
          results.imported.adminSettings = { imported: 1 };
        }
      } catch (error) {
        results.errors.push({ type: 'adminSettings', error: error.message });
      }
    }

    if (importDataObj.data.publicUISettings) {
      try {
        const existing = await prisma.publicUISettings.findUnique({ where: { id: 'settings' } });
        const { id, _id, ...settingsData } = importDataObj.data.publicUISettings;
        if (existing) {
          if (options.overwrite) {
            await prisma.publicUISettings.update({ where: { id: 'settings' }, data: settingsData });
            results.imported.publicUISettings = { updated: 1 };
          }
        } else {
          await prisma.publicUISettings.create({ data: { id: 'settings', ...settingsData } });
          results.imported.publicUISettings = { imported: 1 };
        }
      } catch (error) {
        results.errors.push({ type: 'publicUISettings', error: error.message });
      }
    }

    // Import favicons
    if (importDataObj.data.favicons && Array.isArray(importDataObj.data.favicons)) {
      try {
        let imported = 0;
        let updated = 0;
        for (const favicon of importDataObj.data.favicons) {
          const faviconId = favicon.id || favicon._id;
          const existing = await prisma.favicon.findUnique({ where: { id: faviconId } });
          if (existing) {
            if (options.overwrite) {
              const { id, _id, ...updateData } = favicon;
              await prisma.favicon.update({ where: { id: faviconId }, data: updateData });
              updated++;
            }
          } else {
            const { _id, ...insertData } = favicon;
            await prisma.favicon.create({ data: { id: faviconId, ...insertData } });
            imported++;
          }
        }
        results.imported.favicons = { imported, updated };
      } catch (error) {
        results.errors.push({ type: 'favicons', error: error.message });
      }
    }

    return results;
  } catch (error) {
    throw new Error(`Import failed: ${error.message}`);
  }
}

module.exports = {
  exportData,
  importData,
};
