const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getDB } = require('../config/db');
const monitorService = require('../services/monitorService');
const IncidentService = require('../services/incidentService');
const { adminPageAuth } = require('../middleware/auth');
const chalk = require('../utils/colors');

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
      path,
      interval,
      enabled,
      publicVisible,
      publicShowDetails,
      publicShowStatus,
      publicShowAppLink,
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
      path: path || null,
      interval: interval || 60,
      enabled: enabled !== false,
      publicVisible: publicVisible !== false,
      publicShowDetails: publicShowDetails === true,
      publicShowStatus: publicShowStatus !== false, // Default to true
      publicShowAppLink: publicShowAppLink !== false, // Default to true
      appUrl: finalAppUrl || null,
      appIcon: fetchedAppIcon || null,
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

// Update target positions (bulk) - MUST be before /api/targets/:id route
router.put('/api/targets/positions', async (req, res) => {
  try {
    const db = getDB();
    const { positions } = req.body; // Array of { targetId, position }

    if (!Array.isArray(positions)) {
      return res.status(400).json({
        success: false,
        error: 'Positions must be an array',
      });
    }

    // Validate all targetIds are provided and trim them
    const missingIds = positions.filter(p => !p.targetId);
    if (missingIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid targetId provided',
      });
    }

    // Invalidate cache to ensure fresh data
    const cacheService = require('../services/cacheService');
    cacheService.invalidateCollection('targets');

    // Validate all targetIds exist by querying them all at once using direct SQL
    // Trim IDs to handle any whitespace issues
    const targetIds = positions.map(p => String(p.targetId).trim()).filter(id => id);
    
    if (targetIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No target IDs provided',
      });
    }
    
    const placeholders = targetIds.map((_, i) => `$${i + 1}`).join(', ');
    const query = `SELECT _id FROM targets WHERE _id IN (${placeholders})`;
    const result = await db.query(query, targetIds);
    
    const existingIds = new Set(result.rows.map(r => r._id));
    const missingTargetIds = targetIds.filter(id => !existingIds.has(id));
    
    if (missingTargetIds.length > 0) {
      console.error('Missing target IDs:', missingTargetIds);
      console.error('Requested IDs:', targetIds);
      console.error('Found IDs:', Array.from(existingIds));
      return res.status(404).json({
        success: false,
        error: `Target not found: ${missingTargetIds[0]}`,
        details: {
          missing: missingTargetIds,
          requested: targetIds.length,
          found: existingIds.size
        }
      });
    }

    // Update all positions (use trimmed IDs)
    const updatePromises = positions.map(({ targetId, position }) =>
      db.collection('targets').updateOne(
        { _id: String(targetId).trim() },
        { $set: { position: position || 0, updatedAt: new Date() } }
      )
    );

    await Promise.all(updatePromises);

    res.json({ success: true, message: 'Positions updated' });
  } catch (error) {
    console.error('Error updating positions:', error);
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
      publicShowStatus,
      publicShowAppLink,
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
    if (publicVisible !== undefined) updateData.publicVisible = Boolean(publicVisible);
    if (publicShowDetails !== undefined) updateData.publicShowDetails = Boolean(publicShowDetails);
    if (publicShowStatus !== undefined) updateData.publicShowStatus = publicShowStatus !== false; // Default to true
    if (publicShowAppLink !== undefined) updateData.publicShowAppLink = publicShowAppLink !== false; // Default to true
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
    
    // Get target details
    const target = await db.collection('targets').findOne({ _id: targetId });
    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
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
    
    const targetWithStatus = {
      ...parsedTarget,
      currentStatus: monitorService.getTargetStatus(targetId),
    };
    const period = req.query.period || null;
    const days = parseFloat(req.query.days) || null;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

    let startDateObj;
    let endDateObj;
    let groupByTrunc;
    let timePeriod;
    let maxPoints;
    let intervalMinutes;

    // Determine time period and grouping
    if (startDate && endDate) {
      // Custom date range
      startDateObj = startDate;
      endDateObj = endDate;
      const diffDays = (endDate - startDate) / (1000 * 60 * 60 * 24);
      
      if (diffDays <= 1) {
        intervalMinutes = 60;
        timePeriod = 'hour';
        maxPoints = 24;
      } else if (diffDays <= 7) {
        intervalMinutes = 60;
        timePeriod = 'hour';
        maxPoints = 168;
      } else {
        intervalMinutes = 1440; // 1 day
        timePeriod = 'day';
        maxPoints = diffDays;
      }
    } else if (period) {
      // Use period parameter
      endDateObj = new Date();
      
      if (period === '1h') {
        // 1H: 60 data points (one per minute)
        startDateObj = new Date();
        startDateObj.setHours(startDateObj.getHours() - 1);
        intervalMinutes = 1;
        timePeriod = 'minute';
        maxPoints = 60;
      } else if (period === '24h') {
        // 24H: 48 data points (every 30 minutes)
        startDateObj = new Date();
        startDateObj.setHours(startDateObj.getHours() - 24);
        intervalMinutes = 30;
        timePeriod = '30min';
        maxPoints = 48;
      } else if (period === '7d') {
        // 7D: 56 data points (every 3 hours)
        startDateObj = new Date();
        startDateObj.setDate(startDateObj.getDate() - 7);
        intervalMinutes = 180; // 3 hours
        timePeriod = '3hour';
        maxPoints = 56;
      } else if (period === '30d') {
        // 30D: 60 data points (every 12 hours)
        startDateObj = new Date();
        startDateObj.setDate(startDateObj.getDate() - 30);
        intervalMinutes = 720; // 12 hours
        timePeriod = '12hour';
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
          timePeriod = 'custom';
          maxPoints = 60;
        } else {
          // No data, return empty
          return res.json({ success: true, statistics: [] });
        }
      } else {
        // Unknown period, default to 24h
        startDateObj = new Date();
        startDateObj.setHours(startDateObj.getHours() - 24);
        intervalMinutes = 30;
        timePeriod = '30min';
        maxPoints = 48;
      }
    } else if (days) {
      // Fixed period using days (backward compatibility)
      endDateObj = new Date();
      startDateObj = new Date();
      startDateObj.setDate(startDateObj.getDate() - days);
      
      if (days <= 1) {
        intervalMinutes = 60;
        timePeriod = 'hour';
        maxPoints = 24;
      } else if (days <= 7) {
        intervalMinutes = 60;
        timePeriod = 'hour';
        maxPoints = 168;
      } else {
        intervalMinutes = 1440; // 1 day
        timePeriod = 'day';
        maxPoints = days;
      }
    } else {
      // Default to last 24h
      endDateObj = new Date();
      startDateObj = new Date();
      startDateObj.setHours(startDateObj.getHours() - 24);
      intervalMinutes = 30;
      timePeriod = '30min';
      maxPoints = 48;
    }

    // Generate evenly spaced time buckets and aggregate data into them
    // This ensures we always get the exact number of points requested
    const intervalSeconds = intervalMinutes * 60;
    const startEpoch = Math.floor(startDateObj.getTime() / 1000);
    const endEpoch = Math.floor(endDateObj.getTime() / 1000);
    
    // Debug: Check if we have any ping results in the time range
    // Convert dates to ISO strings for PostgreSQL
    const startDateStr = startDateObj.toISOString().replace('T', ' ').substring(0, 19);
    const endDateStr = endDateObj.toISOString().replace('T', ' ').substring(0, 19);
    
    const debugCheck = await db.query(`
      SELECT COUNT(*) as count, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
      FROM "pingResults"
      WHERE "targetId" = $1 AND timestamp >= $2::timestamp AND timestamp <= $3::timestamp
    `, [targetId, startDateStr, endDateStr]);
    
    // Also check all ping results for this target
    const allPingsCheck = await db.query(`
      SELECT COUNT(*) as count, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
      FROM "pingResults"
      WHERE "targetId" = $1
    `, [targetId]);
    
    // Check admin settings for debug logging
    const adminSettings = await db.collection('adminSettings').findOne({ _id: 'settings' });
    const debugLogging = adminSettings?.debugLogging === true;
    
    if (debugLogging || process.env.DEBUG_STATS || process.env.NODE_ENV === 'development') {
      console.log(chalk.cyan(`[Stats Debug] Target: ${targetId}, Period: ${period || 'default'}`));
      console.log(chalk.gray(`  Time range: ${startDateObj.toISOString()} to ${endDateObj.toISOString()}`));
      console.log(chalk.gray(`  Epoch range: ${startEpoch} to ${endEpoch}, interval: ${intervalSeconds}s`));
      console.log(chalk.gray(`  All ping results for target: ${allPingsCheck.rows[0]?.count || 0}`));
      if (allPingsCheck.rows[0]?.min_ts) {
        console.log(chalk.gray(`  All pings - Min: ${allPingsCheck.rows[0].min_ts}, Max: ${allPingsCheck.rows[0].max_ts}`));
      }
      console.log(chalk.gray(`  Ping results in query range: ${debugCheck.rows[0]?.count || 0}`));
      if (debugCheck.rows[0]?.min_ts) {
        console.log(chalk.gray(`  Query range - Min: ${debugCheck.rows[0].min_ts}, Max: ${debugCheck.rows[0].max_ts}`));
      }
    }
    
    // Generate time buckets using generate_series
    // Use AT TIME ZONE 'UTC' to ensure bucket_time is in UTC before casting to timestamp
    const result = await db.query(`
      WITH time_buckets AS (
        SELECT 
          (to_timestamp(bucket_epoch) AT TIME ZONE 'UTC')::timestamp as bucket_time
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
        AND pr.timestamp < (time_buckets.bucket_time + ($5 || ' seconds')::interval)
      GROUP BY time_buckets.bucket_time
      ORDER BY time_buckets.bucket_time ASC
    `, [targetId, startEpoch, endEpoch, maxPoints, intervalSeconds]);
    
    // Get last response time separately
    const lastResponseResult = await db.query(`
      SELECT "responseTime" FROM "pingResults" 
      WHERE "targetId" = $1 AND timestamp >= $2::timestamp AND timestamp <= $3::timestamp
      ORDER BY timestamp DESC LIMIT 1
    `, [targetId, startDateStr, endDateStr]);

    const results = result.rows; // Already in chronological order
    const lastResponse = lastResponseResult.rows[0] || null;
    
    // Debug: Log query results
    if (debugLogging || process.env.DEBUG_STATS || process.env.NODE_ENV === 'development') {
      console.log(chalk.gray(`  Query returned ${results.length} time buckets`));
      if (results.length > 0) {
        const bucketsWithData = results.filter(r => r.totalPings > 0);
        console.log(chalk.gray(`  Buckets with data: ${bucketsWithData.length}`));
        if (bucketsWithData.length > 0) {
          console.log(chalk.gray(`  First bucket with data: ${bucketsWithData[0].date}, pings: ${bucketsWithData[0].totalPings}`));
        }
      }
    }

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
      target: targetWithStatus, // Include target details
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

// Get target uptime (admin - works for all targets)
router.get('/api/targets/:id/uptime', async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;
    const days = parseInt(req.query.days) || 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Query daily statistics from PostgreSQL
    const statsResult = await db.query(`
      SELECT 
        date::date as date,
        "totalPings",
        "successfulPings",
        "failedPings",
        uptime
      FROM statistics
      WHERE "targetId" = $1 AND date >= $2
      ORDER BY date ASC
    `, [targetId, startDate]);

    const stats = statsResult.rows;
    let totalPings = 0;
    let successfulPings = 0;

    stats.forEach(stat => {
      totalPings += stat.totalPings || 0;
      successfulPings += stat.successfulPings || 0;
    });

    const uptime = totalPings > 0 ? (successfulPings / totalPings) * 100 : 0;

    res.json({ 
      success: true, 
      uptime,
      totalPings,
      successfulPings,
      failedPings: totalPings - successfulPings,
      dailyStats: stats // Include daily stats for blocks
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test target (admin)
router.post('/api/targets/:id/test', async (req, res) => {
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

    const pingService = require('../services/pingService');
    
    // Execute ping with timeout
    const pingPromise = pingService.ping(target);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Ping timeout')), 55000); // 55 seconds
    });
    
    const result = await Promise.race([pingPromise, timeoutPromise]);

    clearTimeout(timeout);

    // Update status in monitorService to reflect the test result
    let newStatus = 'unknown';
    
    // Determine status based on ping result and upside down mode
    let pingSuccess = result.success;
    if (target.upsideDown === true) {
      pingSuccess = !pingSuccess; // Invert the status
    }
    
    if (pingSuccess) {
      newStatus = 'up';
    } else {
      newStatus = 'down';
    }
    
    // Update the status in monitorService
    monitorService.setTargetStatus(targetId, newStatus);

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

// Clear cache
router.post('/api/cache/clear', async (req, res) => {
  try {
    const cacheService = require('../services/cacheService');
    cacheService.clear();
    res.json({ success: true, message: 'Cache cleared' });
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

    // Clear pingResults from database
    const pingResultsDeleted = await db.collection('pingResults').deleteMany({});
    
    // Clear statistics from database
    const statisticsDeleted = await db.collection('statistics').deleteMany({});

    res.json({ 
      success: true, 
      message: 'All ping data cleared successfully',
      details: {
        pingResults: pingResultsDeleted.deletedCount || 0,
        statistics: statisticsDeleted.deletedCount || 0
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

    // Ensure debugLogging exists (for migration)
    if (settings.debugLogging === undefined) {
      settings.debugLogging = false;
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
    const { sessionDurationDays, dataRetentionDays, debugLogging } = req.body;

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

    if (debugLogging !== undefined) {
      updateData.debugLogging = debugLogging === true || debugLogging === 'true';
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
        debugLogging: debugLogging !== undefined ? (debugLogging === true || debugLogging === 'true') : false,
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
