const { gateway4async, gateway6async } = require('default-gateway');
const chalk = require('chalk');

class GatewayService {
  constructor() {
    this.gateway4 = null;
    this.gateway6 = null;
    this.interface4 = null;
    this.interface6 = null;
  }

  /**
   * Detect the default IPv4 gateway
   */
  async detectGateway4() {
    try {
      const result = await gateway4async();
      if (result && result.gateway) {
        this.gateway4 = result.gateway;
        this.interface4 = result.interface;
        console.log(
          chalk.green('✓ Detected IPv4 gateway:'),
          `${this.gateway4} (${this.interface4})`
        );
        return this.gateway4;
      }
    } catch (error) {
      console.warn(chalk.yellow('⚠ Could not detect IPv4 gateway:'), error.message);
    }
    return null;
  }

  /**
   * Detect the default IPv6 gateway
   */
  async detectGateway6() {
    try {
      const result = await gateway6async();
      if (result && result.gateway) {
        this.gateway6 = result.gateway;
        this.interface6 = result.interface;
        console.log(
          chalk.green('✓ Detected IPv6 gateway:'),
          `${this.gateway6} (${this.interface6})`
        );
        return this.gateway6;
      }
    } catch (error) {
      console.warn(chalk.yellow('⚠ Could not detect IPv6 gateway:'), error.message);
    }
    return null;
  }

  /**
   * Detect both IPv4 and IPv6 gateways
   */
  async detectAllGateways() {
    await Promise.all([this.detectGateway4(), this.detectGateway6()]);
    return {
      gateway4: this.gateway4,
      gateway6: this.gateway6,
      interface4: this.interface4,
      interface6: this.interface6,
    };
  }

  /**
   * Get the primary gateway (IPv4 preferably)
   */
  getPrimaryGateway() {
    return this.gateway4 || this.gateway6 || null;
  }

  /**
   * Get all detected gateways
   */
  getAllGateways() {
    const gateways = [];
    if (this.gateway4) gateways.push({ ip: this.gateway4, version: 4, interface: this.interface4 });
    if (this.gateway6) gateways.push({ ip: this.gateway6, version: 6, interface: this.interface6 });
    return gateways;
  }
}

module.exports = new GatewayService();
