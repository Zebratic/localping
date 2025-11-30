const express = require('express');
const router = express.Router();
const { getPrisma } = require('../config/prisma');
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
    const prisma = getPrisma();
    const targets = await prisma.target.findMany();

    const targetsWithStatus = targets.map((target) => ({
      ...target,
      _id: target.id,
      currentStatus: monitorService.getTargetStatus(target.id),
    }));

    res.json({ success: true, targets: targetsWithStatus });
  } catch (error) {
    console.error(chalk.red('Error fetching targets:'), error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get target by ID
router.get('/targets/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const target = await prisma.target.findUnique({ where: { id: req.params.id } });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    res.json({
      success: true,
      target: { ...target, _id: target.id, currentStatus: monitorService.getTargetStatus(target.id) },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create target
router.post('/targets', validateTargetInput, async (req, res) => {
  try {
    const prisma = getPrisma();
    const faviconService = require('../services/faviconService');

    const {
      name, host, port, protocol, interval, enabled, path, appUrl, appIcon,
      retries, retryInterval, timeout, httpMethod, statusCodes, maxRedirects,
      ignoreSsl, upsideDown, auth, position, group, quickCommands,
    } = req.body;

    if (!name || !host || !protocol) {
      return res.status(400).json({ success: false, error: 'Missing required fields: name, host, protocol' });
    }

    const protocolLower = protocol.toUpperCase();
    const defaultPort = protocolLower === 'HTTPS' ? 443 : protocolLower === 'HTTP' ? 80 : null;
    const targetPort = port || defaultPort;
    const targetPath = path || '/';
    const targetUrl = targetPort && targetPort !== defaultPort
      ? `${protocolLower.toLowerCase()}://${host}:${targetPort}${targetPath}`
      : `${protocolLower.toLowerCase()}://${host}${targetPath}`;

    let fetchedAppIcon = appIcon;
    let finalAppUrl = appUrl;

    if ((protocolLower === 'HTTP' || protocolLower === 'HTTPS') && !appIcon) {
      try {
        let authObj = auth;
        if (auth && typeof auth === 'string') {
          try { authObj = JSON.parse(auth); } catch (e) { authObj = null; }
        }

        const faviconUrl = await faviconService.getFaviconUrlFromHtml(targetUrl, {
          timeout: (timeout || 30) * 1000,
          maxRedirects: maxRedirects !== undefined ? maxRedirects : 5,
          ignoreSsl: ignoreSsl === true,
          auth: authObj,
        });

        if (faviconUrl) {
          fetchedAppIcon = faviconUrl;
          if (!finalAppUrl) finalAppUrl = targetUrl;
        }
      } catch (error) {
        console.error(`Failed to fetch favicon for ${targetUrl}:`, error.message);
      }
    }

    const target = await prisma.target.create({
      data: {
        name, host, port: port || null, protocol: protocol.toUpperCase(), path: path || null,
        interval: interval || 60, enabled: enabled !== false, appUrl: finalAppUrl || null,
        appIcon: fetchedAppIcon || null, retries: retries !== undefined ? retries : 0,
        retryInterval: retryInterval !== undefined ? retryInterval : 5,
        timeout: timeout !== undefined ? timeout : 30, httpMethod: httpMethod || 'GET',
        statusCodes: statusCodes || '200-299', maxRedirects: maxRedirects !== undefined ? maxRedirects : 5,
        ignoreSsl: ignoreSsl === true, upsideDown: upsideDown === true, auth: auth || null,
        position: position !== undefined ? position : 0, group: group || null, quickCommands: quickCommands || [],
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

// Update target
router.put('/targets/:id', validateTargetInput, async (req, res) => {
  try {
    const prisma = getPrisma();
    const targetId = req.params.id;

    const {
      name, host, port, protocol, interval, enabled, path, appUrl, appIcon,
      retries, retryInterval, timeout, httpMethod, statusCodes, maxRedirects,
      ignoreSsl, upsideDown, auth, position, group, quickCommands,
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (host !== undefined) updateData.host = host;
    if (port !== undefined) updateData.port = port;
    if (protocol !== undefined) updateData.protocol = protocol.toUpperCase();
    if (interval !== undefined) updateData.interval = interval;
    if (path !== undefined) updateData.path = path;
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

    await prisma.target.update({ where: { id: targetId }, data: updateData });

    if (enabled !== undefined) {
      if (enabled) {
        const target = await prisma.target.findUnique({ where: { id: targetId } });
        monitorService.startTargetMonitor({ ...target, _id: target.id });
      } else {
        monitorService.stopTargetMonitor(targetId);
      }
      await prisma.target.update({ where: { id: targetId }, data: { enabled } });
    }

    res.json({ success: true, message: 'Target updated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Target not found' });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete target
router.delete('/targets/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targetId = req.params.id;

    monitorService.stopTargetMonitor(targetId);
    await prisma.target.delete({ where: { id: targetId } });
    // Cascade delete handles pingResults, alerts, statistics

    res.json({ success: true, message: 'Target deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Target not found' });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get ping results for target
router.get('/targets/:id/results', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targetId = req.params.id;
    const limit = parseInt(req.query.limit) || 100;
    const skip = parseInt(req.query.skip) || 0;

    const results = await prisma.pingResult.findMany({
      where: { targetId },
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: skip,
    });

    const count = await prisma.pingResult.count({ where: { targetId } });

    res.json({
      success: true,
      results: results.map(r => ({ ...r, _id: r.id })),
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
    const prisma = getPrisma();
    const targetId = req.params.id;
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

    const uptime24hStart = new Date();
    uptime24hStart.setDate(uptime24hStart.getDate() - 1);
    const uptime30dStart = new Date();
    uptime30dStart.setDate(uptime30dStart.getDate() - 30);

    const dailyStats = await prisma.statistic.findMany({
      where: { targetId, date: { gte: uptime30dStart } },
      orderBy: { date: 'asc' },
    });

    let totalPings24h = 0, successfulPings24h = 0;
    let totalPings30d = 0, successfulPings30d = 0;

    dailyStats.forEach(stat => {
      totalPings30d += stat.totalPings || 0;
      successfulPings30d += stat.successfulPings || 0;
      if (new Date(stat.date) >= uptime24hStart) {
        totalPings24h += stat.totalPings || 0;
        successfulPings24h += stat.successfulPings || 0;
      }
    });

    res.json({
      success: true,
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
      dailyStats: dailyStats.map(s => ({ ...s, _id: s.id })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get alerts
router.get('/alerts', async (req, res) => {
  try {
    const prisma = getPrisma();
    const limit = parseInt(req.query.limit) || 50;
    const targetId = req.query.targetId || null;

    const where = targetId ? { targetId } : {};
    const alerts = await prisma.alert.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    res.json({ success: true, alerts: alerts.map(a => ({ ...a, _id: a.id })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test ping a target
router.post('/targets/:id/test', async (req, res) => {
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

    const result = await pingService.ping({ ...target, _id: target.id });
    clearTimeout(timeout);

    if (!res.headersSent) res.json({ success: result.success, result });
  } catch (error) {
    clearTimeout(timeout);
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
  }
});

// Execute action
router.post('/actions/:id/execute', async (req, res) => {
  try {
    const prisma = getPrisma();
    const action = await prisma.action.findUnique({ where: { id: req.params.id } });

    if (!action) {
      return res.status(404).json({ success: false, error: 'Action not found' });
    }

    const result = await actionService.executeAction(action);
    res.json({ success: result.success, result });
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
    const prisma = getPrisma();

    const targetCount = await prisma.target.count();
    const enabledCount = await prisma.target.count({ where: { enabled: true } });
    const recentAlerts = await prisma.alert.findMany({
      orderBy: { timestamp: 'desc' },
      take: 10,
    });

    res.json({
      success: true,
      status: {
        totalTargets: targetCount,
        enabledTargets: enabledCount,
        activeMonitors: monitorService.getActiveMonitors().length,
        gateway: gatewayService.getPrimaryGateway(),
      },
      recentAlerts: recentAlerts.map(a => ({ ...a, _id: a.id })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
