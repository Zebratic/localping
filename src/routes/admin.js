const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const monitorService = require('../services/monitorService');

// Admin dashboard
router.get('/', (req, res) => {
  res.render('admin/index');
});

// Admin API endpoints
router.get('/api/dashboard', async (req, res) => {
  try {
    const db = getDB();

    const targets = await db.collection('targets').find({}).toArray();
    const targetsWithStatus = targets.map((target) => ({
      ...target,
      currentStatus: monitorService.getTargetStatus(target._id),
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
    const actionId = new ObjectId(req.params.id);
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
      targetId: targetId ? new ObjectId(targetId) : null,
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
    const actionId = new ObjectId(req.params.id);

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
    const actionId = new ObjectId(req.params.id);

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
    const actionId = new ObjectId(req.params.id);
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

module.exports = router;
