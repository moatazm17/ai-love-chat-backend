const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const User = require('../models/User');
const router = express.Router();

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.'
  }
});

// Validation schemas
const registerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  age: Joi.number().min(18).max(100).optional()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// 📝 Register new user
router.post('/register', authLimiter, async (req, res) => {
  try {
    console.log('📝 Registration attempt:', req.body.email);
    
    // Validate input
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: error.details[0].message
      });
    }
    
    const { name, email, password, age } = value;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'user_exists',
        message: 'User with this email already exists'
      });
    }
    
    // Create new user
    const user = new User({
      name,
      email: email.toLowerCase(),
      password, // Will be hashed by pre-save middleware
      age,
      preferences: {
        favoritePersonality: 'emma', // Default to Emma
        conversationStyle: 'casual',
        notificationsEnabled: true,
        theme: 'pink'
      }
    });
    
    await user.save();
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user._id,
        email: user.email 
      },
      process.env.JWT_SECRET || 'ai-love-chat-secret-key',
      { expiresIn: '30d' }
    );
    
    // Return user data (without password)
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      age: user.age,
      preferences: user.preferences,
      subscription: user.subscription,
      usage: user.usage,
      aiRelationship: user.aiRelationship
    };
    
    console.log('✅ User registered successfully:', user.email);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: userData
    });
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to register user'
    });
  }
});

// 🔑 Login user
router.post('/login', authLimiter, async (req, res) => {
  try {
    console.log('🔑 Login attempt:', req.body.email);
    
    // Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: error.details[0].message
      });
    }
    
    const { email, password } = value;
    
    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'invalid_credentials',
        message: 'Invalid email or password'
      });
    }
    
    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'invalid_credentials',
        message: 'Invalid email or password'
      });
    }
    
    // Update last active
    user.lastActive = new Date();
    await user.save();
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user._id,
        email: user.email 
      },
      process.env.JWT_SECRET || 'ai-love-chat-secret-key',
      { expiresIn: '30d' }
    );
    
    // Return user data (without password)
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      age: user.age,
      preferences: user.preferences,
      subscription: user.subscription,
      usage: user.usage,
      aiRelationship: user.aiRelationship,
      lastActive: user.lastActive
    };
    
    console.log('✅ User logged in successfully:', user.email);
    
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: userData
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to login'
    });
  }
});

// 👤 Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    // Calculate additional stats
    const messagesLeft = user.canSendMessage() ? 
      (user.subscription.type === 'free' ? 15 - user.usage.messagesUsedToday : -1) : 0;
    
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      age: user.age,
      preferences: user.preferences,
      subscription: user.subscription,
      usage: user.usage,
      aiRelationship: user.aiRelationship,
      lastActive: user.lastActive,
      messagesLeft,
      relationshipStatus: user.getRelationshipStatus()
    };
    
    res.json({
      success: true,
      user: userData
    });
    
  } catch (error) {
    console.error('❌ Profile fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to fetch profile'
    });
  }
});

// ✏️ Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const updates = req.body;
    
    // Define allowed updates
    const allowedUpdates = ['name', 'age', 'preferences'];
    const actualUpdates = {};
    
    // Filter updates to only allowed fields
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        actualUpdates[key] = updates[key];
      }
    }
    
    // Validate preferences if being updated
    if (actualUpdates.preferences) {
      const validPersonalities = ['emma', 'sophia', 'luna', 'aria'];
      const validStyles = ['casual', 'formal', 'playful', 'deep'];
      const validThemes = ['light', 'dark', 'pink', 'purple'];
      
      if (actualUpdates.preferences.favoritePersonality && 
          !validPersonalities.includes(actualUpdates.preferences.favoritePersonality)) {
        return res.status(400).json({
          success: false,
          error: 'invalid_personality',
          message: 'Invalid personality selection'
        });
      }
      
      if (actualUpdates.preferences.conversationStyle && 
          !validStyles.includes(actualUpdates.preferences.conversationStyle)) {
        return res.status(400).json({
          success: false,
          error: 'invalid_style',
          message: 'Invalid conversation style'
        });
      }
      
      if (actualUpdates.preferences.theme && 
          !validThemes.includes(actualUpdates.preferences.theme)) {
        return res.status(400).json({
          success: false,
          error: 'invalid_theme',
          message: 'Invalid theme selection'
        });
      }
    }
    
    // Update user
    const user = await User.findByIdAndUpdate(
      userId,
      actualUpdates,
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    console.log('✅ Profile updated for user:', user.email);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        age: user.age,
        preferences: user.preferences,
        subscription: user.subscription,
        usage: user.usage,
        aiRelationship: user.aiRelationship
      }
    });
    
  } catch (error) {
    console.error('❌ Profile update error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to update profile'
    });
  }
});

// 🔄 Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Check if user still exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    // Generate new token
    const token = jwt.sign(
      { 
        userId: user._id,
        email: user.email 
      },
      process.env.JWT_SECRET || 'ai-love-chat-secret-key',
      { expiresIn: '30d' }
    );
    
    res.json({
      success: true,
      token
    });
    
  } catch (error) {
    console.error('❌ Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to refresh token'
    });
  }
});

// 🗑️ Delete account
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Delete user and all related data
    await Promise.all([
      User.findByIdAndDelete(userId),
      // Add cleanup for conversations and messages
      require('../models/Conversation').deleteMany({ userId }),
      require('../models/Message').deleteMany({ userId })
    ]);
    
    console.log('🗑️ Account deleted for user:', userId);
    
    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Account deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to delete account'
    });
  }
});

// 🚪 Logout (mainly for clearing client-side token)
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Update last active time
    await User.findByIdAndUpdate(req.user.userId, { lastActive: new Date() });
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
    
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to logout'
    });
  }
});

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

module.exports = router;