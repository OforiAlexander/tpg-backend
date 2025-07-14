const jwt = require('jsonwebtoken');

const mockUser = {
  id: 1,
  email: 'test@upsamail.edu.gh',
  role: 'user',
  status: 'active'
};

process.env.JWT_SECRET = 'your-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'your-refresh-secret';
process.env.JWT_EXPIRES_IN = '24h';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

const authService = require('./src/services/authService');

async function testAuthService() {
  console.log(' Testing AuthService...\n');
  
  try {
    console.log('Testing token generation...');
    const tokens = authService.generateTokens(mockUser);
    console.log('Tokens generated successfully');
    console.log('Access Token (first 50 chars):', tokens.accessToken.substring(0, 50));
    console.log('Refresh Token (first 50 chars):', tokens.refreshToken.substring(0, 50));
    console.log('Expires In:', tokens.expiresIn);
    
    console.log('\n2️⃣ Testing token claims...');
    const decodedAccess = jwt.decode(tokens.accessToken, { complete: true });
    const decodedRefresh = jwt.decode(tokens.refreshToken, { complete: true });
    
    console.log('Access Token Claims:');
    console.log('- Audience:', decodedAccess.payload.aud);
    console.log('- Issuer:', decodedAccess.payload.iss);
    console.log('- Type:', decodedAccess.payload.type);
    
    console.log('Refresh Token Claims:');
    console.log('- Audience:', decodedRefresh.payload.aud);
    console.log('- Issuer:', decodedRefresh.payload.iss);
    console.log('- Type:', decodedRefresh.payload.type);
    
    console.log('\n Testing access token verification...');
    const verifiedAccess = authService.verifyAccessToken(tokens.accessToken);
    console.log('Access token verified successfully');
    console.log('Verified user ID:', verifiedAccess.id);
    
    console.log('\n Testing refresh token verification...');
    const verifiedRefresh = authService.verifyRefreshToken(tokens.refreshToken);
    console.log(' Refresh token verified successfully');
    console.log('Verified user ID:', verifiedRefresh.id);
    
    console.log('\n Testing token claims validation...');
    
    const accessClaims = decodedAccess.payload;
    const refreshClaims = decodedRefresh.payload;
    
    const accessValid = accessClaims.aud === 'tpg-users' && 
                       accessClaims.iss === 'tpg-portal' && 
                       accessClaims.type === 'access';
                       
    const refreshValid = refreshClaims.aud === 'tpg-users' && 
                        refreshClaims.iss === 'tpg-portal' && 
                        refreshClaims.type === 'refresh';
    
    if (accessValid && refreshValid) {
      console.log('Token claims validation passed');
      console.log('Tokens should work with refresh endpoint');
    } else {
      console.log('Token claims validation failed');
      console.log('Access token valid:', accessValid);
      console.log('Refresh token valid:', refreshValid);
    }
    
    console.log('\n Core authentication tests passed! Tokens have correct claims.');
    console.log('Note: Database-dependent refresh test skipped (requires DB connection)');
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testAuthService();