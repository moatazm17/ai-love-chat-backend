const jwt = require('jsonwebtoken');

// 🛡️ Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'no_token',
      message: 'Access token required'
    });
  }
  
  jwt.verify(token, process.env.JWT_SECRET || 'ai-love-chat-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: 'invalid_token',
        message: 'Invalid or expired token'
      });
    }
    
    req.user = user;
    next();
  });
}

module.exports = authenticateToken;