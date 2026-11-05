/**
 * Simple Logger Utility
 * 
 * Usage:
 *   import { logger } from './utils/logger.js';
 *   logger.info('Message');
 *   logger.error('Error message');
 */

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export const logger = {
  info(message, ...args) {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.cyan}[INFO]${colors.reset} ${message}`, ...args);
  },
  
  success(message, ...args) {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.green}[SUCCESS]${colors.reset} ${message}`, ...args);
  },
  
  warn(message, ...args) {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.yellow}[WARN]${colors.reset} ${message}`, ...args);
  },
  
  error(message, ...args) {
    console.error(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.red}[ERROR]${colors.reset} ${message}`, ...args);
  },
  
  debug(message, ...args) {
    if (process.env.DEBUG) {
      console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.magenta}[DEBUG]${colors.reset} ${message}`, ...args);
    }
  },
  
  step(message, ...args) {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.blue}[STEP]${colors.reset} ${message}`, ...args);
  }
};
