const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getPrisma } = require('../config/prisma');
const monitorService = require('../services/monitorService');
const faviconService = require('../services/faviconService');

// Public status page
router.get('/', async (req, res) => {
  try {
    const prisma = getPrisma();
    let settings = await prisma.publicUISettings.findUnique({ where: { id: 'settings' } });

    if (!settings) {
      settings = { title: 'Homelab', subtitle: 'System Status & Application Dashboard', customCSS: null };
    }

    res.render('public/index', {
      title: settings.title || 'Homelab',
      subtitle: settings.subtitle || 'System Status & Application Dashboard',
      customCSS: settings.customCSS || '',
    });
  } catch (error) {
    res.render('public/index', {
      title: 'Homelab',
      subtitle: 'System Status & Application Dashboard',
      customCSS: '',
    });
  }
});

// Public API - Get all targets (read-only)
router.get('/api/targets', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targets = await prisma.target.findMany({
      where: { enabled: true, publicVisible: true },
    });

    const targetsWithStatus = targets.map((target) => ({
      _id: target.id,
      name: target.name,
      host: target.host,
      protocol: target.protocol,
      currentStatus: monitorService.getTargetStatus(target.id),
    }));

    res.json({ success: true, targets: targetsWithStatus });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Public API - Get target statistics (read-only)
router.get('/api/targets/:id/statistics', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targetId = req.params.id;
    const period = req.query.period || '24h';

    const target = await prisma.target.findFirst({
      where: { id: targetId, enabled: true, publicVisible: true },
    });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

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

    // Get uptime data
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

// Public API - Get target uptime summary (read-only)
router.get('/api/targets/:id/uptime', async (req, res) => {
  try {
    const prisma = getPrisma();
    const targetId = req.params.id;
    const days = parseInt(req.query.days) || 30;

    const target = await prisma.target.findFirst({
      where: { id: targetId, enabled: true, publicVisible: true },
    });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await prisma.statistic.findMany({
      where: { targetId, date: { gte: startDate } },
      orderBy: { date: 'asc' },
    });

    const totalPings = stats.reduce((sum, s) => sum + (s.totalPings || 0), 0);
    const successfulPings = stats.reduce((sum, s) => sum + (s.successfulPings || 0), 0);
    const uptime = totalPings > 0 ? ((successfulPings / totalPings) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      targetName: target.name,
      uptime: parseFloat(uptime),
      daysTracked: days,
      totalPings,
      successfulPings,
      failedPings: totalPings - successfulPings,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Public API - Get overall status
router.get('/api/status', async (req, res) => {
  try {
    const prisma = getPrisma();

    const targets = await prisma.target.findMany({
      where: { enabled: true, publicVisible: true },
    });

    const targetsWithStatus = await Promise.all(targets.map(async (target) => {
      let favicon = null;

      if (target.appUrl) {
        const cachedFavicon = await prisma.favicon.findUnique({ where: { appUrl: target.appUrl } });
        if (cachedFavicon) {
          favicon = cachedFavicon.favicon;
        } else {
          // Fetch favicon in background (non-blocking)
          faviconService.getFavicon(target.appUrl)
            .then(async (newFavicon) => {
              if (newFavicon) {
                await prisma.favicon.upsert({
                  where: { appUrl: target.appUrl },
                  update: { favicon: newFavicon, updatedAt: new Date() },
                  create: { appUrl: target.appUrl, favicon: newFavicon, updatedAt: new Date() },
                });
              }
            })
            .catch(() => {});
        }
      }

      return {
        _id: target.id,
        name: target.name,
        host: target.host,
        protocol: target.protocol,
        appUrl: target.appUrl,
        appIcon: target.appIcon || null,
        favicon: favicon,
        currentStatus: monitorService.getTargetStatus(target.id),
        isUp: monitorService.getTargetStatus(target.id) === 'up',
        position: target.position || 0,
        group: target.group || null,
        quickCommands: target.quickCommands || [],
        publicShowDetails: target.publicShowDetails === true,
        publicShowStatus: target.publicShowStatus !== false,
        publicShowAppLink: target.publicShowAppLink !== false,
      };
    }));

    const upCount = targetsWithStatus.filter((t) => t.isUp).length;
    const downCount = targetsWithStatus.length - upCount;

    res.json({
      success: true,
      status: {
        totalTargets: targetsWithStatus.length,
        upTargets: upCount,
        downTargets: downCount,
        overallStatus: downCount === 0 ? 'operational' : downCount < upCount ? 'degraded' : 'down',
      },
      targets: targetsWithStatus,
      timestamp: new Date(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
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

// Public API - Get incidents (read-only)
router.get('/api/incidents', async (req, res) => {
  try {
    const prisma = getPrisma();
    const incidents = await prisma.incident.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, incidents: incidents.map(i => ({ ...i, _id: i.id })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Public API - Get posts (read-only, only published)
router.get('/api/posts', async (req, res) => {
  try {
    const prisma = getPrisma();
    const posts = await prisma.post.findMany({
      where: { published: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, posts: posts.map(p => ({ ...p, _id: p.id })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Public API - Get single post (read-only, only published)
router.get('/api/posts/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const post = await prisma.post.findFirst({
      where: { id: req.params.id, published: true },
    });

    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    res.json({ success: true, post: { ...post, _id: post.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
