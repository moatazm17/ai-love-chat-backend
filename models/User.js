const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Basic user information
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  
  // Profile information
  age: {
    type: Number,
    min: 18,
    max: 100
  },
  
  avatar: {
    type: String,
    default: null
  },
  
  // AI Preferences
  preferences: {
    favoritePersonality: {
      type: String,
      enum: ['emma', 'sophia', 'luna', 'aria'],
      default: 'emma'
    },
    
    conversationStyle: {
      type: String,
      enum: ['casual', 'formal', 'playful', 'deep'],
      default: 'casual'
    },
    
    topics: [{
      type: String,
      enum: ['relationships', 'career', 'hobbies', 'philosophy', 'entertainment', 'personal_growth']
    }],
    
    notificationsEnabled: {
      type: Boolean,
      default: true
    },
    
    theme: {
      type: String,
      enum: ['light', 'dark', 'pink', 'purple'],
      default: 'pink'
    }
  },
  
  // Subscription and usage
  subscription: {
    type: {
      type: String,
      enum: ['free', 'basic', 'premium', 'elite'],
      default: 'free'
    },
    
    status: {
      type: String,
      enum: ['active', 'cancelled', 'expired'],
      default: 'active'
    },
    
    startDate: {
      type: Date,
      default: Date.now
    },
    
    endDate: {
      type: Date,
      default: null
    },
    
    stripeCustomerId: String,
    stripeSubscriptionId: String
  },
  
  // Usage tracking for freemium limits
  usage: {
    messagesUsedToday: {
      type: Number,
      default: 0
    },
    
    lastMessageDate: {
      type: Date,
      default: Date.now
    },
    
    totalMessages: {
      type: Number,
      default: 0
    },
    
    joinedDate: {
      type: Date,
      default: Date.now
    }
  },
  
  // Relationship tracking with AI
  aiRelationship: {
    favoritePersonalities: [{
      personality: String,
      affinity: Number // 0-100
    }],
    
    totalConversationTime: {
      type: Number,
      default: 0 // in minutes
    },
    
    longestStreak: {
      type: Number,
      default: 0 // days
    },
    
    currentStreak: {
      type: Number,
      default: 0
    },
    
    lastStreakDate: {
      type: Date,
      default: Date.now
    },
    
    relationshipLevel: {
      type: Number,
      default: 1,
      min: 1,
      max: 100
    },
    
    specialMoments: [{
      type: {
        type: String,
        enum: ['first_conversation', 'week_anniversary', 'month_anniversary', 'deep_moment', 'funny_moment']
      },
      date: Date,
      description: String
    }]
  },
  
  // Privacy and security
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  
  lastActive: {
    type: Date,
    default: Date.now
  },
  
  deviceTokens: [String], // For push notifications
  
  // Analytics (anonymous)
  analytics: {
    averageSessionLength: Number,
    preferredChatTimes: [String], // ['morning', 'afternoon', 'evening', 'night']
    mostActiveDay: String,
    avgMessagesPerSession: Number
  }
  
}, {
  timestamps: true
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ lastActive: -1 });
userSchema.index({ 'subscription.type': 1 });

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to check daily message limit
userSchema.methods.canSendMessage = function() {
  const today = new Date().toDateString();
  const lastMessageDate = this.usage.lastMessageDate ? this.usage.lastMessageDate.toDateString() : null;
  
  // Reset daily count if it's a new day
  if (today !== lastMessageDate) {
    this.usage.messagesUsedToday = 0;
  }
  
  const limits = {
    free: 15,
    basic: 100,
    premium: -1, // unlimited
    elite: -1    // unlimited
  };
  
  const userLimit = limits[this.subscription.type];
  return userLimit === -1 || this.usage.messagesUsedToday < userLimit;
};

// Method to use a message
userSchema.methods.useMessage = function() {
  const today = new Date().toDateString();
  const lastMessageDate = this.usage.lastMessageDate ? this.usage.lastMessageDate.toDateString() : null;
  
  // Reset daily count if it's a new day
  if (today !== lastMessageDate) {
    this.usage.messagesUsedToday = 0;
  }
  
  this.usage.messagesUsedToday += 1;
  this.usage.totalMessages += 1;
  this.usage.lastMessageDate = new Date();
  this.lastActive = new Date();
};

// Method to get user's AI relationship status
userSchema.methods.getRelationshipStatus = function() {
  const level = this.aiRelationship.relationshipLevel;
  
  if (level < 10) return 'New Connection';
  if (level < 25) return 'Getting to Know Each Other';
  if (level < 50) return 'Close Friends';
  if (level < 75) return 'Deep Connection';
  return 'Soulmates';
};

// Update streak
userSchema.methods.updateStreak = function() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const lastStreakDate = this.aiRelationship.lastStreakDate || new Date(0);
  
  if (lastStreakDate.toDateString() === yesterday.toDateString()) {
    // Continue streak
    this.aiRelationship.currentStreak += 1;
  } else if (lastStreakDate.toDateString() !== today.toDateString()) {
    // Reset streak
    this.aiRelationship.currentStreak = 1;
  }
  
  // Update longest streak
  if (this.aiRelationship.currentStreak > this.aiRelationship.longestStreak) {
    this.aiRelationship.longestStreak = this.aiRelationship.currentStreak;
  }
  
  this.aiRelationship.lastStreakDate = today;
};

module.exports = mongoose.model('User', userSchema);