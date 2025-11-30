const { getPrisma } = require('../config/prisma');
const IncidentService = require('./incidentService');
const chalk = require('../utils/colors');
const { v4: uuidv4 } = require('uuid');

class EventDetectionService {
  constructor() {
    this.prisma = null;
    this.incidentService = null;
    this.activeIncidents = new Map(); // Track incidents created by events to avoid duplicates
  }

  /**
   * Initialize the service
   */
  async initialize() {
    this.prisma = getPrisma();
    this.incidentService = new IncidentService(this.prisma);
  }

  /**
   * Evaluate all enabled event rules and create incidents if conditions are met
   */
  async evaluateRules(context = {}) {
    try {
      if (!this.prisma) {
        await this.initialize();
      }

      const rules = await this.prisma.eventRule.findMany({
        where: { enabled: true },
      });

      for (const rule of rules) {
        try {
          const shouldTrigger = await this.evaluateRule(rule, context);
          
          if (shouldTrigger) {
            await this.triggerRule(rule, context);
          } else {
            // Check if we should auto-resolve incidents created by this rule
            await this.checkAutoResolve(rule, context);
          }
        } catch (error) {
          console.error(chalk.red(`Error evaluating rule ${rule.name}:`), error.message);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error evaluating event rules:'), error.message);
    }
  }

  /**
   * Evaluate a single rule to see if it should trigger
   */
  async evaluateRule(rule, context) {
    const { eventType } = rule;
    // Parse conditions from JSON string if needed and attach to rule for use in evaluation methods
    if (typeof rule.conditions === 'string') {
      try {
        rule.conditions = JSON.parse(rule.conditions);
      } catch (e) {
        console.error(chalk.red(`Error parsing conditions for rule ${rule.name}:`), e.message);
        return false;
      }
    }

    switch (eventType) {
      case 'monitor_down':
        return await this.evaluateMonitorDown(rule, context);
      case 'monitor_up':
        return await this.evaluateMonitorUp(rule, context);
      case 'multiple_monitors_down':
        return await this.evaluateMultipleMonitorsDown(rule, context);
      case 'monitor_response_time':
        return await this.evaluateResponseTime(rule, context);
      case 'uptime_threshold':
        return await this.evaluateUptimeThreshold(rule, context);
      case 'custom_condition':
        return await this.evaluateCustomCondition(rule, context);
      default:
        console.warn(chalk.yellow(`Unknown event type: ${eventType}`));
        return false;
    }
  }

  /**
   * Evaluate monitor down condition
   */
  async evaluateMonitorDown(rule, context) {
    let conditions = rule.conditions;
    if (typeof conditions === 'string') {
      try {
        conditions = JSON.parse(conditions);
      } catch (e) {
        return false;
      }
    }
    const { targetId, targetIds, targetGroups } = conditions;
    
    // If context has a specific target, check if it matches
    if (context.targetId) {
      // Check if this target is in the list
      if (targetIds && Array.isArray(targetIds) && targetIds.includes(context.targetId)) {
        const status = context.status || await this.getTargetStatus(context.targetId);
        return status === 'down';
      }
      // Legacy support for single targetId
      if (targetId && context.targetId === targetId) {
        const status = context.status || await this.getTargetStatus(context.targetId);
        return status === 'down';
      }
      if (targetGroups && context.targetGroup) {
        if (targetGroups.includes(context.targetGroup)) {
          const status = context.status || await this.getTargetStatus(context.targetId);
          return status === 'down';
        }
      }
    }

    // Otherwise check all matching targets
    // Prioritize targetIds array (new format)
    if (targetIds && Array.isArray(targetIds) && targetIds.length > 0) {
      for (const id of targetIds) {
        const status = await this.getTargetStatus(id);
        if (status === 'down') return true;
      }
    }
    // Legacy support for single targetId
    else if (targetId) {
      const status = await this.getTargetStatus(targetId);
      return status === 'down';
    }

    if (targetGroups && targetGroups.length > 0) {
      const targets = await this.prisma.target.findMany({
        where: { group: { in: targetGroups }, enabled: true },
      });
      
      for (const target of targets) {
        const status = await this.getTargetStatus(target._id);
        if (status === 'down') return true;
      }
    }

    return false;
  }

  /**
   * Evaluate monitor up condition (for auto-resolve)
   */
  async evaluateMonitorUp(rule, context) {
    let conditions = rule.conditions;
    if (typeof conditions === 'string') {
      try {
        conditions = JSON.parse(conditions);
      } catch (e) {
        return false;
      }
    }
    const { targetId, targetIds, targetGroups } = conditions;
    
    if (context.targetId) {
      // Check if this target is in the list
      if (targetIds && Array.isArray(targetIds) && targetIds.includes(context.targetId)) {
        const status = context.status || await this.getTargetStatus(context.targetId);
        return status === 'up';
      }
      // Legacy support for single targetId
      if (targetId && context.targetId === targetId) {
        const status = context.status || await this.getTargetStatus(context.targetId);
        return status === 'up';
      }
      if (targetGroups && context.targetGroup) {
        if (targetGroups.includes(context.targetGroup)) {
          const status = context.status || await this.getTargetStatus(context.targetId);
          return status === 'up';
        }
      }
    }

    return false;
  }

  /**
   * Evaluate multiple monitors down condition
   */
  async evaluateMultipleMonitorsDown(rule, context) {
    let conditions = rule.conditions;
    if (typeof conditions === 'string') {
      try {
        conditions = JSON.parse(conditions);
      } catch (e) {
        return false;
      }
    }
    const { targetIds, targetGroups, count, operator = 'gte' } = conditions;
    
    let downCount = 0;
    const targetsToCheck = [];

    if (targetIds && targetIds.length > 0) {
      const targets = await this.prisma.target.findMany({
        where: { id: { in: targetIds }, enabled: true },
      });
      targetsToCheck.push(...targets);
    }

    if (targetGroups && targetGroups.length > 0) {
      const targets = await this.prisma.target.findMany({
        where: { group: { in: targetGroups }, enabled: true },
      });
      targetsToCheck.push(...targets);
    }

    for (const target of targetsToCheck) {
      const status = await this.getTargetStatus(target._id);
      if (status === 'down') {
        downCount++;
      }
    }

    if (operator === 'gte') {
      return downCount >= count;
    } else if (operator === 'eq') {
      return downCount === count;
    } else if (operator === 'gt') {
      return downCount > count;
    }

    return false;
  }

  /**
   * Evaluate response time condition
   */
  async evaluateResponseTime(rule, context) {
    let conditions = rule.conditions;
    if (typeof conditions === 'string') {
      try {
        conditions = JSON.parse(conditions);
      } catch (e) {
        return false;
      }
    }
    const { targetId, threshold, operator = 'gt' } = conditions;
    
    if (!context.targetId || context.targetId !== targetId) {
      return false;
    }

    const responseTime = context.responseTime || await this.getLatestResponseTime(targetId);
    if (responseTime === null) return false;

    if (operator === 'gt') {
      return responseTime > threshold;
    } else if (operator === 'gte') {
      return responseTime >= threshold;
    } else if (operator === 'lt') {
      return responseTime < threshold;
    } else if (operator === 'lte') {
      return responseTime <= threshold;
    }

    return false;
  }

  /**
   * Evaluate uptime threshold condition
   */
  async evaluateUptimeThreshold(rule, context) {
    let conditions = rule.conditions;
    if (typeof conditions === 'string') {
      try {
        conditions = JSON.parse(conditions);
      } catch (e) {
        return false;
      }
    }
    const { targetId, threshold, period = '24h' } = conditions;
    
    if (!targetId) return false;

    const uptime = await this.getUptimePercentage(targetId, period);
    if (uptime === null) return false;

    return uptime < threshold;
  }

  /**
   * Evaluate custom condition (JavaScript expression)
   */
  async evaluateCustomCondition(rule, context) {
    let conditions = rule.conditions;
    if (typeof conditions === 'string') {
      try {
        conditions = JSON.parse(conditions);
      } catch (e) {
        return false;
      }
    }
    const { expression } = conditions;
    
    if (!expression) return false;

    try {
      // Create a safe evaluation context
      const evalContext = {
        targetId: context.targetId,
        status: context.status,
        responseTime: context.responseTime,
        target: context.target,
        getTargetStatus: async (id) => await this.getTargetStatus(id),
        getLatestResponseTime: async (id) => await this.getLatestResponseTime(id),
        getUptimePercentage: async (id, period) => await this.getUptimePercentage(id, period),
      };

      // Evaluate the expression (in a limited way - be careful with this)
      // Note: Using eval is dangerous, but for admin-controlled rules it's acceptable
      const result = await eval(`(async () => { ${expression} })()`);
      return Boolean(result);
    } catch (error) {
      console.error(chalk.red(`Error evaluating custom condition for rule ${rule.name}:`), error.message);
      return false;
    }
  }

  /**
   * Trigger a rule and create an incident
   */
  async triggerRule(rule, context) {
    try {
      // Check if we already created an incident for this rule
      const incidentKey = `${rule._id}_${this.getContextKey(context)}`;
      if (this.activeIncidents.has(incidentKey)) {
        return; // Already created
      }

      // Check cooldown period
      if (rule.cooldownMinutes) {
        const lastTrigger = this.getLastTriggerTime(rule._id);
        if (lastTrigger && (Date.now() - lastTrigger) < (rule.cooldownMinutes * 60 * 1000)) {
          return; // Still in cooldown
        }
      }

      // Build incident data from rule template
      const incidentData = {
        title: this.interpolateTemplate(rule.incidentTitle, context),
        description: this.interpolateTemplate(rule.incidentDescription, context),
        status: rule.incidentStatus || 'investigating',
        severity: rule.incidentSeverity || 'major',
        affectedServices: await this.getAffectedServices(rule, context),
      };

      const result = await this.incidentService.createIncident(incidentData);
      
      if (result.success) {
        // Track this incident
        this.activeIncidents.set(incidentKey, {
          incidentId: result.incidentId,
          ruleId: rule._id,
          createdAt: Date.now(),
        });

        // Store last trigger time
        this.setLastTriggerTime(rule._id, Date.now());

        console.log(chalk.green(`✓ Event rule "${rule.name}" triggered, incident created: ${result.incidentId}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error triggering rule ${rule.name}:`), error.message);
    }
  }

  /**
   * Check if we should auto-resolve incidents created by a rule
   */
  async checkAutoResolve(rule, context) {
    if (!rule.autoResolve) return;

    const incidentKey = `${rule._id}_${this.getContextKey(context)}`;
    const activeIncident = this.activeIncidents.get(incidentKey);
    
    if (!activeIncident) return;

    // Check if condition is now false (e.g., monitor is back up)
    const conditionMet = await this.evaluateRule(rule, context);
    
    if (!conditionMet) {
      // Condition is no longer met, resolve the incident
      try {
        const incident = await this.incidentService.getIncidentById(activeIncident.incidentId);
        if (incident && incident.status !== 'resolved') {
          await this.incidentService.updateIncident(activeIncident.incidentId, {
            status: 'resolved',
            updateMessage: rule.autoResolveMessage || 'Service restored - automatically resolved by event detection system',
          });
          
          // Remove from active incidents
          this.activeIncidents.delete(incidentKey);
          
          console.log(chalk.green(`✓ Auto-resolved incident ${activeIncident.incidentId} for rule "${rule.name}"`));
        }
      } catch (error) {
        console.error(chalk.red(`Error auto-resolving incident:`), error.message);
      }
    }
  }

  /**
   * Get target status
   */
  async getTargetStatus(targetId) {
    const monitorService = require('./monitorService');
    return monitorService.getTargetStatus(targetId);
  }

  /**
   * Get latest response time for a target
   */
  async getLatestResponseTime(targetId) {
    try {
      const result = await this.prisma.pingResult.findFirst({
        where: { targetId },
        orderBy: { timestamp: 'desc' },
      });

      return result?.responseTime || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get uptime percentage for a target over a period
   */
  async getUptimePercentage(targetId, period = '24h') {
    try {
      const hours = this.parsePeriod(period);
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const results = await this.prisma.pingResult.findMany({
        where: { targetId, timestamp: { gte: since } },
      });

      if (results.length === 0) return null;

      const successful = results.filter(r => r.success).length;
      return (successful / results.length) * 100;
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse period string (e.g., "24h", "7d") to hours
   */
  parsePeriod(period) {
    const match = period.match(/^(\d+)([hd])$/);
    if (!match) return 24; // Default to 24 hours
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    return unit === 'd' ? value * 24 : value;
  }

  /**
   * Get affected services for an incident
   */
  async getAffectedServices(rule, context) {
    const services = [];

    if (context.target) {
      services.push(context.target.name);
    } else if (context.targetId) {
      const target = await this.prisma.target.findUnique({ where: { id: context.targetId } });
      if (target) {
        services.push(target.name);
      }
    }

    let conditions = rule.conditions;
    if (typeof conditions === 'string') {
      try {
        conditions = JSON.parse(conditions);
      } catch (e) {
        return services;
      }
    }

    if (conditions.targetIds) {
      for (const id of conditions.targetIds) {
        const target = await this.prisma.target.findUnique({ where: { id } });
        if (target && !services.includes(target.name)) {
          services.push(target.name);
        }
      }
    }

    return services;
  }

  /**
   * Interpolate template string with context variables
   */
  interpolateTemplate(template, context) {
    if (!template) return '';
    
    let result = template;
    
    // Replace {{variable}} with context values
    result = result.replace(/\{\{target\.name\}\}/g, context.target?.name || 'Unknown');
    result = result.replace(/\{\{target\.host\}\}/g, context.target?.host || 'Unknown');
    result = result.replace(/\{\{status\}\}/g, context.status || 'unknown');
    result = result.replace(/\{\{responseTime\}\}/g, context.responseTime || 'N/A');
    
    return result;
  }

  /**
   * Get context key for tracking incidents
   */
  getContextKey(context) {
    if (context.targetId) {
      return context.targetId;
    }
    return 'default';
  }

  /**
   * Get last trigger time for a rule
   */
  getLastTriggerTime(ruleId) {
    const key = `lastTrigger_${ruleId}`;
    return this[key] || null;
  }

  /**
   * Set last trigger time for a rule
   */
  setLastTriggerTime(ruleId, timestamp) {
    const key = `lastTrigger_${ruleId}`;
    this[key] = timestamp;
  }

  /**
   * Clean up resolved incidents from tracking
   */
  async cleanupResolvedIncidents() {
    try {
      for (const [key, incident] of this.activeIncidents.entries()) {
        const incidentData = await this.incidentService.getIncidentById(incident.incidentId);
        if (incidentData && incidentData.status === 'resolved') {
          this.activeIncidents.delete(key);
        }
      }
    } catch (error) {
      // Silently fail
    }
  }
}

module.exports = new EventDetectionService();

