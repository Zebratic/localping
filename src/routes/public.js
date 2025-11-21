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
    const days = parseFloat(req.query.days) || 30;

    // Verify target exists, is enabled, and is publicly visible
    const target = await db.collection('targets').findOne({
      _id: targetId,
      enabled: true,
      publicVisible: true,
    });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

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
      .sort({ date: 1 })
      .toArray();

    res.json({ success: true, statistics: stats });
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

    const stats = await db
      .collection('statistics')
      .find({
        targetId,
        date: { $gte: startDate },
      })
      .toArray();

    const totalPings = stats.reduce((sum, s) => sum + s.totalPings, 0);
    const successfulPings = stats.reduce((sum, s) => sum + s.successfulPings, 0);
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
