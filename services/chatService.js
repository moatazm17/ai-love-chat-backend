const aiService = require('./aiService');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const moment = require('moment');

class ChatService {
  
  // 💬 Main message processing function
  async processMessage(userId, messageText, personalityType = 'emma') {
    try {
      console.log(`📨 Processing message from user ${userId} with ${personalityType}`);
      
      // 1. Get user and check limits
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      
      // 2. Check if user can send message (freemium limits)
      if (!user.canSendMessage()) {
        return {
          success: false,
          error: 'daily_limit_reached',
          message: 'You\'ve reached your daily message limit. Upgrade to Premium for unlimited messages!',
          upgradePrompt: true
        };
      }
      
      // 3. Get or create active conversation
      let conversation = await this.getOrCreateConversation(userId, personalityType);
      
      // 4. Update user's streak and activity
      user.updateStreak();
      
      // 5. Process message with AI
      const startTime = Date.now();
      const aiResult = await aiService.processMessage(userId, messageText, personalityType);
      const processingTime = Date.now() - startTime;
      
      // 6. Create message record
      const message = new Message({
        userId,
        conversationId: conversation._id,
        userMessage: messageText,
        aiResponse: aiResult.response,
        personality: personalityType,
        processingTime,
        modelUsed: aiResult.cached ? 'cached' : 'gpt-3.5-turbo',
        tokensUsed: aiResult.tokensUsed || 0,
        cost: this.calculateCost(aiResult)
      });
      
      // 7. Analyze message importance and extract memory tags
      message.analyzeImportance();
      message.extractMemoryTags();
      
      // 8. Detect topics and sentiment
      await this.analyzeMessage(message);
      
      // 9. Save message
      await message.save();
      
      // 10. Update conversation with new message
      conversation.addMessage(message);
      
      // 11. Extract and save important user facts
      await this.extractUserFacts(message, conversation);
      
      // 12. Update user mood if detected
      await this.updateUserMood(message, conversation);
      
      // 13. Check for conversation highlights
      await this.checkForHighlights(message, conversation);
      
      // 14. Save conversation updates
      await conversation.save();
      
      // 15. Use user's message quota
      user.useMessage();
      
      // 16. Update relationship level
      await this.updateRelationshipLevel(user, message);
      
      // 17. Save user updates
      await user.save();
      
      // 18. Generate response with additional context
      const response = {
        success: true,
        message: {
          id: message._id,
          response: aiResult.response,
          personality: personalityType,
          timestamp: message.timestamp,
          cached: aiResult.cached || false
        },
        conversation: {
          id: conversation._id,
          relationshipScore: conversation.relationshipScore,
          relationshipLevel: conversation.getRelationshipLevel(),
          messageCount: conversation.messageCount
        },
        user: {
          messagesLeft: this.getMessagesLeft(user),
          currentStreak: user.aiRelationship.currentStreak,
          relationshipLevel: user.aiRelationship.relationshipLevel
        }
      };
      
      console.log(`✅ Message processed successfully in ${processingTime}ms`);
      return response;
      
    } catch (error) {
      console.error('❌ Chat service error:', error);
      return {
        success: false,
        error: 'processing_failed',
        message: 'Sorry, I had trouble processing your message. Please try again.',
        details: error.message
      };
    }
  }
  
  // 🔍 Get or create conversation
  async getOrCreateConversation(userId, personality) {
    try {
      // Look for active conversation with this personality
      let conversation = await Conversation.findOne({
        userId,
        personality,
        status: 'active'
      }).sort({ lastActivity: -1 });
      
      if (!conversation) {
        // Create new conversation
        conversation = new Conversation({
          userId,
          personality,
          title: this.generateConversationTitle(personality),
          startedAt: new Date(),
          lastActivity: new Date()
        });
        
        await conversation.save();
        console.log(`🆕 Created new conversation with ${personality}`);
      }
      
      return conversation;
      
    } catch (error) {
      console.error('Error managing conversation:', error);
      throw error;
    }
  }
  
  // 📝 Generate conversation title
  generateConversationTitle(personality) {
    const titles = {
      emma: [
        'Heart to Heart with Emma',
        'Emma\'s Caring Chat',
        'Supportive Moments',
        'Emma\'s Warm Conversation'
      ],
      sophia: [
        'Deep Thoughts with Sophia',
        'Intellectual Exchange',
        'Sophia\'s Wisdom',
        'Mindful Discussion'
      ],
      luna: [
        'Fun Times with Luna',
        'Luna\'s Playful Chat',
        'Giggles and Games',
        'Luna\'s Happy Space'
      ],
      aria: [
        'Creative Flow with Aria',
        'Aria\'s Artistic Chat',
        'Inspired Conversations',
        'Beautiful Thoughts'
      ]
    };
    
    const personalityTitles = titles[personality] || titles.emma;
    return personalityTitles[Math.floor(Math.random() * personalityTitles.length)];
  }
  
  // 🧠 Analyze message for topics and sentiment
  async analyzeMessage(message) {
    try {
      const text = message.userMessage.toLowerCase();
      
      // Topic detection
      const topicKeywords = {
        greeting: ['hi', 'hello', 'hey', 'good morning', 'good evening'],
        personal: ['my name', 'i am', 'about me', 'myself'],
        relationship: ['love', 'dating', 'boyfriend', 'girlfriend', 'relationship'],
        career: ['work', 'job', 'career', 'office', 'boss', 'colleague'],
        hobbies: ['hobby', 'enjoy', 'love doing', 'free time', 'passion'],
        emotions: ['happy', 'sad', 'angry', 'excited', 'worried', 'afraid'],
        philosophy: ['meaning', 'purpose', 'life', 'existence', 'philosophy'],
        entertainment: ['movie', 'music', 'game', 'book', 'show', 'funny'],
        advice: ['help', 'advice', 'should i', 'what do you think'],
        flirting: ['beautiful', 'gorgeous', 'cute', 'attractive', 'kiss'],
        deep_talk: ['deep', 'meaningful', 'important', 'serious', 'personal']
      };
      
      message.topics = [];
      for (const [topic, keywords] of Object.entries(topicKeywords)) {
        if (keywords.some(keyword => text.includes(keyword))) {
          message.topics.push(topic);
        }
      }
      
      // Sentiment analysis (simple)
      const positiveWords = ['good', 'great', 'happy', 'love', 'amazing', 'wonderful', 'excited'];
      const negativeWords = ['bad', 'sad', 'angry', 'hate', 'terrible', 'awful', 'worried'];
      
      const positiveCount = positiveWords.filter(word => text.includes(word)).length;
      const negativeCount = negativeWords.filter(word => text.includes(word)).length;
      
      if (positiveCount > negativeCount) {
        message.sentiment.user = 'positive';
      } else if (negativeCount > positiveCount) {
        message.sentiment.user = 'negative';
      } else {
        message.sentiment.user = 'neutral';
      }
      
    } catch (error) {
      console.error('Error analyzing message:', error);
    }
  }
  
  // 📊 Extract user facts from message
  async extractUserFacts(message, conversation) {
    try {
      const text = message.userMessage.toLowerCase();
      
      // Extract name
      const nameMatch = text.match(/my name is (\w+)|i'm (\w+)|call me (\w+)/);
      if (nameMatch) {
        const name = nameMatch[1] || nameMatch[2] || nameMatch[3];
        conversation.addUserFact(`Name is ${name}`, 8);
      }
      
      // Extract age
      const ageMatch = text.match(/i am (\d+)|i'm (\d+)|(\d+) years old/);
      if (ageMatch) {
        const age = ageMatch[1] || ageMatch[2] || ageMatch[3];
        if (parseInt(age) >= 18 && parseInt(age) <= 100) {
          conversation.addUserFact(`Age is ${age}`, 7);
        }
      }
      
      // Extract job
      const jobMatch = text.match(/i work as|my job is|i'm a (\w+)|work at (\w+)/);
      if (jobMatch) {
        const job = jobMatch[1] || jobMatch[2];
        conversation.addUserFact(`Works as ${job}`, 6);
      }
      
      // Extract location
      const locationMatch = text.match(/i live in|from (\w+)|in (\w+) city/);
      if (locationMatch) {
        const location = locationMatch[1] || locationMatch[2];
        conversation.addUserFact(`Lives in ${location}`, 5);
      }
      
      // Extract relationship status
      if (text.includes('single')) {
        conversation.addUserFact('Currently single', 6);
      } else if (text.includes('married') || text.includes('girlfriend') || text.includes('boyfriend')) {
        conversation.addUserFact('In a relationship', 6);
      }
      
      // Extract hobbies
      const hobbyMatch = text.match(/i love (\w+)|enjoy (\w+)|hobby is (\w+)/);
      if (hobbyMatch) {
        const hobby = hobbyMatch[1] || hobbyMatch[2] || hobbyMatch[3];
        conversation.addUserFact(`Enjoys ${hobby}`, 4);
      }
      
    } catch (error) {
      console.error('Error extracting user facts:', error);
    }
  }
  
  // 😊 Update user mood based on message
  async updateUserMood(message, conversation) {
    try {
      const text = message.userMessage.toLowerCase();
      
      // Mood detection keywords
      const moodKeywords = {
        happy: ['happy', 'great', 'amazing', 'wonderful', 'excited', 'joy'],
        sad: ['sad', 'depressed', 'down', 'crying', 'upset'],
        worried: ['worried', 'anxious', 'nervous', 'concerned', 'stress'],
        angry: ['angry', 'mad', 'furious', 'annoyed', 'irritated'],
        romantic: ['love', 'romance', 'romantic', 'kiss', 'date'],
        playful: ['fun', 'funny', 'game', 'play', 'joke', 'laugh']
      };
      
      for (const [mood, keywords] of Object.entries(moodKeywords)) {
        if (keywords.some(keyword => text.includes(keyword))) {
          conversation.updateUserMood(mood, 0.8);
          break;
        }
      }
      
    } catch (error) {
      console.error('Error updating user mood:', error);
    }
  }
  
  // ⭐ Check for conversation highlights
  async checkForHighlights(message, conversation) {
    try {
      const text = message.userMessage.toLowerCase();
      const response = message.aiResponse.toLowerCase();
      
      // Funny moments
      if (text.includes('haha') || text.includes('lol') || text.includes('funny')) {
        conversation.addHighlight('funny', 'User found something amusing', message._id);
      }
      
      // Sweet moments
      if (text.includes('sweet') || text.includes('cute') || response.includes('💕')) {
        conversation.addHighlight('sweet', 'Sweet exchange', message._id);
      }
      
      // Deep conversations
      if (message.importance >= 7 || text.length > 200) {
        conversation.addHighlight('deep', 'Meaningful conversation', message._id);
      }
      
      // Breakthrough moments (user sharing something personal)
      if (message.containsPersonalInfo && message.importance >= 8) {
        conversation.addHighlight('breakthrough', 'User shared something personal', message._id);
      }
      
    } catch (error) {
      console.error('Error checking highlights:', error);
    }
  }
  
  // 💝 Update relationship level
  async updateRelationshipLevel(user, message) {
    try {
      let levelIncrease = 0;
      
      // Base increase for any message
      levelIncrease += 0.1;
      
      // Bonus for important messages
      if (message.importance >= 5) {
        levelIncrease += 0.5;
      }
      
      // Bonus for personal information
      if (message.containsPersonalInfo) {
        levelIncrease += 1;
      }
      
      // Bonus for positive sentiment
      if (message.sentiment.user === 'positive') {
        levelIncrease += 0.2;
      }
      
      // Bonus for streak
      if (user.aiRelationship.currentStreak >= 7) {
        levelIncrease += 0.3;
      }
      
      user.aiRelationship.relationshipLevel = Math.min(
        user.aiRelationship.relationshipLevel + levelIncrease,
        100
      );
      
    } catch (error) {
      console.error('Error updating relationship level:', error);
    }
  }
  
  // 💰 Calculate API cost
  calculateCost(aiResult) {
    if (aiResult.cached) return 0;
    
    // Rough cost calculation (adjust based on actual OpenAI pricing)
    const costPerToken = 0.000002; // $0.002 per 1K tokens
    return Math.round((aiResult.tokensUsed || 100) * costPerToken * 100); // in cents
  }
  
  // 📊 Get remaining messages for user
  getMessagesLeft(user) {
    const limits = {
      free: 15,
      basic: 100,
      premium: -1, // unlimited
      elite: -1    // unlimited
    };
    
    const userLimit = limits[user.subscription.type];
    if (userLimit === -1) return -1; // unlimited
    
    return Math.max(0, userLimit - user.usage.messagesUsedToday);
  }
  
  // 📈 Get conversation history
  async getConversationHistory(userId, conversationId, limit = 50) {
    try {
      const messages = await Message.find({
        userId,
        conversationId
      })
      .sort({ timestamp: -1 })
      .limit(limit)
      .select('userMessage aiResponse personality timestamp userRating');
      
      return messages.reverse(); // Return in chronological order
      
    } catch (error) {
      console.error('Error getting conversation history:', error);
      return [];
    }
  }
  
  // 🎭 Get user's conversations
  async getUserConversations(userId, limit = 20) {
    try {
      const conversations = await Conversation.find({ userId })
        .sort({ lastActivity: -1 })
        .limit(limit)
        .select('title personality relationshipScore messageCount lastActivity status');
      
      return conversations.map(conv => conv.generateSummary());
      
    } catch (error) {
      console.error('Error getting user conversations:', error);
      return [];
    }
  }
  
  // 📊 Get user analytics
  async getUserAnalytics(userId) {
    try {
      const [conversationAnalytics, messageAnalytics, user] = await Promise.all([
        Conversation.getUserAnalytics(userId),
        Message.getConversationSummary(userId),
        User.findById(userId)
      ]);
      
      return {
        user: {
          totalMessages: user.usage.totalMessages,
          currentStreak: user.aiRelationship.currentStreak,
          longestStreak: user.aiRelationship.longestStreak,
          relationshipLevel: user.aiRelationship.relationshipLevel,
          relationshipStatus: user.getRelationshipStatus(),
          joinDate: user.usage.joinedDate
        },
        conversations: conversationAnalytics,
        messages: messageAnalytics,
        favoritePersonality: this.getFavoritePersonality(conversationAnalytics)
      };
      
    } catch (error) {
      console.error('Error getting user analytics:', error);
      return null;
    }
  }
  
  // 🎭 Get favorite personality
  getFavoritePersonality(analytics) {
    if (!analytics || analytics.length === 0) return 'emma';
    
    return analytics.reduce((prev, current) => 
      (prev.totalMessages > current.totalMessages) ? prev : current
    )._id;
  }
  
}

module.exports = new ChatService();