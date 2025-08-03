const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  
  // Message content
  userMessage: {
    type: String,
    required: true,
    maxlength: 1000
  },
  
  aiResponse: {
    type: String,
    required: true,
    maxlength: 2000
  },
  
  // AI context
  personality: {
    type: String,
    enum: ['emma', 'sophia', 'luna', 'aria'],
    required: true
  },
  
  // Message metadata
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // AI processing info
  processingTime: {
    type: Number, // milliseconds
    default: null
  },
  
  modelUsed: {
    type: String,
    enum: ['gpt-3.5-turbo', 'gpt-4', 'cached', 'quick-response'],
    default: 'gpt-3.5-turbo'
  },
  
  tokensUsed: {
    type: Number,
    default: 0
  },
  
  cost: {
    type: Number, // in cents
    default: 0
  },
  
  // Message analysis
  sentiment: {
    user: {
      type: String,
      enum: ['positive', 'negative', 'neutral'],
      default: 'neutral'
    },
    ai: {
      type: String,
      enum: ['supportive', 'playful', 'intellectual', 'creative', 'empathetic'],
      default: 'supportive'
    }
  },
  
  // Topics detected in conversation
  topics: [{
    type: String,
    enum: ['greeting', 'personal', 'relationship', 'career', 'hobbies', 'emotions', 'philosophy', 'entertainment', 'advice', 'flirting', 'deep_talk']
  }],
  
  // Message importance for memory system
  importance: {
    type: Number,
    default: 1,
    min: 1,
    max: 10
  },
  
  // Flags
  isImportant: {
    type: Boolean,
    default: false
  },
  
  isFirstMessage: {
    type: Boolean,
    default: false
  },
  
  containsPersonalInfo: {
    type: Boolean,
    default: false
  },
  
  // User feedback
  userRating: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },
  
  userFeedback: {
    type: String,
    maxlength: 500,
    default: null
  },
  
  // Memory tags for smart retrieval
  memoryTags: [{
    type: String,
    maxlength: 50
  }]
  
}, {
  timestamps: true
});

// Indexes for performance
messageSchema.index({ userId: 1, timestamp: -1 });
messageSchema.index({ conversationId: 1, timestamp: -1 });
messageSchema.index({ personality: 1, timestamp: -1 });
messageSchema.index({ importance: -1, timestamp: -1 });
messageSchema.index({ isImportant: 1, userId: 1 });

// Method to analyze message importance
messageSchema.methods.analyzeImportance = function() {
  let score = 1;
  
  // Personal information mentioned
  const personalKeywords = ['my name', 'i am', 'i work', 'my job', 'my family', 'birthday', 'age', 'live in'];
  if (personalKeywords.some(keyword => this.userMessage.toLowerCase().includes(keyword))) {
    score += 3;
    this.containsPersonalInfo = true;
  }
  
  // Emotional content
  const emotionalKeywords = ['love', 'hate', 'sad', 'happy', 'angry', 'excited', 'worried', 'afraid'];
  if (emotionalKeywords.some(keyword => this.userMessage.toLowerCase().includes(keyword))) {
    score += 2;
  }
  
  // Goals and aspirations
  const goalKeywords = ['want to', 'hope to', 'dream', 'goal', 'wish', 'plan to'];
  if (goalKeywords.some(keyword => this.userMessage.toLowerCase().includes(keyword))) {
    score += 2;
  }
  
  // Relationship milestones
  if (this.userMessage.length > 100) score += 1; // Longer messages are often more important
  if (this.isFirstMessage) score += 5;
  
  this.importance = Math.min(score, 10);
  this.isImportant = score >= 5;
  
  return this.importance;
};

// Method to extract memory tags
messageSchema.methods.extractMemoryTags = function() {
  const tags = [];
  const message = this.userMessage.toLowerCase();
  
  // Extract names
  const namePattern = /my name is (\w+)|i'm (\w+)|call me (\w+)/g;
  let match;
  while ((match = namePattern.exec(message)) !== null) {
    const name = match[1] || match[2] || match[3];
    if (name) tags.push(`name:${name}`);
  }
  
  // Extract job/profession
  const jobPattern = /i work as|my job is|i'm a (\w+)|work at (\w+)/g;
  while ((match = jobPattern.exec(message)) !== null) {
    const job = match[1] || match[2];
    if (job) tags.push(`job:${job}`);
  }
  
  // Extract age
  const agePattern = /i am (\d+)|i'm (\d+)|(\d+) years old/g;
  while ((match = agePattern.exec(message)) !== null) {
    const age = match[1] || match[2] || match[3];
    if (age && parseInt(age) >= 18 && parseInt(age) <= 100) {
      tags.push(`age:${age}`);
    }
  }
  
  // Extract hobbies
  const hobbyKeywords = ['love', 'enjoy', 'hobby', 'interest', 'passion'];
  hobbyKeywords.forEach(keyword => {
    if (message.includes(keyword)) {
      // Extract what comes after these keywords
      const pattern = new RegExp(`${keyword}\\s+(\\w+)`, 'g');
      while ((match = pattern.exec(message)) !== null) {
        tags.push(`hobby:${match[1]}`);
      }
    }
  });
  
  this.memoryTags = [...new Set(tags)]; // Remove duplicates
  return this.memoryTags;
};

// Static method to get user's memory context
messageSchema.statics.getUserMemoryContext = async function(userId, limit = 50) {
  try {
    // Get important messages
    const importantMessages = await this.find({
      userId,
      isImportant: true
    })
    .sort({ importance: -1, timestamp: -1 })
    .limit(limit / 2)
    .select('userMessage aiResponse memoryTags timestamp');
    
    // Get recent messages
    const recentMessages = await this.find({
      userId,
      isImportant: false
    })
    .sort({ timestamp: -1 })
    .limit(limit / 2)
    .select('userMessage aiResponse timestamp');
    
    // Combine and sort by relevance
    const allMessages = [...importantMessages, ...recentMessages]
      .sort((a, b) => {
        // Prioritize important messages, then by recency
        if (a.isImportant && !b.isImportant) return -1;
        if (!a.isImportant && b.isImportant) return 1;
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
    
    return allMessages.slice(0, limit);
    
  } catch (error) {
    console.error('Error getting user memory context:', error);
    return [];
  }
};

// Static method to get conversation summary
messageSchema.statics.getConversationSummary = async function(userId, days = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const pipeline = [
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$personality',
          messageCount: { $sum: 1 },
          avgImportance: { $avg: '$importance' },
          totalTokens: { $sum: '$tokensUsed' },
          totalCost: { $sum: '$cost' },
          topics: { $addToSet: '$topics' },
          lastMessage: { $max: '$timestamp' }
        }
      }
    ];
    
    return await this.aggregate(pipeline);
    
  } catch (error) {
    console.error('Error getting conversation summary:', error);
    return [];
  }
};

module.exports = mongoose.model('Message', messageSchema);