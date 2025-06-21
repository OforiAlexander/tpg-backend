// test/auth-debug.js - Authentication Debug Test Script
// Run this script to test your authentication flow

const axios = require('axios');
const jwt = require('jsonwebtoken');

// Configuration
const API_BASE = process.env.API_URL || 'http://localhost:3001';
const TEST_CREDENTIALS = {
  email: process.env.TEST_EMAIL || 'admin@upsamail.edu.gh',
  password: process.env.TEST_PASSWORD || 'admin123'
};

console.log('🔍 TPG Authentication Debug Test');
console.log('=================================');
console.log(`API Base: ${API_BASE}`);
console.log(`Test Email: ${TEST_CREDENTIALS.email}`);
console.log('');

// Helper function to decode JWT token
const decodeToken = (token) => {
  try {
    const payload = jwt.decode(token);
    return {
      valid: true,
      payload,
      expired: payload.exp < Date.now() / 1000
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
};

// Test function for login
const testLogin = async () => {
  console.log('📝 Testing Login...');
  try {
    const response = await axios.post(`${API_BASE}/api/auth/login`, TEST_CREDENTIALS);
    
    console.log('✅ Login successful');
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    
    // Check if we got a token
    const token = response.data.token || response.data.data?.token;
    if (token) {
      console.log('🔑 Token received');
      
      // Decode token
      const tokenInfo = decodeToken(token);
      console.log('Token info:', JSON.stringify(tokenInfo, null, 2));
      
      return token;
    } else {
      console.log('❌ No token in response');
      return null;
    }
  } catch (error) {
    console.log('❌ Login failed');
    console.log('Error:', error.response?.data || error.message);
    return null;
  }
};

// Test function for profile access
const testProfile = async (token) => {
  console.log('\n👤 Testing Profile Access...');
  try {
    const response = await axios.get(`${API_BASE}/api/auth/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✅ Profile access successful');
    console.log('Response status:', response.status);
    console.log('User data:', JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
    console.log('❌ Profile access failed');
    console.log('Error status:', error.response?.status);
    console.log('Error data:', JSON.stringify(error.response?.data, null, 2));
    
    // Check if it's an auth issue
    if (error.response?.status === 401) {
      console.log('🚨 Authentication failed - token might be invalid or expired');
    }
    
    return null;
  }
};

// Test function for tickets access
const testTickets = async (token) => {
  console.log('\n🎫 Testing Tickets Access...');
  try {
    const response = await axios.get(`${API_BASE}/api/tickets`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✅ Tickets access successful');
    console.log('Response status:', response.status);
    console.log('Tickets count:', response.data.tickets?.length || response.data.data?.length || 0);
    
    return response.data;
  } catch (error) {
    console.log('❌ Tickets access failed');
    console.log('Error status:', error.response?.status);
    console.log('Error data:', JSON.stringify(error.response?.data, null, 2));
    
    return null;
  }
};

// Test health endpoint
const testHealth = async () => {
  console.log('🏥 Testing Health Endpoint...');
  try {
    const response = await axios.get(`${API_BASE}/health`);
    console.log('✅ Health check passed');
    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Health check failed');
    console.log('Error:', error.response?.data || error.message);
  }
};

// Test token validation endpoint
const testTokenValidation = async (token) => {
  console.log('\n🔐 Testing Token Validation...');
  try {
    const response = await axios.post(`${API_BASE}/api/auth/verify-token`, {}, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✅ Token validation successful');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
    console.log('❌ Token validation failed');
    console.log('Error status:', error.response?.status);
    console.log('Error data:', JSON.stringify(error.response?.data, null, 2));
    
    return null;
  }
};

// Main test runner
const runTests = async () => {
  try {
    // Test 1: Health check
    await testHealth();
    
    console.log('\n' + '='.repeat(50));
    
    // Test 2: Login
    const token = await testLogin();
    
    if (!token) {
      console.log('\n❌ Cannot continue tests without valid token');
      return;
    }
    
    console.log('\n' + '='.repeat(50));
    
    // Test 3: Token validation
    await testTokenValidation(token);
    
    console.log('\n' + '='.repeat(50));
    
    // Test 4: Profile access
    const profile = await testProfile(token);
    
    console.log('\n' + '='.repeat(50));
    
    // Test 5: Tickets access
    await testTickets(token);
    
    console.log('\n' + '='.repeat(50));
    console.log('\n🎉 Tests completed!');
    
    // Summary
    console.log('\n📊 Test Summary:');
    console.log(`Token received: ${!!token}`);
    console.log(`Profile accessible: ${!!profile}`);
    
    if (profile?.user) {
      console.log(`User role: ${profile.user.role}`);
      console.log(`User status: ${profile.user.status}`);
      console.log(`User email verified: ${!!profile.user.email_verified_at}`);
    }
    
  } catch (error) {
    console.log('\n💥 Unexpected error during tests:', error.message);
  }
};

// Debug environment function
const debugEnvironment = () => {
  console.log('\n🔧 Environment Debug:');
  console.log('Node.js version:', process.version);
  console.log('Environment variables:');
  console.log('- NODE_ENV:', process.env.NODE_ENV);
  console.log('- API_URL:', process.env.API_URL);
  console.log('- JWT_SECRET set:', !!process.env.JWT_SECRET);
  console.log('- DB_HOST:', process.env.DB_HOST);
  console.log('- DB_NAME:', process.env.DB_NAME);
  console.log('');
};

// Frontend token test
const testFrontendTokens = () => {
  console.log('\n🌐 Frontend Token Check (if running in browser):');
  
  if (typeof window !== 'undefined' && window.localStorage) {
    const tokens = {
      auth_token: localStorage.getItem('auth_token'),
      tpg_access_token: localStorage.getItem('tpg_access_token'),
      tpg_refresh_token: localStorage.getItem('tpg_refresh_token'),
      tpg_user: localStorage.getItem('tpg_user')
    };
    
    console.log('Stored tokens:');
    Object.entries(tokens).forEach(([key, value]) => {
      console.log(`- ${key}: ${value ? 'present' : 'not found'}`);
      
      if (value && key.includes('token') && !key.includes('refresh')) {
        const tokenInfo = decodeToken(value);
        console.log(`  └─ Valid: ${tokenInfo.valid}, Expired: ${tokenInfo.expired}`);
      }
    });
  } else {
    console.log('Not running in browser environment');
  }
};

// Export for use in tests
module.exports = {
  testLogin,
  testProfile,
  testTickets,
  testHealth,
  runTests,
  debugEnvironment,
  testFrontendTokens
};

// Run tests if this file is executed directly
if (require.main === module) {
  debugEnvironment();
  runTests().catch(console.error);
}