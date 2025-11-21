const express = require('express');
const router = express.Router();
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
router.post('/login', (req, res) => {
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
    // Set session and explicitly save it
    req.session.adminAuthenticated = true;

    // Save session before responding to ensure cookie is set
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          error: 'Failed to save session',
        });
      }
      res.json({ success: true, message: 'Authenticated' });
    });
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
  res.redirect('/admin/login');
});

// Admin dashboard - Protected by auth middleware
router.get('/', adminPageAuth, (req, res) => {
  res.render('admin/index');
});

// Apply auth middleware to all admin API routes
router.use('/api', adminPageAuth);

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

module.exports = router;
