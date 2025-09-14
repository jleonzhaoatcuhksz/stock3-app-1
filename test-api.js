const axios = require('axios');
const { performance } = require('perf_hooks');

const BASE_URL = 'http://localhost:3006';
const TEST_SYMBOLS = ['AAPL', 'MSFT', 'INVALID'];
const TEST_DELAY = 15000; // 15 seconds between tests

async function testEndpoint(url) {
  try {
    const startTime = performance.now();
    const response = await axios.get(url);
    const endTime = performance.now();
    
    return {
      success: true,
      status: response.status,
      data: response.data,
      responseTime: endTime - startTime
    };
  } catch (error) {
    return {
      success: false,
      status: error.response?.status,
      error: error.response?.data || error.message
    };
  }
}

async function runTests() {
  console.log('Starting API tests...');

  // Test basic endpoints
  const healthTest = await testEndpoint(`${BASE_URL}/health`);
  const docsTest = await testEndpoint(`${BASE_URL}/api-docs`);
  const usageTest = await testEndpoint(`${BASE_URL}/api-usage`);

  console.log('\nBasic Endpoints:');
  console.log('1. Health Check:', {
    status: healthTest.status,
    uptime: healthTest.data?.data?.uptime ? healthTest.data.data.uptime.toFixed(2) : 'N/A',
    responseTime: healthTest.responseTime ? `${healthTest.responseTime.toFixed(2)}ms` : 'N/A'
  });
  console.log('2. API Docs:', {
    status: docsTest.status,
    endpoints: Object.keys(docsTest.data?.data?.endpoints || {})
  });
  console.log('3. API Usage:', {
    status: usageTest.status,
    dailyUsage: usageTest.data?.data?.usage?.[0]?.daily
  });

  // Test stock endpoints
  console.log('\nStock Data Tests:');
  for (const symbol of TEST_SYMBOLS) {
    const test = await testEndpoint(`${BASE_URL}/api/stock/${symbol}`);
    
    console.log(`${symbol}:`, {
      status: test.status,
      valid: test.success,
      symbol: test.data?.data?.symbol || 'N/A',
      dataPoints: test.data?.data?.dataPoints || 0,
      cached: test.data?.data?.cached || false,
      responseTime: test.responseTime ? `${test.responseTime.toFixed(2)}ms` : 'N/A',
      error: test.error || 'None'
    });

    if (symbol !== TEST_SYMBOLS[TEST_SYMBOLS.length - 1]) {
      console.log(`\nWaiting ${TEST_DELAY/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, TEST_DELAY));
    }
  }
}

runTests().catch(err => console.error('Test error:', err));