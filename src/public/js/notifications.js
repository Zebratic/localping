/**
 * Browser Notification System for LocalPing
 * Handles desktop and in-app notifications for status changes
 */

class NotificationManager {
  constructor() {
    this.notificationPermission = Notification.permission;
    this.targetStates = new Map(); // Track previous states for change detection
    this.inPageNotifications = [];
    this.maxInPageNotifications = 5;

    // Request notification permission if not already granted
    if (this.notificationPermission === 'default') {
      this.requestPermission();
    }

    // Initialize notification container
    this.initializeContainer();
  }

  /**
   * Request notification permission from user
   */
  async requestPermission() {
    try {
      const permission = await Notification.requestPermission();
      this.notificationPermission = permission;

      if (permission === 'granted') {
        console.log('✓ Browser notifications enabled');
      } else if (permission === 'denied') {
        console.log('✗ Browser notifications disabled by user');
      }
    } catch (err) {
      console.error('Error requesting notification permission:', err);
    }
  }

  /**
   * Initialize notification container in DOM
   */
  initializeContainer() {
    if (!document.getElementById('notification-container')) {
      const container = document.createElement('div');
      container.id = 'notification-container';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        max-width: 400px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
  }

  /**
   * Show browser notification
   */
  showBrowserNotification(title, options = {}) {
    if (this.notificationPermission !== 'granted') {
      return;
    }

    try {
      const notification = new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        ...options,
      });

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);

      // Handle click
      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      return notification;
    } catch (err) {
      console.error('Error showing browser notification:', err);
    }
  }

  /**
   * Show in-page toast notification
   */
  showToastNotification(message, type = 'info', duration = 4000) {
    const container = document.getElementById('notification-container');
    if (!container) {
      this.initializeContainer();
      return this.showToastNotification(message, type, duration);
    }

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = message;

    const colors = {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6',
    };

    notification.style.cssText = `
      background-color: ${colors[type] || colors.info};
      color: white;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 10px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      animation: slideIn 0.3s ease-out;
      pointer-events: auto;
      cursor: pointer;
    `;

    // Add animation
    if (!document.querySelector('style[data-notification-styles]')) {
      const style = document.createElement('style');
      style.setAttribute('data-notification-styles', 'true');
      style.textContent = `
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(400px);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    container.appendChild(notification);

    // Click to dismiss
    notification.addEventListener('click', () => {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    });

    // Auto-dismiss
    setTimeout(() => {
      if (notification.parentElement) {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
      }
    }, duration);

    // Track notifications
    this.inPageNotifications.push(notification);
    if (this.inPageNotifications.length > this.maxInPageNotifications) {
      const old = this.inPageNotifications.shift();
      old.remove();
    }
  }

  /**
   * Update target status and send notifications if changed
   */
  updateTargetStatus(targetId, targetName, newStatus) {
    const previousStatus = this.targetStates.get(targetId);

    // No change
    if (previousStatus === newStatus) {
      return;
    }

    // Store new state
    this.targetStates.set(targetId, newStatus);

    // Only send notifications if transitioning from a known state
    if (previousStatus === undefined) {
      return;
    }

    if (newStatus === 'up') {
      this.notifyTargetUp(targetName);
    } else if (newStatus === 'down') {
      this.notifyTargetDown(targetName);
    }
  }

  /**
   * Notify when target comes online
   */
  notifyTargetUp(targetName) {
    const message = `✓ ${targetName} is back online`;

    // Browser notification
    this.showBrowserNotification('Target Online', {
      body: message,
      tag: `target-${targetName}`,
      requireInteraction: false,
    });

    // In-page notification
    this.showToastNotification(message, 'success');
  }

  /**
   * Notify when target goes offline
   */
  notifyTargetDown(targetName) {
    const message = `✗ ${targetName} is offline`;

    // Browser notification
    this.showBrowserNotification('Target Offline', {
      body: message,
      tag: `target-${targetName}`,
      requireInteraction: true,
    });

    // In-page notification
    this.showToastNotification(message, 'error', 0); // Don't auto-dismiss for errors
  }

  /**
   * Get notification preference from localStorage
   */
  getPreference(key, defaultValue = true) {
    const stored = localStorage.getItem(`notification-${key}`);
    return stored !== null ? stored === 'true' : defaultValue;
  }

  /**
   * Set notification preference
   */
  setPreference(key, value) {
    localStorage.setItem(`notification-${key}`, value ? 'true' : 'false');
  }

  /**
   * Check if notifications are enabled
   */
  isEnabled() {
    return this.notificationPermission === 'granted' && this.getPreference('enabled', true);
  }

  /**
   * Toggle notifications
   */
  toggleNotifications(enabled) {
    this.setPreference('enabled', enabled);
    if (enabled && this.notificationPermission === 'default') {
      this.requestPermission();
    }
    return this.isEnabled();
  }
}

// Initialize and export
const notificationManager = new NotificationManager();

// Make available globally
if (typeof window !== 'undefined') {
  window.notificationManager = notificationManager;
}
