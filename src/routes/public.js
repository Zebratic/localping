const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getDB } = require('../config/db');
const monitorService = require('../services/monitorService');
const faviconService = require('../services/faviconService');

// Public status page
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    let settings = await db.collection('publicUISettings').findOne({ _id: 'settings' });

    if (!settings) {
      // Use defaults if not found
      settings = {
        title: 'Homelab',
        subtitle: 'System Status & Application Dashboard',
        customCSS: null,
      };
    }

    res.render('public/index', {
      title: settings.title || 'Homelab',
      subtitle: settings.subtitle || 'System Status & Application Dashboard',
      customCSS: settings.customCSS || '',
    });
  } catch (error) {
    // Fallback to defaults on error
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
    const db = getDB();
    const targets = await db.collection('targets').find({ enabled: true, publicVisible: true }).toArray();

    const targetsWithStatus = targets.map((target) => ({
      _id: target._id,
      name: target.name,
      host: target.host,
      protocol: target.protocol,
      currentStatus: monitorService.getTargetStatus(target._id),
    }));

    res.json({ success: true, targets: targetsWithStatus });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Public API - Get target statistics (read-only)
router.get('/api/targets/:id/statistics', async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;
    const period = req.query.period || (req.query.days ? null : '24h'); // Default to 24h if no period specified
    const days = parseFloat(req.query.days) || null;

    // Verify target exists, is enabled, and is publicly visible
    const target = await db.collection('targets').findOne({
      _id: targetId,
      enabled: true,
      publicVisible: true,
    });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    let startDateObj;
    let endDateObj = new Date();
    let intervalMinutes;
    let maxPoints;

    // Determine grouping based on period (matching admin route exactly)
    if (period === '1h') {
      // 1H: 60 data points (one per minute)
      startDateObj = new Date();
      startDateObj.setHours(startDateObj.getHours() - 1);
      intervalMinutes = 1;
      maxPoints = 60;
    } else if (period === '24h') {
      // 24H: 48 data points (every 30 minutes)
      startDateObj = new Date();
      startDateObj.setHours(startDateObj.getHours() - 24);
      intervalMinutes = 30;
      maxPoints = 48;
    } else if (period === '7d') {
      // 7D: 56 data points (every 3 hours)
      startDateObj = new Date();
      startDateObj.setDate(startDateObj.getDate() - 7);
      intervalMinutes = 180; // 3 hours
      maxPoints = 56;
    } else if (period === '30d') {
      // 30D: 60 data points (every 12 hours)
      startDateObj = new Date();
      startDateObj.setDate(startDateObj.getDate() - 30);
      intervalMinutes = 720; // 12 hours
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
        intervalMinutes = 60;
        maxPoints = 24;
      } else {
        intervalMinutes = 1440; // 1 day
        maxPoints = days;
      }
    } else {
      // Default to 24h
      startDateObj = new Date();
      startDateObj.setHours(startDateObj.getHours() - 24);
      intervalMinutes = 30;
      maxPoints = 48;
    }

    // Generate evenly spaced time buckets and aggregate data into them
    // This ensures we always get the exact number of points requested
    const intervalSeconds = intervalMinutes * 60;
    const startEpoch = Math.floor(startDateObj.getTime() / 1000);
    const endEpoch = Math.floor(endDateObj.getTime() / 1000);
    
    // Convert dates to ISO strings for PostgreSQL (matching admin route)
    const startDateStr = startDateObj.toISOString().replace('T', ' ').substring(0, 19);
    const endDateStr = endDateObj.toISOString().replace('T', ' ').substring(0, 19);
    
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
        AND pr.timestamp < time_buckets.bucket_time + ($5 || ' seconds')::interval
      GROUP BY time_buckets.bucket_time
      ORDER BY time_buckets.bucket_time ASC
    `, [targetId, startEpoch, endEpoch, maxPoints, intervalSeconds]);
    
    // Get last response time separately (matching admin route format)
    const lastResponseResult = await db.query(`
      SELECT "responseTime" FROM "pingResults" 
      WHERE "targetId" = $1 AND timestamp >= $2::timestamp AND timestamp <= $3::timestamp
      ORDER BY timestamp DESC LIMIT 1
    `, [targetId, startDateStr, endDateStr]);

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

// Public API - Get target uptime summary (read-only)
router.get('/api/targets/:id/uptime', async (req, res) => {
  try {
    const db = getDB();
    const targetId = req.params.id;
    const days = parseInt(req.query.days) || 30;

    const target = await db.collection('targets').findOne({
      _id: targetId,
      enabled: true,
      publicVisible: true,
    });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

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
    const db = getDB();

    const targets = await db.collection('targets').find({ enabled: true, publicVisible: true }).toArray();

    // Fetch favicons for apps asynchronously
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

      // Parse quickCommands if it's a JSON string from SQLite
      let quickCommands = [];
      if (target.quickCommands) {
        if (typeof target.quickCommands === 'string') {
          try {
            quickCommands = JSON.parse(target.quickCommands);
          } catch (e) {
            quickCommands = [];
          }
        } else if (Array.isArray(target.quickCommands)) {
          quickCommands = target.quickCommands;
        }
      }

      return {
        _id: target._id,
        name: target.name,
        host: target.host,
        protocol: target.protocol,
        appUrl: target.appUrl,
        appIcon: target.appIcon || null,
        favicon: favicon,
        currentStatus: monitorService.getTargetStatus(target._id),
        isUp: monitorService.getTargetStatus(target._id) === 'up',
        position: target.position || 0,
        group: target.group || null,
        quickCommands: quickCommands,
        publicShowDetails: target.publicShowDetails === true,
        publicShowStatus: target.publicShowStatus !== false, // Default to true
        publicShowAppLink: target.publicShowAppLink !== false, // Default to true
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

// Proxy endpoint for icons (handles local network URLs)
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

// Public API - Get incidents (read-only)
router.get('/api/incidents', async (req, res) => {
  try {
    const db = getDB();

    const incidents = await db
      .collection('incidents')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, incidents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Public API - Get posts (read-only, only published)
router.get('/api/posts', async (req, res) => {
  try {
    const db = getDB();

    const posts = await db
      .collection('posts')
      .find({ published: true })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, posts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Public API - Get single post (read-only, only published)
router.get('/api/posts/:id', async (req, res) => {
  try {
    const db = getDB();
    const post = await db.collection('posts').findOne({ 
      _id: req.params.id,
      published: true 
    });

    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    res.json({ success: true, post });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
