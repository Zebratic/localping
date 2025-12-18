const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getPrisma } = require('../config/prisma');
const monitorService = require('../services/monitorService');
const IncidentService = require('../services/incidentService');
const { adminPageAuth } = require('../middleware/auth');
const chalk = require('../utils/colors');
const { v4: uuidv4 } = require('uuid');

// Admin login page (GET)
router.get('/login', (req, res) => {
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
    return res.status(401).json({ success: false, error: 'Admin authentication not configured' });
  }

  const providedUsername = (username || '').trim();
  const providedPassword = (password || '').trim();
  const storedUsername = (adminUsername || '').trim();
  const storedPassword = (adminPassword || '').trim();

  if (providedUsername === storedUsername && providedPassword === storedPassword) {
    const prisma = getPrisma();
    let sessionDurationDays = 30;
    try {
      const settings = await prisma.adminSettings.findUnique({ where: { id: 'settings' } });
      if (settings?.sessionDurationDays) {
        sessionDurationDays = settings.sessionDurationDays;
      }
    } catch (error) {
      console.error('Error loading session duration:', error);
    }

    req.session.adminAuthenticated = true;
    req.session.loginTime = new Date();
    req.session.username = providedUsername;

    const maxAge = sessionDurationDays * 24 * 60 * 60 * 1000;
    req.session.cookie.maxAge = maxAge;
    req.session.cookie.expires = new Date(Date.now() + maxAge);

    return res.json({ success: true, message: 'Authenticated' });
  } else {
    return res.status(401).json({ success: false, error: 'Invalid username or password' });
  }
});

// Admin logout
router.get('/logout', (req, res) => {
  req.session.adminAuthenticated = false;
  req.session.destroy((err) => {
    if (err) console.error('Error destroying session:', err);
    res.redirect('/admin/login');
  });
});

// Admin dashboard - Monitors tab (default)
router.get('/', adminPageAuth, (req, res) => {
  res.render('admin/index', { currentTab: 'monitors' });
});

// Admin Incidents tab
router.get('/incidents', adminPageAuth, (req, res) => {
  res.render('admin/index', { currentTab: 'incidents' });
});

// Admin Event Detection Rules tab
router.get('/events', adminPageAuth, (req, res) => {
  res.render('admin/index', { currentTab: 'event-rules' });
});

// Admin Blog Posts tab
router.get('/blogs', adminPageAuth, (req, res) => {
  res.render('admin/index', { currentTab: 'posts' });
});

// Admin Public Visibility tab
router.get('/visibility', adminPageAuth, (req, res) => {
  res.render('admin/index', { currentTab: 'visibility' });
});

// Admin Settings tab
router.get('/settings', adminPageAuth, (req, res) => {
  res.render('admin/index', { currentTab: 'settings' });
});

// Admin Backup & Restore tab
router.get('/backup', adminPageAuth, (req, res) => {
  res.render('admin/index', { currentTab: 'backup' });
});

// Proxy endpoint for icons
router.get('/api/proxy-icon', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'URL parameter is required' });

    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid URL' });
    }

    const https = require('https');
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      validateStatus: (status) => status < 500,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    if (response.status >= 400) {
      return res.status(404).json({ success: false, error: 'Icon not found' });
    }

    const contentType = response.headers['content-type'] || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(response.data));
  } catch (error) {
    console.error('Error proxying icon:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch icon' });
  }
});

// Apply auth middleware to all admin API routes (except proxy-icon)
router.use('/api', (req, res, next) => {
  if (req.path === '/proxy-icon') return next();
  adminPageAuth(req, res, next);
});

// Dashboard API
router.get('/api/dashboard', async (req, res) => {
  try {
    const prisma = getPrisma();

    const targets = await prisma.target.findMany({
      select: {
        id: true,
        name: true,
        host: true,
        protocol: true,
        port: true,
        enabled: true,
        publicVisible: true,
        appUrl: true,
        appIcon: true,
        group: true,
        position: true,
        interval: true,
        retries: true,
        timeout: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const targetsWithStatus = targets.map((target) => ({
      ...target,
      _id: target.id,
      currentStatus: monitorService.getTargetStatus(target.id),
    }));

    const alerts = await prisma.alert.findMany({
      orderBy: { timestamp: 'desc' },
      take: 20,
      select: {
        id: true,
        targetId: true,
        type: true,
        timestamp: true,
        message: true,
      },
    });

    res.json({
      success: true,
      dashboard: {
        targets: targetsWithStatus,
        recentAlerts: alerts.map(a => ({ ...a, _id: a.id })),
        timestamp: new Date(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ ACTIONS ============
router.get('/api/actions', async (req, res) => {
  try {
    const prisma = getPrisma();
    const actions = await prisma.action.findMany();
    res.json({ success: true, actions: actions.map(a => ({ ...a, _id: a.id })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/actions/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const action = await prisma.action.findUnique({ where: { id: req.params.id } });
    if (!action) return res.status(404).json({ success: false, error: 'Action not found' });
    res.json({ success: true, action: { ...action, _id: action.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/actions', async (req, res) => {
  try {
    const { name, type, targetId, command } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, error: 'Missing required fields' });

    const prisma = getPrisma();
    const action = await prisma.action.create({
      data: { name, type, targetId: targetId || null, command: command || null },
    });

    res.json({ success: true, actionId: action.id, action: { ...action, _id: action.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/actions/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    await prisma.action.update({ where: { id: req.params.id }, data: req.body });
    res.json({ success: true, message: 'Action updated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Action not found' });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/api/actions/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    await prisma.action.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Action deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Action not found' });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/actions/:id/execute', async (req, res) => {
  try {
    const prisma = getPrisma();
    const action = await prisma.action.findUnique({ where: { id: req.params.id } });
    if (!action) return res.status(404).json({ success: false, error: 'Action not found' });

    const actionService = require('../services/actionService');
    const result = await actionService.executeAction(action);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ INCIDENTS ============
router.get('/api/incidents', async (req, res) => {
  try {
    const prisma = getPrisma();
    const incidentService = new IncidentService(prisma);
    const incidents = await incidentService.getIncidents();
    res.json({ success: true, incidents: incidents.map(i => ({ ...i, _id: i.id })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/incidents/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const incidentService = new IncidentService(prisma);
    const incident = await incidentService.getIncidentById(req.params.id);
    if (!incident) return res.status(404).json({ success: false, error: 'Incident not found' });
    res.json({ success: true, incident: { ...incident, _id: incident.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/incidents', async (req, res) => {
  try {
    const prisma = getPrisma();
    const incidentService = new IncidentService(prisma);
    const { title, description, status, severity, affectedServices, isScheduled, scheduledStart, scheduledEnd } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, error: 'Title and description are required' });
    }

    // Ensure isScheduled is a boolean
    const isScheduledBool = isScheduled === true || isScheduled === 'true' || isScheduled === 1;
    
    const result = await incidentService.createIncident({ 
      title, 
      description, 
      status, 
      severity, 
      affectedServices,
      isScheduled: isScheduledBool,
      scheduledStart,
      scheduledEnd
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/incidents/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const incidentService = new IncidentService(prisma);
    const { title, description, status, severity, affectedServices, updateMessage, isScheduled, scheduledStart, scheduledEnd } = req.body;

    // Ensure isScheduled is a boolean
    const isScheduledBool = isScheduled === true || isScheduled === 'true' || isScheduled === 1;

    const updated = await incidentService.updateIncident(req.params.id, {
      title, description, status, severity, affectedServices, updateMessage,
      isScheduled: isScheduledBool, scheduledStart, scheduledEnd
    });

    if (!updated) return res.status(404).json({ success: false, error: 'Incident not found' });
    res.json({ success: true, message: 'Incident updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/api/incidents/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const incidentService = new IncidentService(prisma);
    const deleted = await incidentService.deleteIncident(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Incident not found' });
    res.json({ success: true, message: 'Incident deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ EVENT RULES ============
router.get('/api/event-rules', async (req, res) => {
  try {
    const prisma = getPrisma();
    const rules = await prisma.eventRule.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, rules: rules.map(r => ({ ...r, _id: r.id })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/event-rules/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const rule = await prisma.eventRule.findUnique({ where: { id: req.params.id } });
    if (!rule) return res.status(404).json({ success: false, error: 'Event rule not found' });
    res.json({ success: true, rule: { ...rule, _id: rule.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/event-rules', async (req, res) => {
  try {
    const prisma = getPrisma();
    const {
      name, eventType, enabled, conditions, incidentTitle, incidentDescription,
      incidentSeverity, incidentStatus, autoResolve, autoResolveMessage, cooldownMinutes,
    } = req.body;

    if (!name || !eventType || !conditions || !incidentTitle || !incidentDescription) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const rule = await prisma.eventRule.create({
      data: {
        name, eventType, enabled: enabled !== false, conditions,
        incidentTitle, incidentDescription,
        incidentSeverity: incidentSeverity || 'major',
        incidentStatus: incidentStatus || 'investigating',
        autoResolve: autoResolve === true,
        autoResolveMessage: autoResolveMessage || null,
        cooldownMinutes: cooldownMinutes || 0,
      },
    });

    res.json({ success: true, ruleId: rule.id, rule: { ...rule, _id: rule.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/event-rules/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const updateData = { ...req.body };
    delete updateData.id;
    delete updateData._id;

    await prisma.eventRule.update({ where: { id: req.params.id }, data: updateData });
    res.json({ success: true, message: 'Event rule updated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Event rule not found' });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/api/event-rules/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    await prisma.eventRule.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Event rule deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Event rule not found' });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/event-rules/:id/test', async (req, res) => {
  try {
    const prisma = getPrisma();
    const eventDetectionService = require('../services/eventDetectionService');
    await eventDetectionService.initialize();

    const rule = await prisma.eventRule.findUnique({ where: { id: req.params.id } });
    if (!rule) return res.status(404).json({ success: false, error: 'Event rule not found' });

    const context = req.body.context || {};
    const shouldTrigger = await eventDetectionService.evaluateRule(rule, context);
    res.json({ success: true, shouldTrigger, context });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ TARGETS ============
router.get('/api/targets', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targets = await prisma.target.findMany();

    const targetsWithStatus = targets.map((target) => ({
      ...target,
      _id: target.id,
      currentStatus: monitorService.getTargetStatus(target.id),
    }));

    res.json({ success: true, targets: targetsWithStatus });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/targets/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const target = await prisma.target.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ success: false, error: 'Target not found' });

    res.json({
      success: true,
      target: { ...target, _id: target.id, currentStatus: monitorService.getTargetStatus(target.id) },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/targets', async (req, res) => {
  try {
    const {
      name, host, port, protocol, path, interval, enabled, publicVisible,
      publicShowDetails, publicShowStatus, publicShowAppLink, appUrl, appIcon,
      retries, retryInterval, timeout, httpMethod, statusCodes, maxRedirects,
      ignoreSsl, upsideDown, important, auth, position, group, quickCommands,
    } = req.body;

    if (!name || !host || !protocol) {
      return res.status(400).json({ success: false, error: 'Missing required fields: name, host, protocol' });
    }

    const prisma = getPrisma();
    const target = await prisma.target.create({
      data: {
        name, host, port: port || null, protocol: protocol.toUpperCase(), path: path || null,
        interval: interval || 60, enabled: enabled !== false, publicVisible: publicVisible !== false,
        publicShowDetails: publicShowDetails === true, publicShowStatus: publicShowStatus !== false,
        publicShowAppLink: publicShowAppLink !== false, appUrl: appUrl || null, appIcon: appIcon || null,
        retries: retries || 0, retryInterval: retryInterval || 5, timeout: timeout || 30,
        httpMethod: httpMethod || 'GET', statusCodes: statusCodes || '200-299',
        maxRedirects: maxRedirects !== undefined ? maxRedirects : 5, ignoreSsl: ignoreSsl === true,
        upsideDown: upsideDown === true, important: important === true, auth: auth || null, position: position || 0,
        group: group || null, quickCommands: quickCommands || null,
      },
    });

    if (target.enabled) {
      monitorService.startTargetMonitor({ ...target, _id: target.id });
    }

    res.json({ success: true, targetId: target.id, target: { ...target, _id: target.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/targets/positions', async (req, res) => {
  try {
    const prisma = getPrisma();
    const { positions } = req.body;

    if (!Array.isArray(positions)) {
      return res.status(400).json({ success: false, error: 'Positions must be an array' });
    }

    const cacheService = require('../services/cacheService');
    cacheService.invalidateCollection('targets');

    for (const { targetId, position } of positions) {
      await prisma.target.update({
        where: { id: String(targetId).trim() },
        data: { position: position || 0 },
      });
    }

    res.json({ success: true, message: 'Positions updated' });
  } catch (error) {
    console.error('Error updating positions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/targets/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targetId = req.params.id;
    const { enabled, ...updateData } = req.body;

    delete updateData.id;
    delete updateData._id;

    if (updateData.protocol) updateData.protocol = updateData.protocol.toUpperCase();

    await prisma.target.update({ where: { id: targetId }, data: updateData });

    if (enabled !== undefined) {
      if (enabled) {
        const target = await prisma.target.findUnique({ where: { id: targetId } });
        monitorService.startTargetMonitor({ ...target, _id: target.id });
      } else {
        monitorService.stopTargetMonitor(targetId);
      }
      await prisma.target.update({ where: { id: targetId }, data: { enabled } });
    } else {
      const target = await prisma.target.findUnique({ where: { id: targetId } });
      if (target?.enabled) {
        monitorService.stopTargetMonitor(targetId);
        monitorService.startTargetMonitor({ ...target, _id: target.id });
      }
    }

    res.json({ success: true, message: 'Target updated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Target not found' });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/api/targets/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targetId = req.params.id;

    monitorService.stopTargetMonitor(targetId);
    
    // Manually delete related data to avoid foreign key constraint issues
    await prisma.pingResult.deleteMany({ where: { targetId } });
    await prisma.alert.deleteMany({ where: { targetId } });
    await prisma.statistic.deleteMany({ where: { targetId } });
    await prisma.action.deleteMany({ where: { targetId } });
    
    // Now delete the target
    await prisma.target.delete({ where: { id: targetId } });

    res.json({ success: true, message: 'Target deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Target not found' });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/targets/:id/statistics', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targetId = req.params.id;

    const target = await prisma.target.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ success: false, error: 'Target not found' });

    const targetWithStatus = {
      ...target, _id: target.id,
      currentStatus: monitorService.getTargetStatus(targetId),
    };

    const period = req.query.period || '24h';
    let startDateObj = new Date();
    let endDateObj = new Date();
    let intervalMinutes = 30;
    let maxPoints = 48;

    if (period === '1h') {
      startDateObj.setHours(startDateObj.getHours() - 1);
      intervalMinutes = 1;
      maxPoints = 60;
    } else if (period === '24h') {
      startDateObj.setHours(startDateObj.getHours() - 24);
      intervalMinutes = 30;
      maxPoints = 48;
    } else if (period === '7d') {
      startDateObj.setDate(startDateObj.getDate() - 7);
      intervalMinutes = 180;
      maxPoints = 56;
    } else if (period === '30d') {
      startDateObj.setDate(startDateObj.getDate() - 30);
      intervalMinutes = 720;
      maxPoints = 60;
    } else if (period === 'all' || period === 'ALL') {
      // For ALL period, use daily statistics (much more efficient)
      const dailyStats = await prisma.statistic.findMany({
        where: { targetId },
        orderBy: { date: 'asc' },
        select: {
          date: true,
          totalPings: true,
          successfulPings: true,
          avgResponseTime: true,
        },
      });

      const stats = dailyStats.map(s => ({
        date: s.date.toISOString(),
        totalPings: s.totalPings || 0,
        successfulPings: s.successfulPings || 0,
        failedPings: (s.totalPings || 0) - (s.successfulPings || 0),
        uptime: s.totalPings > 0 ? ((s.successfulPings / s.totalPings) * 100) : 0,
        avgResponseTime: s.avgResponseTime || 0,
      }));

      // Get uptime data using aggregation
      const uptime24hStart = new Date();
      uptime24hStart.setDate(uptime24hStart.getDate() - 1);
      const uptime30dStart = new Date();
      uptime30dStart.setDate(uptime30dStart.getDate() - 30);

      const [uptime24h, uptime30d] = await Promise.all([
        prisma.statistic.aggregate({
          where: { targetId, date: { gte: uptime24hStart } },
          _sum: { totalPings: true, successfulPings: true },
        }),
        prisma.statistic.aggregate({
          where: { targetId, date: { gte: uptime30dStart } },
          _sum: { totalPings: true, successfulPings: true },
        }),
      ]);

      const totalPings24h = uptime24h._sum.totalPings || 0;
      const successfulPings24h = uptime24h._sum.successfulPings || 0;
      const totalPings30d = uptime30d._sum.totalPings || 0;
      const successfulPings30d = uptime30d._sum.successfulPings || 0;

      return res.json({
        success: true,
        target: targetWithStatus,
        statistics: stats,
        uptime: {
          '24h': {
            uptime: totalPings24h > 0 ? (successfulPings24h / totalPings24h) * 100 : 0,
            totalPings: totalPings24h,
            successfulPings: successfulPings24h,
            failedPings: totalPings24h - successfulPings24h,
          },
          '30d': {
            uptime: totalPings30d > 0 ? (successfulPings30d / totalPings30d) * 100 : 0,
            totalPings: totalPings30d,
            successfulPings: successfulPings30d,
            failedPings: totalPings30d - successfulPings30d,
          },
        },
      });
    }

    const intervalSeconds = intervalMinutes * 60;
    const startEpoch = Math.floor(startDateObj.getTime() / 1000);
    const endEpoch = Math.floor(endDateObj.getTime() / 1000);

    const result = await prisma.$queryRaw`
      WITH time_buckets AS (
        SELECT (to_timestamp(bucket_epoch) AT TIME ZONE 'UTC')::timestamp as bucket_time
        FROM generate_series(${startEpoch}::bigint, ${endEpoch}::bigint, ${intervalSeconds}::bigint) as bucket_epoch
        ORDER BY bucket_epoch
        LIMIT ${maxPoints}
      )
      SELECT
        time_buckets.bucket_time::text as date,
        COALESCE(COUNT(pr."_id"), 0)::integer as "totalPings",
        COALESCE(SUM(CASE WHEN pr.success = true THEN 1 ELSE 0 END), 0)::integer as "successfulPings",
        COALESCE(AVG(CASE WHEN pr."responseTime" IS NOT NULL THEN pr."responseTime"::real ELSE NULL END), 0) as "avgResponseTime"
      FROM time_buckets
      LEFT JOIN "pingResults" pr ON
        pr."targetId" = ${targetId}
        AND pr.timestamp >= time_buckets.bucket_time
        AND pr.timestamp < (time_buckets.bucket_time + (${intervalSeconds} || ' seconds')::interval)
      GROUP BY time_buckets.bucket_time
      ORDER BY time_buckets.bucket_time ASC
    `;

    const stats = result.map(r => ({
      date: r.date,
      totalPings: Number(r.totalPings) || 0,
      successfulPings: Number(r.successfulPings) || 0,
      failedPings: (Number(r.totalPings) || 0) - (Number(r.successfulPings) || 0),
      uptime: r.totalPings > 0 ? ((r.successfulPings / r.totalPings) * 100) : 0,
      avgResponseTime: Number(r.avgResponseTime) || 0,
    }));

    // Get uptime data using aggregation (much faster)
    const uptime24hStart = new Date();
    uptime24hStart.setDate(uptime24hStart.getDate() - 1);
    const uptime30dStart = new Date();
    uptime30dStart.setDate(uptime30dStart.getDate() - 30);

    // Use aggregation queries instead of fetching all records
    const [uptime24h, uptime30d] = await Promise.all([
      prisma.statistic.aggregate({
        where: { targetId, date: { gte: uptime24hStart } },
        _sum: { totalPings: true, successfulPings: true },
      }),
      prisma.statistic.aggregate({
        where: { targetId, date: { gte: uptime30dStart } },
        _sum: { totalPings: true, successfulPings: true },
      }),
    ]);

    const totalPings24h = uptime24h._sum.totalPings || 0;
    const successfulPings24h = uptime24h._sum.successfulPings || 0;
    const totalPings30d = uptime30d._sum.totalPings || 0;
    const successfulPings30d = uptime30d._sum.successfulPings || 0;

    res.json({
      success: true,
      target: targetWithStatus,
      statistics: stats,
      uptime: {
        '24h': {
          uptime: totalPings24h > 0 ? (successfulPings24h / totalPings24h) * 100 : 0,
          totalPings: totalPings24h,
          successfulPings: successfulPings24h,
          failedPings: totalPings24h - successfulPings24h,
        },
        '30d': {
          uptime: totalPings30d > 0 ? (successfulPings30d / totalPings30d) * 100 : 0,
          totalPings: totalPings30d,
          successfulPings: successfulPings30d,
          failedPings: totalPings30d - successfulPings30d,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/targets/:id/uptime', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targetId = req.params.id;
    const days = parseInt(req.query.days) || 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await prisma.statistic.findMany({
      where: { targetId, date: { gte: startDate } },
      orderBy: { date: 'asc' },
    });

    let totalPings = 0, successfulPings = 0;
    stats.forEach(stat => {
      totalPings += stat.totalPings || 0;
      successfulPings += stat.successfulPings || 0;
    });

    res.json({
      success: true,
      uptime: totalPings > 0 ? (successfulPings / totalPings) * 100 : 0,
      totalPings,
      successfulPings,
      failedPings: totalPings - successfulPings,
      dailyStats: stats.map(s => ({ ...s, _id: s.id })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/targets/:id/test', async (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ success: false, error: 'Test timeout' });
  }, 60000);

  try {
    const prisma = getPrisma();
    const target = await prisma.target.findUnique({ where: { id: req.params.id } });
    if (!target) {
      clearTimeout(timeout);
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    const testTarget = { ...target, ...req.body, _id: target.id };
    const pingService = require('../services/pingService');
    const result = await pingService.ping(testTarget);

    clearTimeout(timeout);

    let pingSuccess = result.success;
    if (testTarget.upsideDown === true) pingSuccess = !pingSuccess;
    monitorService.setTargetStatus(target.id, pingSuccess ? 'up' : 'down');

    if (!res.headersSent) res.json({ success: result.success, result });
  } catch (error) {
    clearTimeout(timeout);
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/cache/clear', async (req, res) => {
  try {
    const cacheService = require('../services/cacheService');
    cacheService.clear();
    res.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ POSTS ============
router.get('/api/posts', async (req, res) => {
  try {
    const prisma = getPrisma();
    const posts = await prisma.post.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, posts: posts.map(p => ({ ...p, _id: p.id })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/posts/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    res.json({ success: true, post: { ...post, _id: post.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/posts', async (req, res) => {
  try {
    const { title, content, published } = req.body;
    if (!title || !content) return res.status(400).json({ success: false, error: 'Title and content are required' });

    const prisma = getPrisma();
    const post = await prisma.post.create({
      data: { title, content, published: published !== false },
    });

    res.json({ success: true, post: { ...post, _id: post.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/posts/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const { title, content, published } = req.body;
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (published !== undefined) updateData.published = published === true;

    await prisma.post.update({ where: { id: req.params.id }, data: updateData });
    res.json({ success: true, message: 'Post updated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Post not found' });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/api/posts/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    await prisma.post.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Post deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Post not found' });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ DATA MANAGEMENT ============
router.post('/api/clear-ping-data', async (req, res) => {
  try {
    const prisma = getPrisma();
    const pingResults = await prisma.pingResult.deleteMany({});
    const statistics = await prisma.statistic.deleteMany({});

    res.json({
      success: true,
      message: 'All ping data cleared',
      details: { pingResults: pingResults.count, statistics: statistics.count },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear ping data for specific monitor
router.post('/api/targets/:id/clear-ping-data', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targetId = req.params.id;

    // Verify target exists
    const target = await prisma.target.findUnique({ where: { id: targetId } });
    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    // Clear pingResults for this target
    const pingResults = await prisma.pingResult.deleteMany({ where: { targetId: targetId } });

    // Clear statistics for this target
    const statistics = await prisma.statistic.deleteMany({ where: { targetId: targetId } });

    res.json({
      success: true,
      message: `Ping data cleared for ${target.name}`,
      details: { pingResults: pingResults.count, statistics: statistics.count },
    });
  } catch (error) {
    console.error('Error clearing ping data for target:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ ADMIN SETTINGS ============
router.get('/api/admin-settings', async (req, res) => {
  try {
    const prisma = getPrisma();
    let settings = await prisma.adminSettings.findUnique({ where: { id: 'settings' } });

    if (!settings) {
      settings = { id: 'settings', _id: 'settings', sessionDurationDays: 30, dataRetentionDays: 30, debugLogging: false };
    } else {
      settings = { ...settings, _id: settings.id };
    }

    // Get database size
    let dbSize = 0;
    try {
      const result = await prisma.$queryRaw`SELECT pg_database_size(current_database()) as size`;
      dbSize = Number(result[0]?.size) || 0;
    } catch (dbSizeError) {
      console.error('Error getting database size:', dbSizeError.message);
    }

    res.json({ success: true, settings, dbSize });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/admin-settings', async (req, res) => {
  try {
    const prisma = getPrisma();
    const { sessionDurationDays, dataRetentionDays, debugLogging } = req.body;

    const updateData = {};
    if (sessionDurationDays !== undefined) updateData.sessionDurationDays = parseInt(sessionDurationDays, 10);
    if (dataRetentionDays !== undefined) updateData.dataRetentionDays = parseInt(dataRetentionDays, 10);
    if (debugLogging !== undefined) updateData.debugLogging = debugLogging === true || debugLogging === 'true';

    await prisma.adminSettings.upsert({
      where: { id: 'settings' },
      update: updateData,
      create: { id: 'settings', sessionDurationDays: 30, dataRetentionDays: 30, debugLogging: false, ...updateData },
    });

    res.json({ success: true, message: 'Admin settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ PUBLIC UI SETTINGS ============
router.get('/api/public-ui-settings', async (req, res) => {
  try {
    const prisma = getPrisma();
    let settings = await prisma.publicUISettings.findUnique({ where: { id: 'settings' } });

    if (!settings) {
      settings = { id: 'settings', _id: 'settings', title: 'Homelab', subtitle: 'System Status & Application Dashboard', customCSS: null };
    } else {
      settings = { ...settings, _id: settings.id };
    }

    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/public-ui-settings', async (req, res) => {
  try {
    const prisma = getPrisma();
    const { title, subtitle, customCSS } = req.body;

    await prisma.publicUISettings.upsert({
      where: { id: 'settings' },
      update: { title: title || 'Homelab', subtitle: subtitle || 'System Status & Application Dashboard', customCSS: customCSS || null },
      create: { id: 'settings', title: title || 'Homelab', subtitle: subtitle || 'System Status & Application Dashboard', customCSS: customCSS || null },
    });

    res.json({ success: true, message: 'Public UI settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ NOTIFICATION SETTINGS ============
router.get('/api/notification-settings', async (req, res) => {
  try {
    const prisma = getPrisma();
    let settings = await prisma.notificationSettings.findUnique({ where: { id: 'settings' } });

    if (!settings) {
      settings = {
        id: 'settings', _id: 'settings', enabled: false,
        discord: { enabled: false, webhookUrl: null, username: 'LocalPing', avatarUrl: null },
        events: { monitorDown: true, monitorUp: true, incidentCreated: true, incidentUpdated: true },
      };
    } else {
      settings = { ...settings, _id: settings.id };
    }

    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/notification-settings', async (req, res) => {
  try {
    const prisma = getPrisma();
    const { enabled, discord, events } = req.body;

    const updateData = {};
    if (enabled !== undefined) updateData.enabled = enabled === true;
    if (discord !== undefined) updateData.discord = discord;
    if (events !== undefined) updateData.events = events;

    await prisma.notificationSettings.upsert({
      where: { id: 'settings' },
      update: updateData,
      create: { id: 'settings', enabled: false, discord: null, events: null, ...updateData },
    });

    const notificationService = require('../services/notificationService');
    notificationService.invalidateCache();

    res.json({ success: true, message: 'Notification settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/notification-settings/test', async (req, res) => {
  try {
    const { provider = 'discord' } = req.body;
    const notificationService = require('../services/notificationService');
    const result = await notificationService.testNotification(provider);

    if (result.success) {
      res.json({ success: true, message: 'Test notification sent successfully' });
    } else {
      res.status(400).json({ success: false, error: result.error || 'Failed to send test notification' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ BACKUP/EXPORT ============
router.post('/api/backup/export', async (req, res) => {
  try {
    const backupService = require('../services/backupService');
    const exportData = await backupService.exportData(req.body);
    res.json({ success: true, data: exportData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/backup/import', async (req, res) => {
  try {
    const backupService = require('../services/backupService');
    const { importData, overwrite } = req.body;

    if (!importData?.data) {
      return res.status(400).json({ success: false, error: 'Invalid import data format' });
    }

    const results = await backupService.importData(importData, { overwrite: overwrite === true });
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
