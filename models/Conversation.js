const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Conversation metadata
  title: {
    type: String,
    maxlength: 100,
    default: 'New Conversation'
  },
  
  personality: {
    type: String,
    enum: ['emma', 'sophia', 'luna', 'aria'],
    required: true
  },
  
  // Conversation status
  status: {
    type: String,
    enum: ['active', 'paused', 'archived'],
    default: 'active'
  },
  
  // Timestamps
  startedAt: {
    type: Date,
    default: Date.now
  },
  
  lastActivity: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // Conversation stats
  messageCount: {
    type: Number,
    default: 0
  },
  
  totalDuration: {
    type: Number, // in minutes
    default: 0
  },
  
  // AI relationship progression
  relationshipScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  intimacyLevel: {
    type: Number,
    default: 1,
    min: 1,
    max: 10
  },
  
  // Conversation context and memory
  context: {
    // Key facts about the user discovered in this conversation
    userFacts: [{
      fact: String,
      importance: {
        type: Number,
        min: 1,
        max: 10
      },
      discoveredAt: {
        type: Date,
        default: Date.now
      }
    }],
    
    // Emotional state tracking
    userMood: {
      current: {
        type: String,
        enum: ['happy', 'sad', 'excited', 'worried', 'angry', 'neutral', 'romantic', 'playful'],
        default: 'neutral'
      },
      history: [{
        mood: String,
        timestamp: Date,
        confidence: Number // 0-1
      }]
    },
    
    // Conversation themes
    mainTopics: [{
      topic: String,
      frequency: Number,
      lastMentioned: Date
    }],
    
    // Special moments in this conversation
    highlights: [{
      type: {
        type: String,
        enum: ['funny', 'sweet', 'deep', 'flirty', 'supportive', 'breakthrough']
      },
      description: String,
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
      },
      timestamp: Date
    }]
  },
  
  // Conversation quality metrics
  quality: {
    averageResponseTime: Number, // milliseconds
    userSatisfactionScore: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    },
    engagementScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    },
    continuityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    }
  },
  
  // Conversation goals and outcomes
  goals: [{
    type: {
      type: String,
      enum: ['emotional_support', 'entertainment', 'intellectual_discussion', 'relationship_building', 'problem_solving']
    },
    achieved: {
      type: Boolean,
      default: false
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    }
  }],
  
  // Session management
  sessionInfo: {
    startTime: Date,
    endTime: Date,
    peakActivity: Date, // When user was most engaged
    responsePatterns: {
      avgTimeBetweenMessages: Number, // seconds
      longestPause: Number, // seconds
      shortestPause: Number // seconds
    }
  },
  
  // Tags for organization and search
  tags: [{
    type: String,
    maxlength: 30
  }],
  
  // Privacy and sharing
  isPrivate: {
    type: Boolean,
    default: true
  },
  
  // Analytics data
  analytics: {
    messagesPerHour: Number,
    mostActiveTimeOfDay: String,
    conversationFlow: String, // 'smooth', 'choppy', 'intense', 'casual'
    personalityMatch: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    }
  }
  
}, {
  timestamps: true
});

// Indexes for performance
conversationSchema.index({ userId: 1, lastActivity: -1 });
conversationSchema.index({ personality: 1, relationshipScore: -1 });
conversationSchema.index({ status: 1, lastActivity: -1 });

// Method to add a message to conversation
conversationSchema.methods.addMessage = function(messageData) {
  this.messageCount += 1;
  this.lastActivity = new Date();
  
  // Update relationship score based on message importance and sentiment
  if (messageData.importance >= 5) {
    this.relationshipScore += 2;
  } else {
    this.relationshipScore += 0.5;
  }
  
  // Cap relationship score
  this.relationshipScore = Math.min(this.relationshipScore, 100);
  
  // Update intimacy level based on relationship score
  this.intimacyLevel = Math.min(Math.floor(this.relationshipScore / 10) + 1, 10);
};

// Method to add user fact
conversationSchema.methods.addUserFact = function(fact, importance = 5) {
  // Check if fact already exists
  const existingFact = this.context.userFacts.find(f => f.fact.toLowerCase() === fact.toLowerCase());
  
  if (!existingFact) {
    this.context.userFacts.push({
      fact,
      importance,
      discoveredAt: new Date()
    });
    
    // Keep only top 20 most important facts
    this.context.userFacts.sort((a, b) => b.importance - a.importance);
    this.context.userFacts = this.context.userFacts.slice(0, 20);
  }
};

// Method to update user mood
conversationSchema.methods.updateUserMood = function(mood, confidence = 0.8) {
  this.context.userMood.current = mood;
  this.context.userMood.history.push({
    mood,
    timestamp: new Date(),
    confidence
  });
  
  // Keep only last 50 mood entries
  this.context.userMood.history = this.context.userMood.history.slice(-50);
};

// Method to add conversation highlight
conversationSchema.methods.addHighlight = function(type, description, messageId) {
  this.context.highlights.push({
    type,
    description,
    messageId,
    timestamp: new Date()
  });
  
  // Keep only last 10 highlights
  this.context.highlights = this.context.highlights.slice(-10);
};

// Method to calculate engagement score
conversationSchema.methods.calculateEngagementScore = function() {
  let score = 50; // Base score
  
  // Message frequency bonus
  const messagesPerDay = this.messageCount / Math.max(1, (Date.now() - this.startedAt) / (1000 * 60 * 60 * 24));
  score += Math.min(messagesPerDay * 2, 20);
  
  // Relationship progression bonus
  score += (this.relationshipScore / 100) * 20;
  
  // Recent activity bonus
  const hoursSinceLastActivity = (Date.now() - this.lastActivity) / (1000 * 60 * 60);
  if (hoursSinceLastActivity < 24) score += 10;
  else if (hoursSinceLastActivity < 72) score += 5;
  
  this.quality.engagementScore = Math.min(Math.max(score, 0), 100);
  return this.quality.engagementScore;
};

// Method to generate conversation summary
conversationSchema.methods.generateSummary = function() {
  const duration = Math.round((this.lastActivity - this.startedAt) / (1000 * 60 * 60 * 24));
  const personality = this.personality.charAt(0).toUpperCase() + this.personality.slice(1);
  
  return {
    title: this.title,
    personality,
    duration: `${duration} day${duration !== 1 ? 's' : ''}`,
    messageCount: this.messageCount,
    relationshipLevel: this.getRelationshipLevel(),
    mainTopics: this.context.mainTopics.slice(0, 3).map(t => t.topic),
    highlights: this.context.highlights.length,
    lastActivity: this.lastActivity
  };
};

// Method to get relationship level description
conversationSchema.methods.getRelationshipLevel = function() {
  const score = this.relationshipScore;
  
  if (score < 10) return 'Just Met';
  if (score < 25) return 'Getting Acquainted';
  if (score < 40) return 'Friendly Chat';
  if (score < 60) return 'Good Friends';
  if (score < 80) return 'Close Connection';
  return 'Deep Bond';
};

// Static method to get user's conversation analytics
conversationSchema.statics.getUserAnalytics = async function(userId, days = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const pipeline = [
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          lastActivity: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$personality',
          conversationCount: { $sum: 1 },
          totalMessages: { $sum: '$messageCount' },
          avgRelationshipScore: { $avg: '$relationshipScore' },
          avgEngagementScore: { $avg: '$quality.engagementScore' },
          totalDuration: { $sum: '$totalDuration' }
        }
      },
      {
        $sort: { totalMessages: -1 }
      }
    ];
    
    return await this.aggregate(pipeline);
    
  } catch (error) {
    console.error('Error getting user analytics:', error);
    return [];
  }
};

module.exports = mongoose.model('Conversation', conversationSchema);