const { getDB } = require('../config/db');
// sqliteService removed - using PostgreSQL via db.js now
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
  const db = getDB();
  const exportData = {
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
    const targets = await db.collection('targets').find({}).toArray();
    // Parse JSON fields
    exportData.data.targets = targets.map(target => {
      const parsed = { ...target };
      if (parsed.auth && typeof parsed.auth === 'string') {
        try {
          parsed.auth = JSON.parse(parsed.auth);
        } catch (e) {
          parsed.auth = null;
        }
      }
      if (parsed.quickCommands && typeof parsed.quickCommands === 'string') {
        try {
          parsed.quickCommands = JSON.parse(parsed.quickCommands);
        } catch (e) {
          parsed.quickCommands = [];
        }
      }
      return parsed;
    });
  }

  // Export incidents
  if (options.incidents) {
    exportData.data.incidents = await db.collection('incidents').find({}).toArray();
  }

  // Export posts
  if (options.posts) {
    exportData.data.posts = await db.collection('posts').find({}).toArray();
  }

  // Export data points (ping results and statistics)
  if (options.dataPoints) {
    // Export pingResults from main DB
    exportData.data.pingResults = await db.collection('pingResults').find({}).toArray();
    
    // Export statistics from main DB
    exportData.data.statistics = await db.collection('statistics').find({}).toArray();
    
    // Export pingResults from PostgreSQL (legacy format name for compatibility)
    exportData.data.ping_results = await db.collection('pingResults').find({}).toArray();
    
    // Export statistics as daily_stats (legacy format name for compatibility)
    exportData.data.daily_stats = await db.collection('statistics').find({}).toArray();
  }

  // Export actions
  if (options.actions) {
    exportData.data.actions = await db.collection('actions').find({}).toArray();
  }

  // Export alerts
  if (options.alerts) {
    exportData.data.alerts = await db.collection('alerts').find({}).toArray();
  }

  // Export settings
  if (options.settings) {
    const adminSettings = await db.collection('adminSettings').findOne({ _id: 'settings' });
    const publicUISettings = await db.collection('publicUISettings').findOne({ _id: 'settings' });
    exportData.data.adminSettings = adminSettings || null;
    exportData.data.publicUISettings = publicUISettings || null;
  }

  // Export favicons
  if (options.favicons) {
    exportData.data.favicons = await db.collection('favicons').find({}).toArray();
  }

  return exportData;
}

/**
 * Import data into the database
 * @param {Object} importData - Data to import
 * @param {Object} options - Import options
 * @param {boolean} options.overwrite - Overwrite existing data
 * @returns {Promise<Object>} Import result
 */
async function importData(importData, options = {}) {
  const db = getDB();
  const results = {
    imported: {},
    errors: []
  };

  try {
    // Validate import data structure
    if (!importData.data || typeof importData.data !== 'object') {
      throw new Error('Invalid import data format');
    }

    // Import targets (monitors)
    if (importData.data.targets && Array.isArray(importData.data.targets)) {
      try {
        let imported = 0;
        let updated = 0;
        let skipped = 0;
        for (const target of importData.data.targets) {
          try {
            // Check if target exists by _id
            const existingById = await db.collection('targets').findOne({ _id: target._id });
            if (existingById) {
              if (options.overwrite) {
                // Convert auth and quickCommands back to JSON strings if needed
                const updateData = { ...target };
                if (updateData.auth && typeof updateData.auth === 'object') {
                  updateData.auth = JSON.stringify(updateData.auth);
                }
                if (updateData.quickCommands && Array.isArray(updateData.quickCommands)) {
                  updateData.quickCommands = JSON.stringify(updateData.quickCommands);
                }
                await db.collection('targets').updateOne({ _id: target._id }, { $set: updateData });
                updated++;
              } else {
                skipped++;
              }
            } else {
              // Check if target with same name exists (UNIQUE constraint on name)
              const existingByName = await db.collection('targets').findOne({ name: target.name });
              if (existingByName) {
                if (options.overwrite) {
                  // Update the existing target with the same name
                  const updateData = { ...target };
                  if (updateData.auth && typeof updateData.auth === 'object') {
                    updateData.auth = JSON.stringify(updateData.auth);
                  }
                  if (updateData.quickCommands && Array.isArray(updateData.quickCommands)) {
                    updateData.quickCommands = JSON.stringify(updateData.quickCommands);
                  }
                  // Keep the existing _id to avoid conflicts
                  updateData._id = existingByName._id;
                  await db.collection('targets').updateOne({ _id: existingByName._id }, { $set: updateData });
                  updated++;
                } else {
                  skipped++;
                }
              } else {
                // Convert auth and quickCommands to JSON strings if needed
                const insertData = { ...target };
                if (insertData.auth && typeof insertData.auth === 'object') {
                  insertData.auth = JSON.stringify(insertData.auth);
                }
                if (insertData.quickCommands && Array.isArray(insertData.quickCommands)) {
                  insertData.quickCommands = JSON.stringify(insertData.quickCommands);
                }
                await db.collection('targets').insertOne(insertData);
                imported++;
              }
            }
          } catch (error) {
            // Handle individual target errors (e.g., UNIQUE constraint)
            if (error.message.includes('UNIQUE constraint')) {
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
    if (importData.data.incidents && Array.isArray(importData.data.incidents)) {
      try {
        let imported = 0;
        let updated = 0;
        for (const incident of importData.data.incidents) {
          const existing = await db.collection('incidents').findOne({ _id: incident._id });
          if (existing) {
            if (options.overwrite) {
              await db.collection('incidents').updateOne({ _id: incident._id }, { $set: incident });
              updated++;
            }
          } else {
            await db.collection('incidents').insertOne(incident);
            imported++;
          }
        }
        results.imported.incidents = { imported, updated };
      } catch (error) {
        results.errors.push({ type: 'incidents', error: error.message });
      }
    }

    // Import posts
    if (importData.data.posts && Array.isArray(importData.data.posts)) {
      try {
        let imported = 0;
        let updated = 0;
        for (const post of importData.data.posts) {
          const existing = await db.collection('posts').findOne({ _id: post._id });
          if (existing) {
            if (options.overwrite) {
              await db.collection('posts').updateOne({ _id: post._id }, { $set: post });
              updated++;
            }
          } else {
            await db.collection('posts').insertOne(post);
            imported++;
          }
        }
        results.imported.posts = { imported, updated };
      } catch (error) {
        results.errors.push({ type: 'posts', error: error.message });
      }
    }

    // Import data points
    if (importData.data.pingResults && Array.isArray(importData.data.pingResults)) {
      try {
        let imported = 0;
        for (const pingResult of importData.data.pingResults) {
          const existing = await db.collection('pingResults').findOne({ _id: pingResult._id });
          if (!existing) {
            await db.collection('pingResults').insertOne(pingResult);
            imported++;
          }
        }
        results.imported.pingResults = { imported };
      } catch (error) {
        results.errors.push({ type: 'pingResults', error: error.message });
      }
    }

    if (importData.data.statistics && Array.isArray(importData.data.statistics)) {
      try {
        let imported = 0;
        for (const stat of importData.data.statistics) {
          const existing = await db.collection('statistics').findOne({ _id: stat._id });
          if (!existing) {
            await db.collection('statistics').insertOne(stat);
            imported++;
          }
        }
        results.imported.statistics = { imported };
      } catch (error) {
        results.errors.push({ type: 'statistics', error: error.message });
      }
    }

    // Import ping_results (legacy format) - convert to pingResults
    if (importData.data.ping_results && Array.isArray(importData.data.ping_results)) {
      try {
        let imported = 0;
        for (const pingResult of importData.data.ping_results) {
          try {
            await db.collection('pingResults').insertOne({
              _id: require('uuid').v4(),
              targetId: pingResult.targetId,
              success: pingResult.success === 1 || pingResult.success === true,
              responseTime: pingResult.responseTime || null,
              timestamp: pingResult.timestamp ? new Date(pingResult.timestamp) : new Date(),
              statusCode: pingResult.statusCode || null,
              error: pingResult.error || null,
              protocol: pingResult.protocol || null
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
    if (importData.data.daily_stats && Array.isArray(importData.data.daily_stats)) {
      try {
        let imported = 0;
        for (const stat of importData.data.daily_stats) {
          try {
            await db.collection('statistics').insertOne({
              _id: require('uuid').v4(),
              targetId: stat.targetId,
              date: stat.date ? new Date(stat.date) : new Date(),
              totalPings: stat.totalPings || 0,
              successfulPings: stat.successfulPings || 0,
              failedPings: (stat.totalPings || 0) - (stat.successfulPings || 0),
              uptime: stat.totalPings > 0 ? (stat.successfulPings / stat.totalPings) * 100 : 0,
              lastResponseTime: null,
              avgResponseTime: stat.avgResponseTime || 0,
              minResponseTime: stat.minResponseTime || null,
              maxResponseTime: stat.maxResponseTime || null
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
    if (importData.data.actions && Array.isArray(importData.data.actions)) {
      try {
        let imported = 0;
        let updated = 0;
        for (const action of importData.data.actions) {
          const existing = await db.collection('actions').findOne({ _id: action._id });
          if (existing) {
            if (options.overwrite) {
              await db.collection('actions').updateOne({ _id: action._id }, { $set: action });
              updated++;
            }
          } else {
            await db.collection('actions').insertOne(action);
            imported++;
          }
        }
        results.imported.actions = { imported, updated };
      } catch (error) {
        results.errors.push({ type: 'actions', error: error.message });
      }
    }

    // Import alerts
    if (importData.data.alerts && Array.isArray(importData.data.alerts)) {
      try {
        let imported = 0;
        for (const alert of importData.data.alerts) {
          const existing = await db.collection('alerts').findOne({ _id: alert._id });
          if (!existing) {
            await db.collection('alerts').insertOne(alert);
            imported++;
          }
        }
        results.imported.alerts = { imported };
      } catch (error) {
        results.errors.push({ type: 'alerts', error: error.message });
      }
    }

    // Import settings
    if (importData.data.adminSettings) {
      try {
        const existing = await db.collection('adminSettings').findOne({ _id: 'settings' });
        if (existing) {
          if (options.overwrite) {
            await db.collection('adminSettings').updateOne({ _id: 'settings' }, { $set: importData.data.adminSettings });
            results.imported.adminSettings = { updated: 1 };
          }
        } else {
          await db.collection('adminSettings').insertOne(importData.data.adminSettings);
          results.imported.adminSettings = { imported: 1 };
        }
      } catch (error) {
        results.errors.push({ type: 'adminSettings', error: error.message });
      }
    }

    if (importData.data.publicUISettings) {
      try {
        const existing = await db.collection('publicUISettings').findOne({ _id: 'settings' });
        if (existing) {
          if (options.overwrite) {
            await db.collection('publicUISettings').updateOne({ _id: 'settings' }, { $set: importData.data.publicUISettings });
            results.imported.publicUISettings = { updated: 1 };
          }
        } else {
          await db.collection('publicUISettings').insertOne(importData.data.publicUISettings);
          results.imported.publicUISettings = { imported: 1 };
        }
      } catch (error) {
        results.errors.push({ type: 'publicUISettings', error: error.message });
      }
    }

    // Import favicons
    if (importData.data.favicons && Array.isArray(importData.data.favicons)) {
      try {
        let imported = 0;
        let updated = 0;
        for (const favicon of importData.data.favicons) {
          const existing = await db.collection('favicons').findOne({ _id: favicon._id });
          if (existing) {
            if (options.overwrite) {
              await db.collection('favicons').updateOne({ _id: favicon._id }, { $set: favicon });
              updated++;
            }
          } else {
            await db.collection('favicons').insertOne(favicon);
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

