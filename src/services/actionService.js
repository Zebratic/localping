const { exec } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const chalk = require('chalk');

const execAsync = promisify(exec);

class ActionService {
  /**
   * Execute a quick-fix action
   */
  async executeAction(action) {
    try {
      const start = Date.now();

      switch (action.type) {
        case 'command':
          return await this.executeCommand(action);
        case 'ssh':
          return await this.executeSSH(action);
        case 'http':
          return await this.executeHTTP(action);
        case 'script':
          return await this.executeScript(action);
        default:
          return {
            success: false,
            error: 'Unknown action type: ' + action.type,
            executionTime: Date.now() - start,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        executionTime: 0,
      };
    }
  }

  /**
   * Execute a local shell command
   */
  async executeCommand(action) {
    const start = Date.now();

    try {
      const { stdout, stderr } = await execAsync(action.command, {
        timeout: action.timeout || 30000,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });

      const executionTime = Date.now() - start;

      return {
        success: true,
        stdout,
        stderr,
        executionTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout,
        stderr: error.stderr,
        executionTime: Date.now() - start,
      };
    }
  }

  /**
   * Execute a command via SSH
   */
  async executeSSH(action) {
    const start = Date.now();

    try {
      // Build SSH command
      let cmd = 'ssh';

      // Add port if specified
      if (action.port) {
        cmd += ` -p ${action.port}`;
      }

      // Add user@host
      if (action.user) {
        cmd += ` ${action.user}@${action.host}`;
      } else {
        cmd += ` ${action.host}`;
      }

      // Add the remote command
      cmd += ` "${action.command}"`;

      const { stdout, stderr } = await execAsync(cmd, {
        timeout: action.timeout || 30000,
        maxBuffer: 1024 * 1024 * 10,
      });

      const executionTime = Date.now() - start;

      return {
        success: true,
        stdout,
        stderr,
        executionTime,
        host: action.host,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout,
        stderr: error.stderr,
        executionTime: Date.now() - start,
        host: action.host,
      };
    }
  }

  /**
   * Execute an HTTP request
   */
  async executeHTTP(action) {
    const start = Date.now();

    try {
      const method = action.method || 'GET';
      const url = action.url;
      const headers = action.headers || {};
      const data = action.data || null;

      const response = await axios({
        method,
        url,
        headers,
        data,
        timeout: action.timeout || 10000,
        validateStatus: () => true,
      });

      const executionTime = Date.now() - start;

      return {
        success: response.status >= 200 && response.status < 400,
        statusCode: response.status,
        responseData: response.data,
        executionTime,
        url,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - start,
        url: action.url,
      };
    }
  }

  /**
   * Execute a script file
   */
  async executeScript(action) {
    const start = Date.now();

    try {
      let cmd = action.scriptPath;

      // Add arguments if provided
      if (action.args && Array.isArray(action.args)) {
        cmd += ' ' + action.args.join(' ');
      }

      const { stdout, stderr } = await execAsync(cmd, {
        timeout: action.timeout || 60000,
        maxBuffer: 1024 * 1024 * 10,
      });

      const executionTime = Date.now() - start;

      return {
        success: true,
        stdout,
        stderr,
        executionTime,
        script: action.scriptPath,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout,
        stderr: error.stderr,
        executionTime: Date.now() - start,
        script: action.scriptPath,
      };
    }
  }

  /**
   * Execute multiple actions in sequence
   */
  async executeActionSequence(actions) {
    const results = [];

    for (const action of actions) {
      const result = await this.executeAction(action);
      results.push(result);

      // Stop on first failure if stopOnError is true
      if (!result.success && action.stopOnError) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute multiple actions in parallel
   */
  async executeActionParallel(actions) {
    return Promise.all(actions.map((action) => this.executeAction(action)));
  }
}

module.exports = new ActionService();
