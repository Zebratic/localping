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
    // Support both 'period' and 'days' query parameters
    const period = req.query.period || (req.query.days ? `${req.query.days}d` : '24h');
    const days = parseInt(req.query.days) || null;

    const target = await prisma.target.findFirst({
      where: { id: targetId, enabled: true, publicVisible: true },
      select: { id: true, name: true },
    });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    let startDateObj = new Date();
    let endDateObj = new Date();
    let intervalMinutes = 30;
    let maxPoints = 48;
    let useDailyStats = false;

    // Handle 'days' parameter for daily statistics
    if (days !== null) {
      if (days === 1) {
        startDateObj.setHours(startDateObj.getHours() - 24);
        intervalMinutes = 30;
        maxPoints = 48;
        useDailyStats = false;
      } else if (days === 30) {
        // For 30 days, use daily statistics table instead of raw ping results
        useDailyStats = true;
        startDateObj.setDate(startDateObj.getDate() - 30);
      } else {
        startDateObj.setDate(startDateObj.getDate() - days);
        intervalMinutes = Math.max(60, Math.floor((days * 24 * 60) / 60));
        maxPoints = 60;
        useDailyStats = days >= 7;
      }
    } else if (period === '1h') {
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
      useDailyStats = true;
    } else if (period === 'all' || period === 'ALL') {
      // For ALL period, use daily statistics (much more efficient)
      useDailyStats = true;
      startDateObj = new Date(0); // Start from beginning
    }

    let stats = [];

    if (useDailyStats) {
      // Use pre-aggregated daily statistics for better performance
      const dailyStats = await prisma.statistic.findMany({
        where: {
          targetId,
          date: { gte: startDateObj },
        },
        orderBy: { date: 'asc' },
        select: {
          date: true,
          totalPings: true,
          successfulPings: true,
          avgResponseTime: true,
        },
      });

      stats = dailyStats.map(s => ({
        date: s.date.toISOString(),
        totalPings: s.totalPings || 0,
        successfulPings: s.successfulPings || 0,
        failedPings: (s.totalPings || 0) - (s.successfulPings || 0),
        uptime: s.totalPings > 0 ? ((s.successfulPings / s.totalPings) * 100) : 0,
        avgResponseTime: s.avgResponseTime || 0,
      }));
    } else {
      // Use optimized raw query for shorter time periods
      const intervalSeconds = intervalMinutes * 60;
      const startEpoch = Math.floor(startDateObj.getTime() / 1000);
      const endEpoch = Math.floor(endDateObj.getTime() / 1000);

      // Optimized query with proper index usage
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

      stats = result.map(r => ({
        date: r.date,
        totalPings: Number(r.totalPings) || 0,
        successfulPings: Number(r.successfulPings) || 0,
        failedPings: (Number(r.totalPings) || 0) - (Number(r.successfulPings) || 0),
        uptime: r.totalPings > 0 ? ((r.successfulPings / r.totalPings) * 100) : 0,
        avgResponseTime: Number(r.avgResponseTime) || 0,
      }));
    }

    // Get uptime summary using aggregated statistics (much faster)
    const uptime24hStart = new Date();
    uptime24hStart.setDate(uptime24hStart.getDate() - 1);
    const uptime30dStart = new Date();
    uptime30dStart.setDate(uptime30dStart.getDate() - 30);

    // Use single aggregation query instead of fetching all records
    const uptime24h = await prisma.statistic.aggregate({
      where: {
        targetId,
        date: { gte: uptime24hStart },
      },
      _sum: {
        totalPings: true,
        successfulPings: true,
      },
    });

    const uptime30d = await prisma.statistic.aggregate({
      where: {
        targetId,
        date: { gte: uptime30dStart },
      },
      _sum: {
        totalPings: true,
        successfulPings: true,
      },
    });

    const totalPings24h = uptime24h._sum.totalPings || 0;
    const successfulPings24h = uptime24h._sum.successfulPings || 0;
    const totalPings30d = uptime30d._sum.totalPings || 0;
    const successfulPings30d = uptime30d._sum.successfulPings || 0;

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
      target: {
        _id: target.id,
        name: target.name,
      },
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

    // Use aggregation instead of fetching all records
    const stats = await prisma.statistic.aggregate({
      where: { targetId, date: { gte: startDate } },
      _sum: { totalPings: true, successfulPings: true },
    });

    const totalPings = stats._sum.totalPings || 0;
    const successfulPings = stats._sum.successfulPings || 0;
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

// Public API - Get all data for public UI (consolidated endpoint)
router.get('/api/public/all', async (req, res) => {
  try {
    const prisma = getPrisma();
    
    // Get all visible targets
    const targets = await prisma.target.findMany({
      where: { enabled: true, publicVisible: true },
      select: {
        id: true,
        name: true,
        host: true,
        protocol: true,
        appUrl: true,
        appIcon: true,
        position: true,
        group: true,
        quickCommands: true,
        publicShowDetails: true,
        publicShowStatus: true,
        publicShowAppLink: true,
      },
      orderBy: { position: 'asc' },
    });

    // Calculate date ranges
    const uptime24hStart = new Date();
    uptime24hStart.setDate(uptime24hStart.getDate() - 1);
    const uptime30dStart = new Date();
    uptime30dStart.setDate(uptime30dStart.getDate() - 30);

    // Get uptime statistics for all targets in parallel using aggregation
    const targetIds = targets.map(t => t.id);
    
    if (targetIds.length === 0) {
      return res.json({
        success: true,
        status: {
          overallStatus: 'operational',
          upTargets: 0,
          downTargets: 0,
          totalTargets: 0,
        },
        targets: [],
        timestamp: new Date(),
      });
    }

    // Use raw SQL for efficient aggregation across all targets
    const [uptime24hData, uptime30dData, dailyStatsData] = await Promise.all([
      // 24h uptime aggregation for all targets
      prisma.$queryRaw`
        SELECT 
          "targetId",
          COALESCE(SUM("totalPings"), 0)::bigint as "totalPings",
          COALESCE(SUM("successfulPings"), 0)::bigint as "successfulPings"
        FROM statistics
        WHERE "targetId" = ANY(${targetIds}::text[])
        AND date >= ${uptime24hStart}
        GROUP BY "targetId"
      `,
      // 30d uptime aggregation for all targets
      prisma.$queryRaw`
        SELECT 
          "targetId",
          COALESCE(SUM("totalPings"), 0)::bigint as "totalPings",
          COALESCE(SUM("successfulPings"), 0)::bigint as "successfulPings"
        FROM statistics
        WHERE "targetId" = ANY(${targetIds}::text[])
        AND date >= ${uptime30dStart}
        GROUP BY "targetId"
      `,
      // Daily stats for last 30 days (for uptime bars)
      prisma.statistic.findMany({
        where: {
          targetId: { in: targetIds },
          date: { gte: uptime30dStart },
        },
        select: {
          targetId: true,
          date: true,
          totalPings: true,
          successfulPings: true,
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    // Create lookup maps for fast access
    const uptime24hMap = new Map();
    uptime24hData.forEach(item => {
      const total = Number(item.totalPings) || 0;
      const successful = Number(item.successfulPings) || 0;
      const uptime = total > 0 ? (successful / total) * 100 : 0;
      uptime24hMap.set(item.targetId, {
        uptime: parseFloat(uptime.toFixed(2)),
        totalPings: total,
        successfulPings: successful,
        failedPings: total - successful,
      });
    });

    const uptime30dMap = new Map();
    uptime30dData.forEach(item => {
      const total = Number(item.totalPings) || 0;
      const successful = Number(item.successfulPings) || 0;
      const uptime = total > 0 ? (successful / total) * 100 : 0;
      uptime30dMap.set(item.targetId, {
        uptime: parseFloat(uptime.toFixed(2)),
        totalPings: total,
        successfulPings: successful,
        failedPings: total - successful,
      });
    });

    // Group daily stats by targetId
    const dailyStatsMap = new Map();
    dailyStatsData.forEach(stat => {
      if (!dailyStatsMap.has(stat.targetId)) {
        dailyStatsMap.set(stat.targetId, []);
      }
      const dailyUptime = stat.totalPings > 0 ? ((stat.successfulPings / stat.totalPings) * 100) : 0;
      dailyStatsMap.get(stat.targetId).push({
        date: stat.date.toISOString(),
        totalPings: stat.totalPings || 0,
        successfulPings: stat.successfulPings || 0,
        failedPings: (stat.totalPings || 0) - (stat.successfulPings || 0),
        uptime: parseFloat(dailyUptime.toFixed(2)),
      });
    });

    // Build response with targets and their statistics (only include needed fields)
    const targetsWithStats = targets.map(target => {
      const status = monitorService.getTargetStatus(target.id);
      const uptime24h = uptime24hMap.get(target.id) || { uptime: 0, totalPings: 0, successfulPings: 0, failedPings: 0 };
      const uptime30d = uptime30dMap.get(target.id) || { uptime: 0, totalPings: 0, successfulPings: 0, failedPings: 0 };
      const dailyStats = dailyStatsMap.get(target.id) || [];
      const showDetails = target.publicShowDetails === true;

      const result = {
        _id: target.id,
        name: target.name,
        currentStatus: status,
        isUp: status === 'up',
        publicShowDetails: showDetails,
        publicShowStatus: target.publicShowStatus !== false,
        publicShowAppLink: target.publicShowAppLink !== false,
        uptime: {
          '24h': uptime24h,
          '30d': uptime30d,
        },
        dailyStats: dailyStats,
      };

      // Only include host/protocol if publicShowDetails is true
      if (showDetails) {
        result.host = target.host;
        result.protocol = target.protocol;
      }

      // Only include appUrl/appIcon if they exist (needed for icons/links)
      if (target.appUrl) {
        result.appUrl = target.appUrl;
      }
      if (target.appIcon) {
        result.appIcon = target.appIcon;
      }

      // Only include group/position/quickCommands if they have values
      if (target.group) {
        result.group = target.group;
      }
      if (target.position !== 0) {
        result.position = target.position;
      }
      if (target.quickCommands && target.quickCommands.length > 0) {
        result.quickCommands = target.quickCommands;
      }

      return result;
    });

    // Calculate overall status
    const upCount = targetsWithStats.filter(t => t.isUp).length;
    const downCount = targetsWithStats.length - upCount;
    let overallStatus = 'operational';
    if (downCount > 0) {
      overallStatus = downCount === targetsWithStats.length ? 'down' : 'degraded';
    }

    res.json({
      success: true,
      status: {
        overallStatus,
        upTargets: upCount,
        downTargets: downCount,
        totalTargets: targetsWithStats.length,
      },
      targets: targetsWithStats,
      timestamp: new Date(),
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

    const targetsWithStatus = targets.map((target) => {
      const status = monitorService.getTargetStatus(target.id);
      return {
        _id: target.id,
        name: target.name,
        host: target.host,
        protocol: target.protocol,
        appUrl: target.appUrl,
        appIcon: target.appIcon || null,
        currentStatus: status,
        isUp: status === 'up',
        position: target.position || 0,
        group: target.group || null,
        quickCommands: target.quickCommands || [],
        publicShowDetails: target.publicShowDetails === true,
        publicShowStatus: target.publicShowStatus !== false,
        publicShowAppLink: target.publicShowAppLink !== false,
      };
    });

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
