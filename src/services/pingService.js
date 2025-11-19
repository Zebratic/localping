const { exec } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const tcpPing = require('tcp-ping');
const { promisify: promisifyTcp } = require('util');
const dgram = require('dgram');
const chalk = require('chalk');

const execAsync = promisify(exec);

class PingService {
  constructor() {
    this.timeout = 5000; // 5 seconds default timeout
  }

  /**
   * Ping a target using the specified protocol
   * @param {Object} target - Target object {host, port, protocol, timeout}
   * @returns {Promise<Object>} Result {success, responseTime, error}
   */
  async ping(target) {
    const start = Date.now();

    try {
      switch (target.protocol?.toUpperCase()) {
        case 'ICMP':
          return await this.pingICMP(target.host, start);
        case 'TCP':
          return await this.pingTCP(target.host, target.port || 80, start);
        case 'UDP':
          return await this.pingUDP(target.host, target.port || 53, start);
        case 'HTTP':
          return await this.pingHTTP(`http://${target.host}:${target.port || 80}${target.path || '/'}`, start);
        case 'HTTPS':
          return await this.pingHTTP(`https://${target.host}:${target.port || 443}${target.path || '/'}`, start);
        default:
          return {
            success: false,
            responseTime: 0,
            error: 'Unknown protocol: ' + target.protocol,
          };
      }
    } catch (error) {
      return {
        success: false,
        responseTime: Date.now() - start,
        error: error.message,
      };
    }
  }

  /**
   * ICMP Ping using system ping command
   * Requires running with elevated privileges
   */
  async pingICMP(host, start) {
    try {
      // Using -c 1 for Linux/Mac, -n 1 for Windows
      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? `ping -n 1 -w ${this.timeout} ${host}` : `ping -c 1 -W ${this.timeout / 1000} ${host}`;

      const { stdout } = await execAsync(cmd, { timeout: this.timeout + 1000 });

      const responseTime = Date.now() - start;
      return {
        success: true,
        responseTime,
        protocol: 'ICMP',
      };
    } catch (error) {
      return {
        success: false,
        responseTime: Date.now() - start,
        error: 'ICMP ping failed: ' + error.message,
        protocol: 'ICMP',
      };
    }
  }

  /**
   * TCP Ping to a specific port
   */
  async pingTCP(host, port, start) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      tcpPing.probe(host, port, (err, available) => {
        const responseTime = Date.now() - startTime;

        if (err || !available) {
          resolve({
            success: false,
            responseTime,
            error: err ? err.message : 'Connection refused',
            protocol: 'TCP',
          });
        } else {
          resolve({
            success: true,
            responseTime,
            protocol: 'TCP',
          });
        }
      });
    });
  }

  /**
   * UDP Ping (simple datagram send/receive)
   */
  async pingUDP(host, port, start) {
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      const message = Buffer.from('ping');

      const timeoutHandle = setTimeout(() => {
        client.close();
        resolve({
          success: false,
          responseTime: Date.now() - start,
          error: 'UDP ping timeout',
          protocol: 'UDP',
        });
      }, this.timeout);

      client.send(message, 0, message.length, port, host, (err) => {
        if (err) {
          clearTimeout(timeoutHandle);
          client.close();
          resolve({
            success: false,
            responseTime: Date.now() - start,
            error: 'UDP send failed: ' + err.message,
            protocol: 'UDP',
          });
        }
      });

      client.on('message', () => {
        clearTimeout(timeoutHandle);
        client.close();
        resolve({
          success: true,
          responseTime: Date.now() - start,
          protocol: 'UDP',
        });
      });

      client.on('error', (err) => {
        clearTimeout(timeoutHandle);
        client.close();
        resolve({
          success: false,
          responseTime: Date.now() - start,
          error: 'UDP error: ' + err.message,
          protocol: 'UDP',
        });
      });
    });
  }

  /**
   * HTTP/HTTPS Ping
   */
  async pingHTTP(url, start) {
    try {
      const response = await axios.get(url, {
        timeout: this.timeout,
        validateStatus: () => true, // Don't throw on any status code
      });

      const responseTime = Date.now() - start;
      const success = response.status >= 200 && response.status < 500;

      return {
        success,
        responseTime,
        statusCode: response.status,
        protocol: url.startsWith('https') ? 'HTTPS' : 'HTTP',
      };
    } catch (error) {
      return {
        success: false,
        responseTime: Date.now() - start,
        error: error.message,
        protocol: url.startsWith('https') ? 'HTTPS' : 'HTTP',
      };
    }
  }

  /**
   * Batch ping multiple targets
   */
  async pingBatch(targets) {
    const results = await Promise.all(targets.map((target) => this.ping(target)));
    return results;
  }
}

module.exports = new PingService();
