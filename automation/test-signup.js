/**
 * Test Facebook Signup
 * 
 * Run: node automation/test-signup.js
 */

import FacebookSignup from './fb-signup.js';
import { logger } from './utils/logger.js';

async function test() {
  logger.info('Starting Facebook signup test...\n');

  const signup = new FacebookSignup({
    // Option 1: Auto-generate everything
    auto: true,
    headless: false, // Set to true for headless mode
    
    // Option 2: Or specify custom data
    // email: 'custom@example.com',
    // password: 'MySecurePass123',
    // firstName: 'John',
    // lastName: 'Doe',
    // gender: 'male',
    
    // Optional: Use proxy
    // proxy: 'proxy.example.com:8080:user:pass'
  });

  try {
    const result = await signup.run();

    logger.info('\n' + '='.repeat(60));
    logger.info('TEST RESULT');
    logger.info('='.repeat(60) + '\n');

    console.log(JSON.stringify(result, null, 2));

    if (result.status === 'success') {
      logger.success('\n✅ Test PASSED - Account created successfully!');
      logger.info(`Email: ${result.email}`);
      logger.info(`Password: ${result.password}`);
      logger.info(`Cookies: ${result.cookies ? result.cookies.length : 0} cookies extracted`);
    } else if (result.status === 'partial') {
      logger.warn('\n⚠️  Test PARTIAL - Account created but verification incomplete');
      logger.info(`Email: ${result.email}`);
      logger.info(`Password: ${result.password}`);
    } else {
      logger.error('\n❌ Test FAILED');
      logger.error(`Error: ${result.error}`);
    }

    logger.info('\nSteps executed:');
    result.steps.forEach((step, index) => {
      const icon = step.success ? '✓' : '✗';
      logger.info(`  ${icon} ${index + 1}. ${step.step} ${step.message ? `- ${step.message}` : ''}`);
    });

  } catch (error) {
    logger.error('\n❌ Test FAILED with exception');
    logger.error(error.message);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

test().catch((error) => {
  logger.error('Unhandled error:', error.message);
  process.exit(1);
});
