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
    const faviconService = require('../services/faviconService');
    
    // Build target URL for favicon fetching
    const protocolLower = protocol.toUpperCase();
    const defaultPort = protocolLower === 'HTTPS' ? 443 : protocolLower === 'HTTP' ? 80 : null;
    const targetPort = port || defaultPort;
    const targetPath = path || '/';
    const targetUrl = targetPort && targetPort !== defaultPort
      ? `${protocolLower.toLowerCase()}://${host}:${targetPort}${targetPath}`
      : `${protocolLower.toLowerCase()}://${host}${targetPath}`;

    // Auto-fetch favicon for HTTP/HTTPS if appIcon not provided
    let fetchedAppIcon = appIcon;
    let finalAppUrl = appUrl;
    if ((protocolLower === 'HTTP' || protocolLower === 'HTTPS') && !appIcon) {
      try {
        // Parse auth if it's a string
        let authObj = auth;
        if (auth && typeof auth === 'string') {
          try {
            authObj = JSON.parse(auth);
          } catch (e) {
            authObj = null;
          }
        }

        const faviconUrl = await faviconService.getFaviconUrlFromHtml(targetUrl, {
          timeout: (timeout || 30) * 1000,
          maxRedirects: maxRedirects !== undefined ? maxRedirects : 5,
          ignoreSsl: ignoreSsl === true,
          auth: authObj,
        });

        if (faviconUrl) {
          fetchedAppIcon = faviconUrl;
          // Also set appUrl if not provided
          if (!finalAppUrl) {
            finalAppUrl = targetUrl;
          }
        }
      } catch (error) {
        // Silently fail - favicon fetching is optional
        console.error(`Failed to fetch favicon for ${targetUrl}:`, error.message);
      }
    }

    const target = {
      name,
      host,
      port: port || null,
      protocol: protocol.toUpperCase(),
      interval: interval || 60,
      enabled: enabled !== false,
      path: path || null,
      // Application settings
      appUrl: finalAppUrl || null,
      appIcon: fetchedAppIcon || null,
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
    const period = req.query.period || (req.query.days ? null : '24h'); // Default to 24h if no period specified
    const days = parseFloat(req.query.days) || null;

    let startDateObj;
    let endDateObj = new Date();
    let groupByTrunc;
    let intervalMinutes;
    let maxPoints;

    // Determine grouping based on period
    if (period === '1h') {
      // 1H: 60 data points (one per minute)
      startDateObj = new Date();
      startDateObj.setHours(startDateObj.getHours() - 1);
      groupByTrunc = "date_trunc('minute', timestamp)";
      intervalMinutes = 1;
      maxPoints = 60;
    } else if (period === '24h') {
      // 24H: 48 data points (every 30 minutes)
      startDateObj = new Date();
      startDateObj.setHours(startDateObj.getHours() - 24);
      groupByTrunc = "to_timestamp(FLOOR(EXTRACT(EPOCH FROM timestamp) / 1800) * 1800)";
      intervalMinutes = 30;
      maxPoints = 48;
    } else if (period === '7d') {
      // 7D: 56 data points (every 3 hours)
      startDateObj = new Date();
      startDateObj.setDate(startDateObj.getDate() - 7);
      groupByTrunc = "to_timestamp(FLOOR(EXTRACT(EPOCH FROM timestamp) / 10800) * 10800)";
      intervalMinutes = 180;
      maxPoints = 56;
    } else if (period === '30d') {
      // 30D: 60 data points (every 12 hours)
      startDateObj = new Date();
      startDateObj.setDate(startDateObj.getDate() - 30);
      groupByTrunc = "to_timestamp(FLOOR(EXTRACT(EPOCH FROM timestamp) / 43200) * 43200)";
      intervalMinutes = 720;
      maxPoints = 60;
    } else if (period === 'all') {
      // ALL: 60 data points spread evenly since monitor creation
      const firstPingResult = await db.query(`
        SELECT MIN(timestamp) as first_timestamp
        FROM "pingResults"
        WHERE "targetId" = $1
      `, [targetId]);
      
      if (firstPingResult.rows[0] && firstPingResult.rows[0].first_timestamp) {
        startDateObj = new Date(firstPingResult.rows[0].first_timestamp);
        const totalSeconds = Math.floor((endDateObj - startDateObj) / 1000);
        // Calculate interval to get exactly 60 points
        intervalMinutes = Math.max(1, Math.floor(totalSeconds / 60 / 60));
        maxPoints = 60;
      } else {
        // No data, return empty
        return res.json({ success: true, statistics: [] });
      }
    } else if (days !== null) {
      // Fallback to days parameter for backward compatibility
      startDateObj = new Date();
      startDateObj.setDate(startDateObj.getDate() - days);
      if (days <= 1) {
        groupByTrunc = "date_trunc('hour', timestamp)";
        intervalMinutes = 60;
        maxPoints = 24;
      } else {
        groupByTrunc = "date_trunc('day', timestamp)";
        intervalMinutes = 1440;
        maxPoints = days;
      }
    } else {
      // Default to 24h
      startDateObj = new Date();
      startDateObj.setHours(startDateObj.getHours() - 24);
      groupByTrunc = "date_trunc('minute', timestamp) - (EXTRACT(MINUTE FROM timestamp)::integer % 30 || ' minutes')::interval";
      intervalMinutes = 30;
      maxPoints = 48;
    }

    // Generate evenly spaced time buckets and aggregate data into them
    // This ensures we always get the exact number of points requested
    const intervalSeconds = intervalMinutes * 60;
    const startEpoch = Math.floor(startDateObj.getTime() / 1000);
    const endEpoch = Math.floor(endDateObj.getTime() / 1000);
    
    // Generate time buckets using generate_series
    const result = await db.query(`
      WITH time_buckets AS (
        SELECT 
          to_timestamp(bucket_epoch) as bucket_time
        FROM generate_series($2::bigint, $3::bigint, $5::bigint) as bucket_epoch
        ORDER BY bucket_epoch
        LIMIT $4
      )
      SELECT 
        time_buckets.bucket_time::text as date,
        COALESCE(COUNT(pr._id), 0)::integer as "totalPings",
        COALESCE(SUM(CASE WHEN pr.success = true THEN 1 ELSE 0 END), 0)::integer as "successfulPings",
        COALESCE(AVG(CASE WHEN pr."responseTime" IS NOT NULL THEN pr."responseTime"::real ELSE NULL END), 0) as "avgResponseTime",
        MIN(CASE WHEN pr."responseTime" IS NOT NULL THEN pr."responseTime"::integer ELSE NULL END) as "minResponseTime",
        MAX(CASE WHEN pr."responseTime" IS NOT NULL THEN pr."responseTime"::integer ELSE NULL END) as "maxResponseTime"
      FROM time_buckets
      LEFT JOIN "pingResults" pr ON 
        pr."targetId" = $1 
        AND pr.timestamp >= time_buckets.bucket_time 
        AND pr.timestamp < time_buckets.bucket_time + ($5 || ' seconds')::interval
      GROUP BY time_buckets.bucket_time
      ORDER BY time_buckets.bucket_time ASC
    `, [targetId, startEpoch, endEpoch, maxPoints, intervalSeconds]);
    
    // Get last response time separately
    const lastResponseResult = await db.query(`
      SELECT "responseTime" FROM "pingResults" 
      WHERE "targetId" = $1 AND timestamp >= $2 AND timestamp <= $3
      ORDER BY timestamp DESC LIMIT 1
    `, [targetId, startDateObj, endDateObj]);

    const results = result.rows; // Already in chronological order
    const lastResponse = lastResponseResult.rows[0] || null;

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

    // Get uptime data for 24h and 30d, plus daily stats for blocks
    const uptime24hStart = new Date();
    uptime24hStart.setDate(uptime24hStart.getDate() - 1);
    uptime24hStart.setHours(0, 0, 0, 0);
    
    const uptime30dStart = new Date();
    uptime30dStart.setDate(uptime30dStart.getDate() - 30);
    uptime30dStart.setHours(0, 0, 0, 0);

    // Get 24h uptime
    const uptime24hResult = await db.query(`
      SELECT 
        SUM("totalPings")::bigint as "totalPings",
        SUM("successfulPings")::bigint as "successfulPings"
      FROM statistics
      WHERE "targetId" = $1 AND date >= $2
    `, [targetId, uptime24hStart]);
    
    const uptime24hData = uptime24hResult.rows[0] || { totalPings: 0, successfulPings: 0 };
    const uptime24h = uptime24hData.totalPings > 0 
      ? (uptime24hData.successfulPings / uptime24hData.totalPings) * 100 
      : 0;

    // Get 30d uptime and daily stats
    const uptime30dResult = await db.query(`
      SELECT 
        date::date as date,
        "totalPings",
        "successfulPings",
        "failedPings",
        uptime
      FROM statistics
      WHERE "targetId" = $1 AND date >= $2
      ORDER BY date ASC
    `, [targetId, uptime30dStart]);

    const dailyStats = uptime30dResult.rows;
    let totalPings30d = 0;
    let successfulPings30d = 0;
    dailyStats.forEach(stat => {
      totalPings30d += stat.totalPings || 0;
      successfulPings30d += stat.successfulPings || 0;
    });
    const uptime30d = totalPings30d > 0 ? (successfulPings30d / totalPings30d) * 100 : 0;

    return res.json({ 
      success: true, 
      statistics: stats,
      uptime: {
        '24h': {
          uptime: uptime24h,
          totalPings: uptime24hData.totalPings || 0,
          successfulPings: uptime24hData.successfulPings || 0,
          failedPings: (uptime24hData.totalPings || 0) - (uptime24hData.successfulPings || 0)
        },
        '30d': {
          uptime: uptime30d,
          totalPings: totalPings30d,
          successfulPings: successfulPings30d,
          failedPings: totalPings30d - successfulPings30d
        }
      },
      dailyStats: dailyStats // For uptime blocks
    });
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
  // Set timeout for the request (60 seconds max)
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ success: false, error: 'Test timeout - ping took too long' });
    }
  }, 60000);

  try {
    const db = getDB();
    const targetId = req.params.id;

    const target = await db.collection('targets').findOne({ _id: targetId });

    if (!target) {
      clearTimeout(timeout);
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    // Execute ping with timeout
    const pingPromise = pingService.ping(target);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Ping timeout')), 55000); // 55 seconds
    });
    
    const result = await Promise.race([pingPromise, timeoutPromise]);

    clearTimeout(timeout);

    if (!res.headersSent) {
      res.json({
        success: result.success,
        result,
      });
    }
  } catch (error) {
    clearTimeout(timeout);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
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
