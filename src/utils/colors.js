// Simple color output utility (alternative to chalk for compatibility)
module.exports = {
  green: (str) => `\x1b[32m${str}\x1b[39m`,
  cyan: (str) => `\x1b[36m${str}\x1b[39m`,
  yellow: (str) => `\x1b[33m${str}\x1b[39m`,
  red: (str) => `\x1b[31m${str}\x1b[39m`,
  blue: (str) => `\x1b[34m${str}\x1b[39m`,
  magenta: (str) => `\x1b[35m${str}\x1b[39m`,
  gray: (str) => `\x1b[90m${str}\x1b[39m`,
  bold: (str) => `\x1b[1m${str}\x1b[22m`,
};
