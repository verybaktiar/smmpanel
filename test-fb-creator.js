/**
 * Test Facebook Account Creator dengan browser visible
 * Run: node test-fb-creator.js
 */

const FacebookAccountCreator = require('./src/fb-account-creator');

async function test() {
  console.log('🚀 Testing Facebook Account Creator with visible browser...\n');
  
  const creator = new FacebookAccountCreator({
    email: 'hawinvery35@googlemail.com',
    firstName: 'Sarah',
    lastName: 'Anderson',
    password: 'TestPass123!@#',
    headless: false,
    saveToDatabase: false,
  });
  
  console.log('Using email: hawinvery35@googlemail.com');
  console.log('Name: Sarah Anderson\n');

  try {
    const result = await creator.run();
    
    console.log('\n✅ Result:', JSON.stringify(result, null, 2));
    
    if (result.status === 'success') {
      console.log('\n✅ Account created successfully!');
      console.log('Email:', result.email);
      console.log('Password:', result.password);
    } else {
      console.log('\n❌ Failed:', result.error);
    }
    
    console.log('\nSteps completed:');
    result.steps.forEach((step, i) => {
      const icon = step.success ? '✅' : '❌';
      console.log(`${i + 1}. ${icon} ${step.step}: ${step.message}`);
    });
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
  
  console.log('\n✅ Test completed. Check browser for details.');
}

test().catch(console.error);
