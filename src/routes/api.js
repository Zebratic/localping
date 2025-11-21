const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const monitorService = require('../services/monitorService');
const pingService = require('../services/pingService');
const actionService = require('../services/actionService');
const gatewayService = require('../services/gatewayService');
const chalk = require('../utils/colors');
const { validateTargetInput } = require('../middleware/auth');

// Get all targets
router.get('/targets', async (req, res) => {
  try {
    const db = getDB();
    const targets = await db.collection('targets').find({}).toArray();

    // Add current status to each target and parse JSON fields
    const targetsWithStatus = targets.map((target) => {
      const parsedTarget = { ...target };

      // Parse JSON fields stored as strings in SQLite
      if (parsedTarget.auth && typeof parsedTarget.auth === 'string') {
        try {
          parsedTarget.auth = JSON.parse(parsedTarget.auth);
        } catch (e) {
          parsedTarget.auth = null;
        }
      }
      if (parsedTarget.quickCommands && typeof parsedTarget.quickCommands === 'string') {
        try {
          parsedTarget.quickCommands = JSON.parse(parsedTarget.quickCommands);
        } catch (e) {
          parsedTarget.quickCommands = [];
        }
      }

      return {
        ...parsedTarget,
        currentStatus: monitorService.getTargetStatus(target._id),
      };
    });

    res.json({ success: true, targets: targetsWithStatus });
  } catch (error) {
    console.error(chalk.red('Error fetching targets:'), error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get target by ID
router.get('/targets/:id', async (req, res) => {
  try {
    const db = getDB();
    const target = await db.collection('targets').findOne({ _id: req.params.id });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    // Parse JSON fields stored as strings in SQLite
    const parsedTarget = { ...target };
    if (parsedTarget.auth && typeof parsedTarget.auth === 'string') {
      try {
        parsedTarget.auth = JSON.parse(parsedTarget.auth);
      } catch (e) {
        parsedTarget.auth = null;
      }
    }
    if (parsedTarget.quickCommands && typeof parsedTarget.quickCommands === 'string') {
      try {
        parsedTarget.quickCommands = JSON.parse(parsedTarget.quickCommands);
      } catch (e) {
        parsedTarget.quickCommands = [];
      }
    }

    res.json({
      success: true,
      target: {
        ...parsedTarget,
        currentStatus: monitorService.getTargetStatus(target._id),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create target
router.post('/targets', validateTargetInput, async (req, res) => {
  try {
    const {
      name,
      host,
      port,
      protocol,
      interval,
      enabled,
      path,
      // Advanced settings
      appUrl,
      appIcon,
      retries,
      retryInterval,
      timeout,
      httpMethod,
      statusCodes,
      maxRedirects,
      ignoreSsl,
      upsideDown,
      auth,
      // Public UI settings
      position,
      group,
      quickCommands,
    } = req.body;

    if (!name || !host || !protocol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, host, protocol',
      });
    }

    const db = getDB();
    const target = {
      name,
      host,
      port: port || null,
      protocol: protocol.toUpperCase(),
      interval: interval || 60,
      enabled: enabled !== false,
      path: path || null,
      // Application settings
      appUrl: appUrl || null,
      appIcon: appIcon || null,
      // Retry settings
      retries: retries !== undefined ? retries : 0,
      retryInterval: retryInterval !== undefined ? retryInterval : 5,
      // HTTP settings
      timeout: timeout !== undefined ? timeout : 30,
      httpMethod: httpMethod || 'GET',
      statusCodes: statusCodes || '200-299',
      maxRedirects: maxRedirects !== undefined ? maxRedirects : 5,
      // Advanced options
      ignoreSsl: ignoreSsl === true,
      upsideDown: upsideDown === true,
      // Authentication
      auth: auth || null,
      // Public UI settings
      position: position !== undefined ? position : 0,
      group: group || null,
      quickCommands: quickCommands || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('targets').insertOne(target);

    if (target.enabled) {
      monitorService.startTargetMonitor({ ...target, _id: result.insertedId });
    }

    res.json({
      success: true,
      targetId: result.insertedId,
      target: { ...target, _id: result.insertedId },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update target
router.put('/targets/:id', validateTargetInput, async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;
    const {
      name,
      host,
      port,
      protocol,
      interval,
      enabled,
      path,
      // Advanced settings
      appUrl,
      appIcon,
      retries,
      retryInterval,
      timeout,
      httpMethod,
      statusCodes,
      maxRedirects,
      ignoreSsl,
      upsideDown,
      auth,
      // Public UI settings
      position,
      group,
      quickCommands,
    } = req.body;

    const updateData = {};
    // Basic fields
    if (name !== undefined) updateData.name = name;
    if (host !== undefined) updateData.host = host;
    if (port !== undefined) updateData.port = port;
    if (protocol !== undefined) updateData.protocol = protocol.toUpperCase();
    if (interval !== undefined) updateData.interval = interval;
    if (path !== undefined) updateData.path = path;
    // Application settings
    if (appUrl !== undefined) updateData.appUrl = appUrl;
    if (appIcon !== undefined) updateData.appIcon = appIcon;
    // Retry settings
    if (retries !== undefined) updateData.retries = retries;
    if (retryInterval !== undefined) updateData.retryInterval = retryInterval;
    // HTTP settings
    if (timeout !== undefined) updateData.timeout = timeout;
    if (httpMethod !== undefined) updateData.httpMethod = httpMethod;
    if (statusCodes !== undefined) updateData.statusCodes = statusCodes;
    if (maxRedirects !== undefined) updateData.maxRedirects = maxRedirects;
    // Advanced options
    if (ignoreSsl !== undefined) updateData.ignoreSsl = ignoreSsl === true;
    if (upsideDown !== undefined) updateData.upsideDown = upsideDown === true;
    // Authentication
    if (auth !== undefined) updateData.auth = auth;
    // Public UI settings
    if (position !== undefined) updateData.position = position;
    if (group !== undefined) updateData.group = group;
    if (quickCommands !== undefined) updateData.quickCommands = quickCommands;

    updateData.updatedAt = new Date();

    const result = await db.collection('targets').updateOne({ _id: targetId }, { $set: updateData });

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    // Handle enabled status change
    if (enabled !== undefined) {
      if (enabled) {
        const target = await db.collection('targets').findOne({ _id: targetId });
        monitorService.startTargetMonitor(target);
      } else {
        monitorService.stopTargetMonitor(targetId);
      }

      await db.collection('targets').updateOne({ _id: targetId }, { $set: { enabled } });
    }

    res.json({ success: true, message: 'Target updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete target
router.delete('/targets/:id', async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;

    // Stop monitoring
    monitorService.stopTargetMonitor(targetId);

    // Delete target
    const result = await db.collection('targets').deleteOne({ _id: targetId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    // Clean up related data
    await db.collection('pingResults').deleteMany({ targetId });
    await db.collection('alerts').deleteMany({ targetId });
    await db.collection('statistics').deleteMany({ targetId });

    res.json({ success: true, message: 'Target deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get ping results for target
router.get('/targets/:id/results', async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;
    const limit = parseInt(req.query.limit) || 100;
    const skip = parseInt(req.query.skip) || 0;

    const results = await db
      .collection('pingResults')
      .find({ targetId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();

    const count = await db.collection('pingResults').countDocuments({ targetId });

    res.json({
      success: true,
      results,
      total: count,
      limit,
      skip,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get statistics for target
router.get('/targets/:id/statistics', async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;
    const days = parseFloat(req.query.days) || 30;

    // For short time periods (<= 1 day), query pingResults directly and aggregate
    if (days <= 1) {
      const Database = require('better-sqlite3');
      const path = require('path');
      const dbPath = path.join(process.cwd(), 'data', 'localping.db');
      const sqliteDb = new Database(dbPath);

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const startDateStr = startDate.toISOString();

      // Aggregate by hour for periods <= 1 day
      const stmt = sqliteDb.prepare(`
        SELECT 
          strftime('%Y-%m-%d %H:00:00', timestamp) as date,
          COUNT(*) as totalPings,
          SUM(CASE WHEN success = 1 OR success = 'true' THEN 1 ELSE 0 END) as successfulPings,
          AVG(CASE WHEN responseTime IS NOT NULL THEN CAST(responseTime AS REAL) ELSE NULL END) as avgResponseTime,
          MIN(CASE WHEN responseTime IS NOT NULL THEN CAST(responseTime AS INTEGER) ELSE NULL END) as minResponseTime,
          MAX(CASE WHEN responseTime IS NOT NULL THEN CAST(responseTime AS INTEGER) ELSE NULL END) as maxResponseTime
        FROM pingResults
        WHERE targetId = ? AND timestamp >= ?
        GROUP BY strftime('%Y-%m-%d %H:00:00', timestamp)
        ORDER BY date ASC
      `);
      
      // Get last response time separately
      const lastResponseStmt = sqliteDb.prepare(`
        SELECT responseTime FROM pingResults 
        WHERE targetId = ? AND timestamp >= ? 
        ORDER BY timestamp DESC LIMIT 1
      `);

      const results = stmt.all(targetId, startDateStr);
      const lastResponse = lastResponseStmt.get(targetId, startDateStr);
      sqliteDb.close();

      const stats = results.map(r => ({
        date: r.date,
        totalPings: r.totalPings || 0,
        successfulPings: r.successfulPings || 0,
        failedPings: (r.totalPings || 0) - (r.successfulPings || 0),
        uptime: r.totalPings > 0 ? ((r.successfulPings / r.totalPings) * 100) : 0,
        avgResponseTime: r.avgResponseTime || 0,
        minResponseTime: r.minResponseTime || null,
        maxResponseTime: r.maxResponseTime || null,
        lastResponseTime: lastResponse?.responseTime || 0,
      }));

      return res.json({ success: true, statistics: stats });
    }

    // For longer periods, use daily statistics table
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await db
      .collection('statistics')
      .find({
        targetId,
        date: { $gte: startDate },
      })
      .sort({ date: -1 })
      .toArray();

    res.json({ success: true, statistics: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get alerts
router.get('/alerts', async (req, res) => {
  try {
    const db = getDB();
    const limit = parseInt(req.query.limit) || 50;
    const targetId = req.query.targetId ? req.query.targetId : null;

    const query = targetId ? { targetId } : {};

    const alerts = await db
      .collection('alerts')
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    res.json({ success: true, alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test ping a target
router.post('/targets/:id/test', async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;

    const target = await db.collection('targets').findOne({ _id: targetId });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    const result = await pingService.ping(target);

    res.json({
      success: result.success,
      result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Execute action
router.post('/actions/:id/execute', async (req, res) => {
  try {
    const db = getDB();
    const actionId = req.params.id;

    const action = await db.collection('actions').findOne({ _id: actionId });

    if (!action) {
      return res.status(404).json({ success: false, error: 'Action not found' });
    }

    const result = await actionService.executeAction(action);

    res.json({
      success: result.success,
      result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get gateway information
router.get('/gateway', (req, res) => {
  const gateways = gatewayService.getAllGateways();
  res.json({
    success: true,
    primaryGateway: gatewayService.getPrimaryGateway(),
    allGateways: gateways,
  });
});

// Get system status
router.get('/status', async (req, res) => {
  try {
    const db = getDB();

    const targetCount = await db.collection('targets').countDocuments();
    const downCount = await db.collection('targets').countDocuments({ enabled: true });

    const recentAlerts = await db
      .collection('alerts')
      .find({})
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();

    res.json({
      success: true,
      status: {
        totalTargets: targetCount,
        enabledTargets: downCount,
        activeMonitors: monitorService.getActiveMonitors().length,
        gateway: gatewayService.getPrimaryGateway(),
      },
      recentAlerts,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
