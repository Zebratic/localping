const axios = require('axios');
const chalk = require('../utils/colors');
const { getPrisma } = require('../config/prisma');

class NotificationService {
  constructor() {
    this.settings = null;
    this.settingsChecked = false;
    this.settingsLastCheck = 0;
    this.settingsCacheTTL = 60000; // 1 minute cache
  }

  /**
   * Get notification settings from database (with caching)
   */
  async getSettings() {
    const now = Date.now();

    // Return cached settings if still valid
    if (this.settings && (now - this.settingsLastCheck) < this.settingsCacheTTL) {
      return this.settings;
    }

    try {
      const prisma = getPrisma();
      const settingsDoc = await prisma.notificationSettings.findUnique({ where: { id: 'settings' } });

      if (settingsDoc) {
        // Prisma stores JSON fields as objects, no need to parse
        const discord = settingsDoc.discord || null;
        const events = settingsDoc.events || null;

        this.settings = {
          enabled: settingsDoc.enabled !== false,
          discord: {
            enabled: discord?.enabled === true,
            webhookUrl: discord?.webhookUrl || null,
            username: discord?.username || 'LocalPing',
            avatarUrl: discord?.avatarUrl || null,
          },
          events: {
            monitorDown: events?.monitorDown !== false,
            monitorUp: events?.monitorUp !== false,
            incidentCreated: events?.incidentCreated !== false,
            incidentUpdated: events?.incidentUpdated !== false,
          },
        };
      } else {
        // Default settings
        this.settings = {
          enabled: false,
          discord: {
            enabled: false,
            webhookUrl: null,
            username: 'LocalPing',
            avatarUrl: null,
          },
          events: {
            monitorDown: true,
            monitorUp: true,
            incidentCreated: true,
            incidentUpdated: true,
          },
        };
      }

      this.settingsLastCheck = now;
      return this.settings;
    } catch (error) {
      console.error(chalk.red('Error loading notification settings:'), error.message);
      // Return default settings on error
      return {
        enabled: false,
        discord: { enabled: false, webhookUrl: null, username: 'LocalPing', avatarUrl: null },
        events: { monitorDown: true, monitorUp: true, incidentCreated: true, incidentUpdated: true },
      };
    }
  }

  /**
   * Invalidate settings cache
   */
  invalidateCache() {
    this.settings = null;
    this.settingsChecked = false;
    this.settingsLastCheck = 0;
  }

  /**
   * Get avatar URL for Discord webhook
   * Returns the configured avatar URL or constructs a default URL using the ms-icon
   */
  getAvatarUrl(configuredAvatarUrl) {
    // If avatar is configured, use it
    if (configuredAvatarUrl && configuredAvatarUrl.trim() && configuredAvatarUrl.includes('http')) {
      return configuredAvatarUrl;
    }

    // Otherwise, construct default URL using environment variable or default
    // Use PUBLIC_URL, API_URL, or construct from PORT
    let baseUrl = process.env.PUBLIC_URL || process.env.API_URL;
    
    if (!baseUrl) {
      // Construct from host and port if available
      const host = process.env.HOST || 'localhost';
      const port = process.env.API_PORT || process.env.PORT || 8000;
      const protocol = process.env.PROTOCOL || (port === 443 ? 'https' : 'http');
      baseUrl = `${protocol}://${host}${port !== 80 && port !== 443 ? `:${port}` : ''}`;
    }

    // Ensure baseUrl doesn't end with a slash
    baseUrl = baseUrl.replace(/\/$/, '');
    
    return `${baseUrl}/ms-icon-310x310.png`;
  }

  /**
   * Send notification to Discord webhook
   */
  async sendDiscordNotification(webhookUrl, payload) {
    try {
      const response = await axios.post(webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      });

      return { success: true, response: response.data };
    } catch (error) {
      console.error(chalk.red('Discord webhook error:'), error.message);
      if (error.response) {
        console.error(chalk.gray('  Response status:'), error.response.status);
        console.error(chalk.gray('  Response data:'), error.response.data);
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Format Discord embed for monitor status change
   */
  formatMonitorEmbed(target, status, responseTime = null) {
    const isUp = status === 'up';
    const color = isUp ? 0x10b981 : 0xef4444; // Green or Red
    const title = isUp ? '✓ Monitor Online' : '✗ Monitor Offline';
    const description = isUp 
      ? `${target.name} is back online`
      : `${target.name} is currently offline`;

    const embed = {
      title,
      description,
      color,
      fields: [
        {
          name: 'Monitor',
          value: target.name,
          inline: true,
        },
        {
          name: 'Host',
          value: `${target.host}${target.port ? `:${target.port}` : ''}`,
          inline: true,
        },
        {
          name: 'Protocol',
          value: target.protocol || 'ICMP',
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    if (responseTime !== null) {
      embed.fields.push({
        name: 'Response Time',
        value: `${Math.round(responseTime)}ms`,
        inline: true,
      });
    }

    if (target.group) {
      embed.fields.push({
        name: 'Group',
        value: target.group,
        inline: true,
      });
    }

    return embed;
  }

  /**
   * Format Discord embed for incident
   */
  formatIncidentEmbed(incident, isUpdate = false) {
    const severityColors = {
      minor: 0x3b82f6,   // Blue
      major: 0xf59e0b,   // Yellow/Orange
      critical: 0xef4444, // Red
    };

    const statusEmojis = {
      investigating: '🔍',
      identified: '⚠️',
      monitoring: '👁️',
      resolved: '✅',
    };

    const color = severityColors[incident.severity] || 0x6b7280;
    const emoji = statusEmojis[incident.status] || '📢';
    const title = isUpdate 
      ? `${emoji} Incident Updated: ${incident.title}`
      : `🚨 New Incident: ${incident.title}`;

    const embed = {
      title,
      description: incident.description,
      color,
      fields: [
        {
          name: 'Severity',
          value: incident.severity.toUpperCase(),
          inline: true,
        },
        {
          name: 'Status',
          value: incident.status.toUpperCase(),
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    if (incident.affectedServices && incident.affectedServices.length > 0) {
      embed.fields.push({
        name: 'Affected Services',
        value: incident.affectedServices.join(', '),
        inline: false,
      });
    }

    return embed;
  }

  /**
   * Notify about monitor status change
   */
  async notifyMonitorStatus(target, status, responseTime = null) {
    const settings = await this.getSettings();

    if (!settings.enabled) {
      return { success: false, reason: 'Notifications disabled' };
    }

    const eventType = status === 'up' ? 'monitorUp' : 'monitorDown';
    if (!settings.events[eventType]) {
      return { success: false, reason: `Event ${eventType} disabled` };
    }

    const results = [];

    // Send Discord notification if enabled
    if (settings.discord.enabled && settings.discord.webhookUrl) {
      const embed = this.formatMonitorEmbed(target, status, responseTime);
      const payload = {
        username: settings.discord.username,
        embeds: [embed],
        avatar_url: this.getAvatarUrl(settings.discord.webhookUrl, settings.discord.avatarUrl),
      };

      const result = await this.sendDiscordNotification(settings.discord.webhookUrl, payload);
      results.push({ provider: 'discord', ...result });
    }

    return {
      success: results.some(r => r.success),
      results,
    };
  }

  /**
   * Notify about incident
   */
  async notifyIncident(incident, isUpdate = false) {
    const settings = await this.getSettings();

    if (!settings.enabled) {
      return { success: false, reason: 'Notifications disabled' };
    }

    const eventType = isUpdate ? 'incidentUpdated' : 'incidentCreated';
    if (!settings.events[eventType]) {
      return { success: false, reason: `Event ${eventType} disabled` };
    }

    const results = [];

    // Send Discord notification if enabled
    if (settings.discord.enabled && settings.discord.webhookUrl) {
      const embed = this.formatIncidentEmbed(incident, isUpdate);
      const payload = {
        username: settings.discord.username,
        embeds: [embed],
        avatar_url: this.getAvatarUrl(settings.discord.webhookUrl, settings.discord.avatarUrl),
      };

      const result = await this.sendDiscordNotification(settings.discord.webhookUrl, payload);
      results.push({ provider: 'discord', ...result });
    }

    return {
      success: results.some(r => r.success),
      results,
    };
  }

  /**
   * Test notification (for testing webhook configuration)
   */
  async testNotification(provider = 'discord') {
    const settings = await this.getSettings();

    if (!settings.enabled) {
      return { success: false, error: 'Notifications are disabled' };
    }

    if (provider === 'discord') {
      if (!settings.discord.enabled || !settings.discord.webhookUrl) {
        return { success: false, error: 'Discord notifications are not configured' };
      }

      const payload = {
        username: settings.discord.username,
        embeds: [
          {
            title: '🧪 Test Notification',
            description: 'This is a test notification from LocalPing. If you receive this, your webhook is configured correctly!',
            color: 0x06b6d4, // Cyan
            timestamp: new Date().toISOString(),
          },
        ],
        avatar_url: this.getAvatarUrl(settings.discord.avatarUrl),
      };

      return await this.sendDiscordNotification(settings.discord.webhookUrl, payload);
    }

    return { success: false, error: `Unknown provider: ${provider}` };
  }
}

module.exports = new NotificationService();

