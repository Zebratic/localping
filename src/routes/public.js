const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const monitorService = require('../services/monitorService');

// Public status page
router.get('/', (req, res) => {
  res.render('public/index');
});

// Public API - Get all targets (read-only)
router.get('/api/targets', async (req, res) => {
  try {
    const db = getDB();
    const targets = await db.collection('targets').find({ enabled: true }).toArray();

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
    const targetId = new ObjectId(req.params.id);
    const days = parseInt(req.query.days) || 30;

    // Verify target exists and is enabled
    const target = await db.collection('targets').findOne({
      _id: targetId,
      enabled: true,
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
    const targetId = new ObjectId(req.params.id);
    const days = parseInt(req.query.days) || 30;

    const target = await db.collection('targets').findOne({
      _id: targetId,
      enabled: true,
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

    const targets = await db.collection('targets').find({ enabled: true }).toArray();

    const targetsWithStatus = targets.map((target) => ({
      _id: target._id,
      name: target.name,
      host: target.host,
      protocol: target.protocol,
      currentStatus: monitorService.getTargetStatus(target._id),
      isUp: monitorService.getTargetStatus(target._id) === 'up',
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

module.exports = router;
