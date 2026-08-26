jest.useFakeTimers();

jest.mock('../../src/services/pingService', () => ({
  ping: jest.fn(),
}));

jest.mock('../../src/services/notificationService', () => ({
  getMonitorDownDelayMinutes: jest.fn().mockResolvedValue(1),
}));

jest.mock('../../src/config/prisma', () => ({
  getPrisma: () => ({
    adminSettings: { findUnique: jest.fn().mockResolvedValue({ debugLogging: false }) },
    pingResult: { create: jest.fn().mockResolvedValue({}) },
    statistic: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalPings: 0, successfulPings: 0 } }),
    },
    alert: { create: jest.fn().mockResolvedValue({}) },
  }),
}));

jest.mock('../../src/services/eventDetectionService', () => ({
  evaluateRules: jest.fn().mockResolvedValue(undefined),
}));

const pingService = require('../../src/services/pingService');
const monitorService = require('../../src/services/monitorService');

const target = {
  id: 'monitor-delay-test',
  _id: 'monitor-delay-test',
  name: 'Delay test',
  host: 'example.test',
  protocol: 'HTTPS',
  interval: 60,
  retries: 0,
};

function settle() {
  return Promise.resolve().then(() => Promise.resolve());
}

describe('MonitorService sustained outage notifications', () => {
  beforeEach(() => {
    monitorService.stopAllMonitoring();
    monitorService.setNotificationDelayMinutes(1);
    monitorService.handleTargetDown = jest.fn().mockResolvedValue({});
    monitorService.handleTargetUp = jest.fn().mockResolvedValue({});
    pingService.ping.mockReset();
  });

  afterEach(() => {
    monitorService.stopAllMonitoring();
  });

  it('does not notify for an outage that recovers before the delay', async () => {
    pingService.ping.mockResolvedValueOnce({ success: false, responseTime: null })
      .mockResolvedValueOnce({ success: true, responseTime: 12 });

    await monitorService.pingTarget(target);
    await settle();
    jest.advanceTimersByTime(59 * 1000);
    await monitorService.pingTarget(target);
    jest.runOnlyPendingTimers();
    await settle();

    expect(monitorService.handleTargetDown).not.toHaveBeenCalled();
    // Recovery is still recorded internally; only the external notification
    // is suppressed because the outage did not reach the configured delay.
    expect(monitorService.handleTargetUp).toHaveBeenCalledTimes(1);
    expect(monitorService.handleTargetUp).toHaveBeenCalledWith(
      target,
      12,
      expect.any(Number),
      false,
    );
    expect(monitorService.getNotificationState(target.id).notificationSent).toBe(false);
  });

  it('sends one down notification after the configured delay and then one recovery notification', async () => {
    pingService.ping.mockResolvedValueOnce({ success: false, responseTime: null })
      .mockResolvedValueOnce({ success: true, responseTime: 18 });

    await monitorService.pingTarget(target);
    await settle();
    expect(monitorService.handleTargetDown).not.toHaveBeenCalled();

    jest.advanceTimersByTime(60 * 1000);
    await settle();
    expect(monitorService.handleTargetDown).toHaveBeenCalledTimes(1);

    await monitorService.pingTarget(target);
    jest.runOnlyPendingTimers();
    await settle();
    expect(monitorService.handleTargetUp).toHaveBeenCalledTimes(1);
    expect(monitorService.handleTargetUp).toHaveBeenCalledWith(
      target,
      18,
      expect.any(Number),
      true,
    );
  });

  it('uses the in-memory delay when the settings lookup fails', async () => {
    const notificationService = require('../../src/services/notificationService');
    notificationService.getMonitorDownDelayMinutes.mockRejectedValueOnce(new Error('database unavailable'));
    monitorService.setNotificationDelayMinutes(1);
    pingService.ping.mockResolvedValueOnce({ success: false, responseTime: null });

    await monitorService.pingTarget(target);
    await settle();
    jest.advanceTimersByTime(60 * 1000);
    await settle();

    expect(monitorService.handleTargetDown).toHaveBeenCalledTimes(1);
  });

  it('reschedules an active outage when the global delay changes', async () => {
    const notificationService = require('../../src/services/notificationService');
    notificationService.getMonitorDownDelayMinutes.mockResolvedValue(1);
    monitorService.setNotificationDelayMinutes(5);
    pingService.ping.mockResolvedValueOnce({ success: false, responseTime: null });

    monitorService.startTargetMonitor({ ...target, interval: 3600 });
    await monitorService.pingTarget(target, monitorService.monitorGeneration.get(target.id));
    await settle();

    jest.advanceTimersByTime(30 * 1000);
    monitorService.setNotificationDelayMinutes(1);
    await settle();
    jest.advanceTimersByTime(30 * 1000);
    await settle();

    expect(monitorService.handleTargetDown).toHaveBeenCalledTimes(1);
  });

  it('does not let an older settings lookup replace a newer delay', async () => {
    const notificationService = require('../../src/services/notificationService');
    let resolveDelay;
    notificationService.getMonitorDownDelayMinutes.mockReturnValueOnce(new Promise(resolve => {
      resolveDelay = resolve;
    }));
    monitorService.setNotificationDelayMinutes(5);
    pingService.ping.mockResolvedValueOnce({ success: false, responseTime: null });

    await monitorService.pingTarget(target);
    await settle();
    monitorService.setNotificationDelayMinutes(1);
    resolveDelay(5);
    await settle();

    expect(monitorService.notificationDelayMinutes).toBe(1);
  });

  it('ignores a ping result from a monitor generation that was restarted', async () => {
    let resolvePing;
    pingService.ping.mockReturnValueOnce(new Promise(resolve => { resolvePing = resolve; }));

    monitorService.startTargetMonitor(target);
    const oldGeneration = monitorService.monitorGeneration.get(target.id);
    const oldPing = monitorService.pingTarget(target, oldGeneration);
    monitorService.startTargetMonitor(target);

    resolvePing({ success: false, responseTime: null });
    await oldPing;
    await settle();

    expect(monitorService.getTargetStatus(target.id)).toBe('unknown');
    expect(monitorService.getNotificationState(target.id).downSince).toBeNull();
  });
});
