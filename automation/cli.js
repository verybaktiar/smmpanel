#!/usr/bin/env node
/**
 * Facebook Signup CLI Tool
 * 
 * Usage:
 *   node automation/cli.js --email test@example.com --password MyPass123
 *   node automation/cli.js --auto --proxy "host:port:user:pass" --headless
 *   node automation/cli.js --batch 5 --delay 10000
 */

import FacebookSignup from './fb-signup.js';
import { logger } from './utils/logger.js';
import { parseProxy } from './utils/proxy-parser.js';
import fs from 'fs/promises';
import path from 'path';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    email: null,
    password: null,
    firstName: null,
    lastName: null,
    gender: null,
    proxy: null,
    headless: false,
    auto: false,
    batch: 1,
    delay: 5000,
    output: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--email':
      case '-e':
        options.email = next;
        i++;
        break;
      case '--password':
      case '-p':
        options.password = next;
        i++;
        break;
      case '--first-name':
      case '-f':
        options.firstName = next;
        i++;
        break;
      case '--last-name':
      case '-l':
        options.lastName = next;
        i++;
        break;
      case '--gender':
      case '-g':
        options.gender = next;
        i++;
        break;
      case '--proxy':
        options.proxy = next;
        i++;
        break;
      case '--headless':
      case '-H':
        options.headless = true;
        break;
      case '--auto':
      case '-a':
        options.auto = true;
        break;
      case '--batch':
      case '-b':
        options.batch = parseInt(next, 10);
        i++;
        break;
      case '--delay':
      case '-d':
        options.delay = parseInt(next, 10);
        i++;
        break;
      case '--output':
      case '-o':
        options.output = next;
        i++;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

// Show help
function showHelp() {
  console.log(`
Facebook Account Auto-Signup Tool

Usage:
  node automation/cli.js [options]

Options:
  -e, --email <email>         Email address (or auto-generate if --auto)
  -p, --password <password>   Password for account
  -f, --first-name <name>     First name (or random)
  -l, --last-name <name>      Last name (or random)
  -g, --gender <male|female>  Gender (or random)
  --proxy <proxy-string>      Proxy (format: host:port:user:pass)
  -H, --headless              Run in headless mode
  -a, --auto                  Auto-generate all data
  -b, --batch <number>        Create multiple accounts (default: 1)
  -d, --delay <ms>            Delay between batch signups (default: 5000)
  -o, --output <file>         Save results to JSON file
  -h, --help                  Show this help message

Examples:
  # Create single account with provided email
  node automation/cli.js --email test@example.com --password MyPass123

  # Auto-generate everything
  node automation/cli.js --auto --headless

  # Create 5 accounts with proxy
  node automation/cli.js --auto --batch 5 --proxy "host:port:user:pass"

  # Create account and save results
  node automation/cli.js --auto --output results.json

Environment:
  Set variables in automation/.env file:
  - AMMAIL_BASE_URL: Temp email worker URL
  - AMMAIL_API_KEY: API key for temp email
  - AMMAIL_DOMAIN: Email domain
  - CAPTCHA_API_KEY: 2Captcha API key (optional)
`);
}

// Save results to file
async function saveResults(results, filepath) {
  try {
    const dir = path.dirname(filepath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(results, null, 2));
    logger.success(`Results saved to: ${filepath}`);
  } catch (error) {
    logger.error('Failed to save results:', error.message);
  }
}

// Run single signup
async function runSingleSignup(options) {
  const signup = new FacebookSignup(options);
  const result = await signup.run();
  return result;
}

// Run batch signups
async function runBatchSignups(options) {
  const results = [];
  
  logger.info(`Starting batch signup: ${options.batch} accounts\n`);

  for (let i = 0; i < options.batch; i++) {
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`Account ${i + 1} of ${options.batch}`);
    logger.info(`${'='.repeat(60)}\n`);

    try {
      const result = await runSingleSignup(options);
      results.push(result);

      // Log summary
      if (result.status === 'success') {
        logger.success(`✅ Account ${i + 1}: ${result.email}`);
      } else {
        logger.error(`❌ Account ${i + 1}: Failed - ${result.error}`);
      }

      // Delay before next signup (except last one)
      if (i < options.batch - 1) {
        logger.info(`\nWaiting ${options.delay}ms before next signup...\n`);
        await new Promise(resolve => setTimeout(resolve, options.delay));
      }
    } catch (error) {
      logger.error(`Account ${i + 1} failed:`, error.message);
      results.push({
        status: 'failed',
        error: error.message
      });
    }
  }

  return results;
}

// Main function
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Validate options
  if (!options.auto && !options.email) {
    logger.error('Error: --email required (or use --auto to generate)');
    showHelp();
    process.exit(1);
  }

  if (!options.auto && !options.password) {
    logger.error('Error: --password required (or use --auto to generate)');
    showHelp();
    process.exit(1);
  }

  // Validate proxy if provided
  if (options.proxy) {
    const proxyConfig = parseProxy(options.proxy);
    if (!proxyConfig) {
      logger.error('Error: Invalid proxy format');
      logger.info('Supported formats:');
      logger.info('  - http://user:pass@host:port');
      logger.info('  - socks5://host:port');
      logger.info('  - host:port:user:pass');
      process.exit(1);
    }
  }

  try {
    let results;

    if (options.batch > 1) {
      results = await runBatchSignups(options);
    } else {
      const result = await runSingleSignup(options);
      results = [result];
    }

    // Print summary
    logger.info(`\n${'='.repeat(60)}`);
    logger.info('SUMMARY');
    logger.info(`${'='.repeat(60)}\n`);

    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const partial = results.filter(r => r.status === 'partial').length;

    logger.success(`✅ Successful: ${successful}`);
    if (partial > 0) logger.warn(`⚠️  Partial: ${partial}`);
    if (failed > 0) logger.error(`❌ Failed: ${failed}`);

    // Save results to file
    if (options.output) {
      await saveResults(results, options.output);
    }

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    logger.error('Fatal error:', error.message);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection:', error.message);
  if (process.env.DEBUG) {
    console.error(error);
  }
  process.exit(1);
});

// Run
main();
