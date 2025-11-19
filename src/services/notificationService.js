const { exec } = require('child_process');
const { promisify } = require('util');
const chalk = require('chalk');

const execAsync = promisify(exec);

class NotificationService {
  constructor() {
    this.enabled = process.env.NOTIFICATION_ENABLED !== 'false';
    this.method = process.env.NOTIFICATION_METHOD || 'dbus';
    this.notifications = new Map();
  }

  /**
   * Send a notification to the user
   */
  async notify(title, message, options = {}) {
    if (!this.enabled) {
      console.log(`[Notification - disabled] ${title}: ${message}`);
      return null;
    }

    const urgency = options.urgency || 'normal'; // low, normal, critical
    const expireTime = options.expireTime || 5000; // milliseconds

    try {
      if (process.platform === 'linux') {
        return await this.notifyLinux(title, message, urgency, expireTime, options);
      } else if (process.platform === 'darwin') {
        return await this.notifyMac(title, message);
      } else if (process.platform === 'win32') {
        return await this.notifyWindows(title, message);
      }
    } catch (error) {
      console.error(chalk.red('Notification error:'), error.message);
    }
  }

  /**
   * Send notification via Linux DBus (for KDE Plasma, GNOME, etc.)
   */
  async notifyLinux(title, message, urgency, expireTime, options) {
    try {
      let cmd = `notify-send`;

      // Set urgency
      const urgencyMap = { low: 0, normal: 1, critical: 2 };
      cmd += ` -u ${Object.keys(urgencyMap).find((k) => urgencyMap[k] === urgencyMap[urgency] || urgency)}`;

      // Set expire time
      cmd += ` -t ${expireTime}`;

      // Add icon if provided
      if (options.icon) {
        cmd += ` -i ${options.icon}`;
      }

      // Add category if provided
      if (options.category) {
        cmd += ` -c ${options.category}`;
      }

      // Add title and message
      cmd += ` "${title}" "${message}"`;

      const { stdout } = await execAsync(cmd);
      console.log(chalk.green('✓ Notification sent via DBus'), title);
      return stdout.trim();
    } catch (error) {
      // Fallback if notify-send is not available
      if (error.message.includes('not found')) {
        console.warn(chalk.yellow('⚠ notify-send not available, using fallback'));
        return this.notifyFallback(title, message);
      }
      throw error;
    }
  }

  /**
   * Send notification via macOS
   */
  async notifyMac(title, message) {
    try {
      const script = `
        display notification "${message}" with title "${title}"
      `;
      const cmd = `osascript -e '${script}'`;
      await execAsync(cmd);
      console.log(chalk.green('✓ Notification sent via macOS'), title);
    } catch (error) {
      console.error(chalk.red('macOS notification failed:'), error.message);
    }
  }

  /**
   * Send notification via Windows
   */
  async notifyWindows(title, message) {
    try {
      const cmd = `powershell -Command "
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
        [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
        [Windows.Data.Xml.Dom.XmlDocument, System.Xml.XmlDocument, ContentType = WindowsRuntime] > $null

        $APP_ID = 'LocalPing'
        $template = @"
        <toast>
            <visual>
                <binding template='ToastText02'>
                    <text id='1'>${title}</text>
                    <text id='2'>${message}</text>
                </binding>
            </visual>
        </toast>
"@
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($template)
        $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($APP_ID).Show($toast)
      "`;
      await execAsync(cmd);
      console.log(chalk.green('✓ Notification sent via Windows'), title);
    } catch (error) {
      console.error(chalk.red('Windows notification failed:'), error.message);
    }
  }

  /**
   * Fallback notification method (console output)
   */
  notifyFallback(title, message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(chalk.cyan(`[${timestamp}] 🔔 ${title}`), chalk.gray(message));
    return null;
  }

  /**
   * Send alert notification for target down
   */
  async alertTargetDown(target) {
    await this.notify(
      `${target.name} is DOWN`,
      `${target.host} (${target.protocol}) is no longer responding`,
      {
        urgency: 'critical',
        icon: 'dialog-error',
        category: 'im.error',
        expireTime: 10000,
      }
    );
  }

  /**
   * Send alert notification for target recovered
   */
  async alertTargetUp(target) {
    await this.notify(
      `${target.name} is UP`,
      `${target.host} (${target.protocol}) has recovered`,
      {
        urgency: 'normal',
        icon: 'dialog-ok',
        category: 'im.ok',
        expireTime: 5000,
      }
    );
  }

  /**
   * Send test notification
   */
  async sendTest() {
    await this.notify(
      'LocalPing Test',
      'This is a test notification from LocalPing',
      {
        urgency: 'normal',
        icon: 'dialog-information',
        category: 'im.received',
      }
    );
  }
}

module.exports = new NotificationService();
