const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getDB } = require('../config/db');
const monitorService = require('../services/monitorService');
const IncidentService = require('../services/incidentService');
const { adminPageAuth } = require('../middleware/auth');

// Admin login page (GET)
router.get('/login', (req, res) => {
  // If already authenticated, redirect to admin
  if (req.session && req.session.adminAuthenticated) {
    return res.redirect('/admin');
  }
  res.render('admin/login');
});

// Admin login (POST)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    return res.status(401).json({
      success: false,
      error: 'Admin authentication not configured',
    });
  }

  // Trim whitespace from both sides for comparison
  const providedUsername = (username || '').trim();
  const providedPassword = (password || '').trim();
  const storedUsername = (adminUsername || '').trim();
  const storedPassword = (adminPassword || '').trim();

  // Check both username and password
  if (providedUsername === storedUsername && providedPassword === storedPassword) {
    // Get session duration from settings
    const db = getDB();
    let sessionDurationDays = 30; // Default
    try {
      const settings = await db.collection('adminSettings').findOne({ _id: 'settings' });
      if (settings && settings.sessionDurationDays) {
        sessionDurationDays = settings.sessionDurationDays;
      }
    } catch (error) {
      console.error('Error loading session duration:', error);
    }

    // Set session data - this marks the session as modified
    req.session.adminAuthenticated = true;
    req.session.loginTime = new Date();
    req.session.username = providedUsername;

    // Update cookie maxAge based on settings
    const maxAge = sessionDurationDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    req.session.cookie.maxAge = maxAge;
    req.session.cookie.expires = new Date(Date.now() + maxAge);

    // Send response - middleware will add Set-Cookie header automatically
    return res.json({ success: true, message: 'Authenticated' });
  } else {
    return res.status(401).json({
      success: false,
      error: 'Invalid username or password',
    });
  }
});

// Admin logout
router.get('/logout', (req, res) => {
  req.session.adminAuthenticated = false;
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/admin/login');
  });
});

// Admin dashboard - Protected by auth middleware
router.get('/', adminPageAuth, (req, res) => {
  res.render('admin/index');
});

// Proxy endpoint for icons (handles local network URLs) - public access
router.get('/api/proxy-icon', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL parameter is required' });
    }

    // Validate URL
    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid URL' });
    }

    // Fetch the icon - allow self-signed certificates for local networks
    const https = require('https');
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      validateStatus: (status) => status < 500, // Accept 4xx but not 5xx
      httpsAgent: new https.Agent({
        rejectUnauthorized: false, // Allow self-signed certificates
      }),
    });

    if (response.status >= 400) {
      return res.status(404).json({ success: false, error: 'Icon not found' });
    }

    // Determine content type
    const contentType = response.headers['content-type'] || 'image/png';
    
    // Set appropriate headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send the image data
    res.send(Buffer.from(response.data));
  } catch (error) {
    console.error('Error proxying icon:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch icon' });
  }
});

// Apply auth middleware to all admin API routes (except proxy-icon)
router.use('/api', (req, res, next) => {
  if (req.path === '/proxy-icon') {
    return next(); // Skip auth for proxy-icon
  }
  adminPageAuth(req, res, next);
});

// Admin API endpoints
router.get('/api/dashboard', async (req, res) => {
  try {
    const db = getDB();
    const faviconService = require('../services/faviconService');

    const targets = await db.collection('targets').find({}).toArray();
    
    // Fetch favicons for targets with appUrl
    const targetsWithStatus = await Promise.all(targets.map(async (target) => {
      let favicon = null;

      // If this is an app (has appUrl), try to fetch favicon
      if (target.appUrl) {
        // Check if we have a cached favicon
        let cachedFavicon = await db.collection('favicons').findOne({ appUrl: target.appUrl });

        if (cachedFavicon) {
          favicon = cachedFavicon.favicon;
        } else {
          // Fetch favicon and cache it
          favicon = await faviconService.getFavicon(target.appUrl);
          if (favicon) {
            await db.collection('favicons').updateOne(
              { appUrl: target.appUrl },
              {
                $set: {
                  appUrl: target.appUrl,
                  favicon: favicon,
                  updatedAt: new Date(),
                },
              },
              { upsert: true }
            );
          }
        }
      }

      // Parse JSON fields
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

      return {
        ...parsedTarget,
        favicon: favicon,
        currentStatus: monitorService.getTargetStatus(target._id),
      };
    }));

    const alerts = await db
      .collection('alerts')
      .find({})
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

    res.json({
      success: true,
      dashboard: {
        targets: targetsWithStatus,
        recentAlerts: alerts,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// List all actions
router.get('/api/actions', async (req, res) => {
  try {
    const db = getDB();
    const actions = await db.collection('actions').find({}).toArray();

    res.json({ success: true, actions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single action
router.get('/api/actions/:id', async (req, res) => {
  try {
    const db = getDB();
    const actionId = req.params.id;
    const action = await db.collection('actions').findOne({ _id: actionId });

    if (!action) {
      return res.status(404).json({ success: false, error: 'Action not found' });
    }

    res.json({ success: true, action });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create action
router.post('/api/actions', async (req, res) => {
  try {
    const { name, description, type, targetId, ...actionData } = req.body;

    if (!name || !type) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const db = getDB();
    const action = {
      name,
      description: description || '',
      type,
      targetId: targetId ? targetId : null,
      ...actionData,
      createdAt: new Date(),
    };

    const result = await db.collection('actions').insertOne(action);

    res.json({
      success: true,
      actionId: result.insertedId,
      action: { ...action, _id: result.insertedId },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update action
router.put('/api/actions/:id', async (req, res) => {
  try {
    const db = getDB();
    const actionId = req.params.id;

    const result = await db.collection('actions').updateOne(
      { _id: actionId },
      { $set: { ...req.body, updatedAt: new Date() } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, error: 'Action not found' });
    }

    res.json({ success: true, message: 'Action updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete action
router.delete('/api/actions/:id', async (req, res) => {
  try {
    const db = getDB();
    const actionId = req.params.id;

    const result = await db.collection('actions').deleteOne({ _id: actionId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Action not found' });
    }

    res.json({ success: true, message: 'Action deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Aliases for API routes (support both paths for backward compatibility)
router.post('/api/actions/:id/execute', async (req, res) => {
  try {
    const db = getDB();
    const actionId = req.params.id;
    const action = await db.collection('actions').findOne({ _id: actionId });

    if (!action) {
      return res.status(404).json({ success: false, error: 'Action not found' });
    }

    const actionService = require('../services/actionService');
    const result = await actionService.executeAction(action);

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ INCIDENT MANAGEMENT ROUTES ============

// Get all incidents
router.get('/api/incidents', async (req, res) => {
  try {
    const db = getDB();
    const incidentService = new IncidentService(db);
    const incidents = await incidentService.getIncidents();

    res.json({ success: true, incidents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single incident
router.get('/api/incidents/:id', async (req, res) => {
  try {
    const db = getDB();
    const incidentService = new IncidentService(db);
    const incident = await incidentService.getIncidentById(req.params.id);

    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found' });
    }

    res.json({ success: true, incident });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create incident
router.post('/api/incidents', async (req, res) => {
  try {
    const db = getDB();
    const incidentService = new IncidentService(db);
    const { title, description, status, severity, affectedServices } = req.body;

    if (!title || !description) {
      return res.status(400).json({
        success: false,
        error: 'Title and description are required',
      });
    }

    const result = await incidentService.createIncident({
      title,
      description,
      status,
      severity,
      affectedServices,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update incident
router.put('/api/incidents/:id', async (req, res) => {
  try {
    const db = getDB();
    const incidentService = new IncidentService(db);
    const { title, description, status, severity, affectedServices, updateMessage } = req.body;

    const updated = await incidentService.updateIncident(req.params.id, {
      title,
      description,
      status,
      severity,
      affectedServices,
      updateMessage,
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Incident not found' });
    }

    res.json({ success: true, message: 'Incident updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete incident
router.delete('/api/incidents/:id', async (req, res) => {
  try {
    const db = getDB();
    const incidentService = new IncidentService(db);
    const deleted = await incidentService.deleteIncident(req.params.id);

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Incident not found' });
    }

    res.json({ success: true, message: 'Incident deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ TARGET MANAGEMENT ROUTES ============

// Get all targets
router.get('/api/targets', async (req, res) => {
  try {
    const db = getDB();
    const targets = await db.collection('targets').find({}).toArray();

    const targetsWithStatus = targets.map((target) => {
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

      return {
        ...parsedTarget,
        currentStatus: monitorService.getTargetStatus(target._id),
      };
    });

    res.json({ success: true, targets: targetsWithStatus });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single target
router.get('/api/targets/:id', async (req, res) => {
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
router.post('/api/targets', async (req, res) => {
  try {
    const {
      name,
      host,
      port,
      protocol,
      interval,
      enabled,
      publicVisible,
      publicShowDetails,
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
      publicVisible: publicVisible !== false,
      publicShowDetails: publicShowDetails === true,
      appUrl: appUrl || null,
      appIcon: appIcon || null,
      retries: retries !== undefined ? retries : 0,
      retryInterval: retryInterval !== undefined ? retryInterval : 5,
      timeout: timeout !== undefined ? timeout : 30,
      httpMethod: httpMethod || 'GET',
      statusCodes: statusCodes || '200-299',
      maxRedirects: maxRedirects !== undefined ? maxRedirects : 5,
      ignoreSsl: ignoreSsl === true,
      upsideDown: upsideDown === true,
      auth: auth || null,
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
router.put('/api/targets/:id', async (req, res) => {
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
      publicVisible,
      publicShowDetails,
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
      position,
      group,
      quickCommands,
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (host !== undefined) updateData.host = host;
    if (port !== undefined) updateData.port = port;
    if (protocol !== undefined) updateData.protocol = protocol.toUpperCase();
    if (interval !== undefined) updateData.interval = interval;
    if (publicVisible !== undefined) updateData.publicVisible = publicVisible === true;
    if (publicShowDetails !== undefined) updateData.publicShowDetails = publicShowDetails === true;
    if (appUrl !== undefined) updateData.appUrl = appUrl;
    if (appIcon !== undefined) updateData.appIcon = appIcon;
    if (retries !== undefined) updateData.retries = retries;
    if (retryInterval !== undefined) updateData.retryInterval = retryInterval;
    if (timeout !== undefined) updateData.timeout = timeout;
    if (httpMethod !== undefined) updateData.httpMethod = httpMethod;
    if (statusCodes !== undefined) updateData.statusCodes = statusCodes;
    if (maxRedirects !== undefined) updateData.maxRedirects = maxRedirects;
    if (ignoreSsl !== undefined) updateData.ignoreSsl = ignoreSsl === true;
    if (upsideDown !== undefined) updateData.upsideDown = upsideDown === true;
    if (auth !== undefined) updateData.auth = auth;
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
    } else {
      // Restart monitoring with updated config if enabled
      const target = await db.collection('targets').findOne({ _id: targetId });
      if (target && target.enabled) {
        monitorService.stopTargetMonitor(targetId);
        monitorService.startTargetMonitor(target);
      }
    }

    res.json({ success: true, message: 'Target updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete target
router.delete('/api/targets/:id', async (req, res) => {
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

// Get target statistics (admin - works for all targets)
router.get('/api/targets/:id/statistics', async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;
    const days = parseFloat(req.query.days) || null;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

    const Database = require('better-sqlite3');
    const path = require('path');
    const dbPath = path.join(process.cwd(), 'data', 'localping.db');
    const sqliteDb = new Database(dbPath);

    let startDateStr;
    let endDateStr;
    let groupByFormat;
    let timePeriod;

    // Determine time period and grouping
    if (startDate && endDate) {
      // Custom date range
      startDateStr = startDate.toISOString();
      endDateStr = endDate.toISOString();
      const diffDays = (endDate - startDate) / (1000 * 60 * 60 * 24);
      
      if (diffDays <= 1) {
        groupByFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
        timePeriod = 'hour';
      } else if (diffDays <= 7) {
        groupByFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
        timePeriod = 'hour';
      } else if (diffDays <= 30) {
        groupByFormat = "strftime('%Y-%m-%d', timestamp)";
        timePeriod = 'day';
      } else {
        groupByFormat = "strftime('%Y-%m-%d', timestamp)";
        timePeriod = 'day';
      }
    } else if (days) {
      // Fixed period
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - days);
      startDateStr = start.toISOString();
      endDateStr = end.toISOString();
      
      if (days <= 1) {
        groupByFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
        timePeriod = 'hour';
      } else if (days <= 7) {
        groupByFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
        timePeriod = 'hour';
      } else {
        groupByFormat = "strftime('%Y-%m-%d', timestamp)";
        timePeriod = 'day';
      }
    } else {
      // Default to last 30 days
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      startDateStr = start.toISOString();
      endDateStr = end.toISOString();
      groupByFormat = "strftime('%Y-%m-%d', timestamp)";
      timePeriod = 'day';
    }

    // Aggregate by determined time period
    const stmt = sqliteDb.prepare(`
      SELECT 
        ${groupByFormat} as date,
        COUNT(*) as totalPings,
        SUM(CASE WHEN success = 1 OR success = 'true' THEN 1 ELSE 0 END) as successfulPings,
        AVG(CASE WHEN responseTime IS NOT NULL THEN CAST(responseTime AS REAL) ELSE NULL END) as avgResponseTime,
        MIN(CASE WHEN responseTime IS NOT NULL THEN CAST(responseTime AS INTEGER) ELSE NULL END) as minResponseTime,
        MAX(CASE WHEN responseTime IS NOT NULL THEN CAST(responseTime AS INTEGER) ELSE NULL END) as maxResponseTime
      FROM ping_results
      WHERE targetId = ? AND timestamp >= ? AND timestamp <= ?
      GROUP BY ${groupByFormat}
      ORDER BY date ASC
    `);
    
    // Get last response time separately
    const lastResponseStmt = sqliteDb.prepare(`
      SELECT responseTime FROM ping_results 
      WHERE targetId = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC LIMIT 1
    `);

    const results = stmt.all(targetId, startDateStr, endDateStr);
    const lastResponse = lastResponseStmt.get(targetId, startDateStr, endDateStr);
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
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get target uptime (admin - works for all targets)
router.get('/api/targets/:id/uptime', async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;
    const days = parseInt(req.query.days) || 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await db
      .collection('statistics')
      .find({
        targetId,
        date: { $gte: startDate },
      })
      .toArray();

    let totalPings = 0;
    let successfulPings = 0;

    stats.forEach(stat => {
      totalPings += stat.totalPings || 0;
      successfulPings += stat.successfulPings || 0;
    });

    const uptime = totalPings > 0 ? (successfulPings / totalPings) * 100 : 0;

    res.json({ success: true, uptime });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test target (admin)
router.post('/api/targets/:id/test', async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;

    const target = await db.collection('targets').findOne({ _id: targetId });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    const pingService = require('../services/pingService');
    const result = await pingService.ping(target);

    res.json({
      success: result.success,
      result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ POSTS MANAGEMENT ROUTES ============

// Get all posts
router.get('/api/posts', async (req, res) => {
  try {
    const db = getDB();
    const posts = await db.collection('posts').find({}).sort({ createdAt: -1 }).toArray();

    res.json({ success: true, posts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single post
router.get('/api/posts/:id', async (req, res) => {
  try {
    const db = getDB();
    const post = await db.collection('posts').findOne({ _id: req.params.id });

    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    res.json({ success: true, post });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create post
router.post('/api/posts', async (req, res) => {
  try {
    const { title, content, published } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Title and content are required',
      });
    }

    const db = getDB();
    const uuid = require('uuid');
    const post = {
      _id: uuid.v4(),
      title,
      content,
      published: published !== false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection('posts').insertOne(post);

    res.json({ success: true, post });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update post
router.put('/api/posts/:id', async (req, res) => {
  try {
    const db = getDB();
    const { title, content, published } = req.body;

    const updateData = {
      updatedAt: new Date(),
    };

    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (published !== undefined) updateData.published = published === true;

    const result = await db.collection('posts').updateOne(
      { _id: req.params.id },
      { $set: updateData }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    res.json({ success: true, message: 'Post updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete post
router.delete('/api/posts/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('posts').deleteOne({ _id: req.params.id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    res.json({ success: true, message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ DATA MANAGEMENT ROUTES ============

// Clear all ping data
router.post('/api/clear-ping-data', async (req, res) => {
  try {
    const db = getDB();
    const sqliteService = require('../services/sqliteService');

    // Clear pingResults from main database
    const pingResultsDeleted = await db.collection('pingResults').deleteMany({});
    
    // Clear statistics from main database
    const statisticsDeleted = await db.collection('statistics').deleteMany({});

    // Clear ping_results and daily_stats from SQLite service database
    const sqliteResult = sqliteService.clearAllPingData();

    res.json({ 
      success: true, 
      message: 'All ping data cleared successfully',
      details: {
        pingResults: pingResultsDeleted.deletedCount || 0,
        statistics: statisticsDeleted.deletedCount || 0,
        sqlitePingResults: sqliteResult.pingRecordsDeleted || 0,
        sqliteDailyStats: sqliteResult.dailyStatsDeleted || 0
      }
    });
  } catch (error) {
    console.error('Error clearing ping data:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============ ADMIN SETTINGS ROUTES ============

// Get admin settings
router.get('/api/admin-settings', async (req, res) => {
  try {
    const db = getDB();
    let settings = await db.collection('adminSettings').findOne({ _id: 'settings' });

    if (!settings) {
      // Return defaults if not found
      settings = {
        _id: 'settings',
        sessionDurationDays: 30,
        dataRetentionDays: 30,
      };
    }

    // Ensure dataRetentionDays exists (for migration)
    if (!settings.dataRetentionDays) {
      settings.dataRetentionDays = 30;
    }

    // Get database file size
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(process.cwd(), 'data', 'localping.db');
    let dbSize = 0;
    try {
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        dbSize = stats.size;
      }
    } catch (error) {
      console.error('Error getting database file size:', error);
    }

    res.json({ success: true, settings, dbSize });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update admin settings
router.put('/api/admin-settings', async (req, res) => {
  try {
    const db = getDB();
    const { sessionDurationDays, dataRetentionDays } = req.body;

    if (sessionDurationDays !== undefined) {
      const days = parseInt(sessionDurationDays, 10);
      if (isNaN(days) || days < 1 || days > 365) {
        return res.status(400).json({
          success: false,
          error: 'Session duration must be between 1 and 365 days',
        });
      }
    }

    if (dataRetentionDays !== undefined) {
      const days = parseInt(dataRetentionDays, 10);
      if (isNaN(days) || days < 1 || days > 3650) {
        return res.status(400).json({
          success: false,
          error: 'Data retention must be between 1 and 3650 days (10 years)',
        });
      }
    }

    const updateData = {
      updatedAt: new Date(),
    };

    if (sessionDurationDays !== undefined) {
      updateData.sessionDurationDays = parseInt(sessionDurationDays, 10);
    }

    if (dataRetentionDays !== undefined) {
      updateData.dataRetentionDays = parseInt(dataRetentionDays, 10);
    }

    const existing = await db.collection('adminSettings').findOne({ _id: 'settings' });

    if (existing) {
      await db.collection('adminSettings').updateOne(
        { _id: 'settings' },
        { $set: updateData }
      );
    } else {
      await db.collection('adminSettings').insertOne({
        _id: 'settings',
        sessionDurationDays: sessionDurationDays !== undefined ? parseInt(sessionDurationDays, 10) : 30,
        dataRetentionDays: dataRetentionDays !== undefined ? parseInt(dataRetentionDays, 10) : 30,
        ...updateData,
      });
    }

    res.json({ success: true, message: 'Admin settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ PUBLIC UI SETTINGS ROUTES ============

// Get public UI settings
router.get('/api/public-ui-settings', async (req, res) => {
  try {
    const db = getDB();
    let settings = await db.collection('publicUISettings').findOne({ _id: 'settings' });

    if (!settings) {
      // Return defaults if not found
      settings = {
        _id: 'settings',
        title: 'Homelab',
        subtitle: 'System Status & Application Dashboard',
        customCSS: null,
      };
    }

    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update public UI settings
router.put('/api/public-ui-settings', async (req, res) => {
  try {
    const db = getDB();
    const { title, subtitle, customCSS } = req.body;

    const settings = {
      title: title || 'Homelab',
      subtitle: subtitle || 'System Status & Application Dashboard',
      customCSS: customCSS || null,
      updatedAt: new Date(),
    };

    const existing = await db.collection('publicUISettings').findOne({ _id: 'settings' });

    if (existing) {
      await db.collection('publicUISettings').updateOne(
        { _id: 'settings' },
        { $set: settings }
      );
    } else {
      await db.collection('publicUISettings').insertOne({
        _id: 'settings',
        ...settings,
      });
    }

    res.json({ success: true, message: 'Public UI settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ BACKUP/EXPORT ROUTES ============

// Export data
router.post('/api/backup/export', async (req, res) => {
  try {
    const backupService = require('../services/backupService');
    const {
      full,
      monitors,
      incidents,
      posts,
      dataPoints,
      actions,
      alerts,
      settings,
      favicons,
    } = req.body;

    const exportData = await backupService.exportData({
      full: full === true,
      monitors: monitors === true,
      incidents: incidents === true,
      posts: posts === true,
      dataPoints: dataPoints === true,
      actions: actions === true,
      alerts: alerts === true,
      settings: settings === true,
      favicons: favicons === true,
    });

    res.json({
      success: true,
      data: exportData,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Import data
router.post('/api/backup/import', async (req, res) => {
  try {
    const backupService = require('../services/backupService');
    const { importData, overwrite } = req.body;

    if (!importData || !importData.data) {
      return res.status(400).json({
        success: false,
        error: 'Invalid import data format',
      });
    }

    const results = await backupService.importData(importData, {
      overwrite: overwrite === true,
    });

    res.json({
      success: true,
      results,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
