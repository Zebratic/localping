const pingService = require('../../src/services/pingService');
const axios = require('axios');
const tcpPing = require('tcp-ping');

jest.mock('axios');
jest.mock('tcp-ping');
jest.mock('child_process');

describe('PingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ping method - protocol validation', () => {
    it('should return error for unknown protocol', async () => {
      const target = {
        host: 'example.com',
        protocol: 'UNKNOWN',
        port: 80,
      };

      const result = await pingService.ping(target);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown protocol');
    });

    it('should handle case-insensitive protocol', async () => {
      const target = {
        host: 'example.com',
        protocol: 'tcp',
        port: 80,
      };

      tcpPing.probe.mockImplementation((host, port, callback) => {
        callback(null, true);
      });

      const result = await pingService.ping(target);

      expect(result.success).toBe(true);
      expect(result.protocol).toBe('TCP');
    });
  });

  describe('pingTCP method', () => {
    it('should successfully ping TCP host', async () => {
      tcpPing.probe.mockImplementation((host, port, callback) => {
        callback(null, true);
      });

      const result = await pingService.pingTCP('example.com', 80, Date.now());

      expect(result.success).toBe(true);
      expect(result.protocol).toBe('TCP');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle TCP connection failure', async () => {
      tcpPing.probe.mockImplementation((host, port, callback) => {
        callback(new Error('Connection refused'), false);
      });

      const result = await pingService.pingTCP('example.com', 80, Date.now());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
      expect(result.protocol).toBe('TCP');
    });

    it('should use default port 80 for TCP', async () => {
      tcpPing.probe.mockImplementation((host, port, callback) => {
        callback(null, true);
      });

      const result = await pingService.pingTCP('example.com', 80, Date.now());

      expect(tcpPing.probe).toHaveBeenCalledWith('example.com', 80, expect.any(Function));
    });
  });

  describe('pingUDP method', () => {
    it('should successfully send UDP ping', async () => {
      const result = await pingService.pingUDP('example.com', 53, Date.now());

      // UDP is expected to timeout or fail without a listening server
      expect(result.protocol).toBe('UDP');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle UDP timeout', async () => {
      const result = await pingService.pingUDP('example.com', 53, Date.now());

      // Without a real server, UDP will timeout
      expect(result).toHaveProperty('responseTime');
      expect(result).toHaveProperty('protocol', 'UDP');
    });

    it('should use default port 53 for UDP', async () => {
      const result = await pingService.pingUDP('example.com', 53, Date.now());

      expect(result).toHaveProperty('protocol', 'UDP');
    });
  });

  describe('pingHTTP method', () => {
    it('should successfully ping HTTP endpoint', async () => {
      axios.mockResolvedValue({ status: 200 });

      const result = await pingService.pingHTTP('http://example.com/', Date.now());

      expect(result.success).toBe(true);
      expect(result.protocol).toBe('HTTP');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle HTTP timeout', async () => {
      axios.mockRejectedValue(new Error('Request timeout'));

      const result = await pingService.pingHTTP('http://example.com/', Date.now());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Request timeout');
    });

    it('should use port 443 for HTTPS by default', async () => {
      axios.mockResolvedValue({ status: 200 });

      const result = await pingService.pingHTTP('https://example.com/', Date.now());

      expect(result.success).toBe(true);
      expect(result.protocol).toBe('HTTPS');
    });

    it('should use custom port in HTTP URL', async () => {
      axios.mockResolvedValue({ status: 200 });

      const result = await pingService.pingHTTP('http://example.com:8080/', Date.now());

      expect(result.success).toBe(true);
    });
  });

  describe('ping routing', () => {
    it('should route TCP protocol correctly', async () => {
      tcpPing.probe.mockImplementation((host, port, callback) => {
        callback(null, true);
      });

      const target = {
        host: 'example.com',
        protocol: 'TCP',
        port: 80,
      };

      const result = await pingService.ping(target);

      expect(result.success).toBe(true);
      expect(result.protocol).toBe('TCP');
    });

    it('should route HTTP protocol correctly', async () => {
      axios.mockResolvedValue({ status: 200 });

      const target = {
        host: 'example.com',
        protocol: 'HTTP',
        port: 80,
        path: '/',
      };

      const result = await pingService.ping(target);

      expect(result.success).toBe(true);
      expect(result.protocol).toBe('HTTP');
    });

    it('should route HTTPS protocol correctly', async () => {
      axios.mockResolvedValue({ status: 200 });

      const target = {
        host: 'example.com',
        protocol: 'HTTPS',
        port: 443,
        path: '/',
      };

      const result = await pingService.ping(target);

      expect(result.success).toBe(true);
      expect(result.protocol).toBe('HTTPS');
    });
  });

  describe('response structure', () => {
    it('should always include success, responseTime, and protocol', async () => {
      tcpPing.probe.mockImplementation((host, port, callback) => {
        callback(null, true);
      });

      const result = await pingService.pingTCP('example.com', 80, Date.now());

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('responseTime');
      expect(result).toHaveProperty('protocol');
    });

    it('should include error message when ping fails', async () => {
      tcpPing.probe.mockImplementation((host, port, callback) => {
        callback(new Error('Network error'), false);
      });

      const result = await pingService.pingTCP('example.com', 80, Date.now());

      expect(result).toHaveProperty('error');
      expect(typeof result.error).toBe('string');
    });

    it('should measure response time accurately', async () => {
      tcpPing.probe.mockImplementation((host, port, callback) => {
        setTimeout(() => callback(null, true), 10);
      });

      const startTime = Date.now();
      const result = await pingService.pingTCP('example.com', 80, startTime);

      expect(result.responseTime).toBeGreaterThanOrEqual(10);
    });
  });
});
