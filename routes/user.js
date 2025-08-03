const express = require('express');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const authenticateToken = require('../middleware/auth');
const router = express.Router();

// 📊 Get user dashboard data
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    // Get recent conversations
    const recentConversations = await Conversation.find({
      userId,
      status: 'active'
    })
    .sort({ lastActivity: -1 })
    .limit(3)
    .select('title personality relationshipScore messageCount lastActivity');
    
    // Get today's message count
    const today = new Date().toDateString();
    const lastMessageDate = user.usage.lastMessageDate ? user.usage.lastMessageDate.toDateString() : null;
    const todayMessages = today === lastMessageDate ? user.usage.messagesUsedToday : 0;
    
    // Calculate streak info
    const streakInfo = {
      current: user.aiRelationship.currentStreak,
      longest: user.aiRelationship.longestStreak,
      lastActive: user.aiRelationship.lastStreakDate
    };
    
    // Get personality preferences
    const personalityStats = await Conversation.aggregate([
      { $match: { userId: user._id } },
      { $group: { 
        _id: '$personality', 
        count: { $sum: 1 },
        totalMessages: { $sum: '$messageCount' },
        avgRelationshipScore: { $avg: '$relationshipScore' }
      }},
      { $sort: { totalMessages: -1 } }
    ]);
    
    res.json({
      success: true,
      dashboard: {
        user: {
          name: user.name,
          relationshipLevel: user.aiRelationship.relationshipLevel,
          relationshipStatus: user.getRelationshipStatus(),
          joinDate: user.usage.joinedDate,
          subscription: user.subscription.type,
          theme: user.preferences.theme || 'pink'
        },
        usage: {
          messagesUsedToday: todayMessages,
          messagesLeft: user.canSendMessage() ? 
            (user.subscription.type === 'free' ? 15 - todayMessages : -1) : 0,
          totalMessages: user.usage.totalMessages,
          averageDaily: Math.round(user.usage.totalMessages / Math.max(1, 
            (Date.now() - user.usage.joinedDate) / (1000 * 60 * 60 * 24)))
        },
        streak: streakInfo,
        recentConversations: recentConversations.map(conv => ({
          id: conv._id,
          title: conv.title,
          personality: conv.personality,
          relationshipScore: conv.relationshipScore,
          messageCount: conv.messageCount,
          lastActivity: conv.lastActivity
        })),
        personalityStats,
        achievements: this.calculateAchievements(user, personalityStats)
      }
    });
    
  } catch (error) {
    console.error('❌ Get dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to get dashboard data'
    });
  }
});

// 🏆 Get user achievements
router.get('/achievements', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    // Get conversation stats
    const conversationStats = await Conversation.aggregate([
      { $match: { userId: user._id } },
      { $group: { 
        _id: '$personality', 
        count: { $sum: 1 },
        totalMessages: { $sum: '$messageCount' },
        maxRelationshipScore: { $max: '$relationshipScore' }
      }}
    ]);
    
    const achievements = this.calculateAchievements(user, conversationStats);
    
    res.json({
      success: true,
      achievements
    });
    
  } catch (error) {
    console.error('❌ Get achievements error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to get achievements'
    });
  }
});

// 📈 Get user statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const days = parseInt(req.query.days) || 30;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Message statistics
    const messageStats = await Message.aggregate([
      {
        $match: {
          userId: user._id,
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            personality: '$personality'
          },
          count: { $sum: 1 },
          avgImportance: { $avg: '$importance' },
          sentiments: { $push: '$sentiment.user' }
        }
      },
      {
        $sort: { '_id.date': 1 }
      }
    ]);
    
    // Conversation statistics
    const conversationStats = await Conversation.aggregate([
      {
        $match: {
          userId: user._id,
          lastActivity: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$personality',
          totalConversations: { $sum: 1 },
          totalMessages: { $sum: '$messageCount' },
          avgRelationshipScore: { $avg: '$relationshipScore' },
          maxRelationshipScore: { $max: '$relationshipScore' },
          totalDuration: { $sum: '$totalDuration' }
        }
      }
    ]);
    
    // Process sentiment data
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    messageStats.forEach(stat => {
      stat.sentiments.forEach(sentiment => {
        sentimentCounts[sentiment] = (sentimentCounts[sentiment] || 0) + 1;
      });
    });
    
    res.json({
      success: true,
      stats: {
        period: `${days} days`,
        messages: {
          total: messageStats.reduce((sum, stat) => sum + stat.count, 0),
          daily: messageStats,
          byPersonality: conversationStats,
          sentiments: sentimentCounts
        },
        conversations: {
          active: conversationStats.length,
          byPersonality: conversationStats,
          totalDuration: conversationStats.reduce((sum, stat) => sum + (stat.totalDuration || 0), 0)
        },
        user: {
          relationshipLevel: user.aiRelationship.relationshipLevel,
          currentStreak: user.aiRelationship.currentStreak,
          longestStreak: user.aiRelationship.longestStreak,
          totalMessages: user.usage.totalMessages,
          averageImportance: messageStats.reduce((sum, stat) => sum + stat.avgImportance, 0) / Math.max(1, messageStats.length)
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Get stats error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to get statistics'
    });
  }
});

// 🔔 Update notification preferences
router.put('/notifications', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { notificationsEnabled, deviceToken } = req.body;
    
    const updateData = {};
    
    if (typeof notificationsEnabled === 'boolean') {
      updateData['preferences.notificationsEnabled'] = notificationsEnabled;
    }
    
    if (deviceToken) {
      updateData.$addToSet = { deviceTokens: deviceToken };
    }
    
    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('preferences deviceTokens');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Notification preferences updated',
      preferences: {
        notificationsEnabled: user.preferences.notificationsEnabled,
        deviceTokenCount: user.deviceTokens.length
      }
    });
    
  } catch (error) {
    console.error('❌ Update notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to update notification preferences'
    });
  }
});

// 🎭 Update favorite personality
router.put('/personality', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { favoritePersonality } = req.body;
    
    const validPersonalities = ['emma', 'sophia', 'luna', 'aria'];
    if (!validPersonalities.includes(favoritePersonality)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_personality',
        message: 'Invalid personality selection'
      });
    }
    
    const user = await User.findByIdAndUpdate(
      userId,
      { 'preferences.favoritePersonality': favoritePersonality },
      { new: true }
    ).select('preferences');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Favorite personality updated',
      favoritePersonality: user.preferences.favoritePersonality
    });
    
  } catch (error) {
    console.error('❌ Update personality error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to update favorite personality'
    });
  }
});

// 📱 Update app theme
router.put('/theme', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { theme } = req.body;
    
    const validThemes = ['light', 'dark', 'pink', 'purple'];
    if (!validThemes.includes(theme)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_theme',
        message: 'Invalid theme selection'
      });
    }
    
    const user = await User.findByIdAndUpdate(
      userId,
      { 'preferences.theme': theme },
      { new: true }
    ).select('preferences');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Theme updated',
      theme: user.preferences.theme
    });
    
  } catch (error) {
    console.error('❌ Update theme error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to update theme'
    });
  }
});

// 📤 Export user data (GDPR compliance)
router.get('/export', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const [user, conversations, messages] = await Promise.all([
      User.findById(userId).select('-password'),
      Conversation.find({ userId }),
      Message.find({ userId }).select('-userId') // Remove userId for privacy
    ]);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    const exportData = {
      user: {
        name: user.name,
        email: user.email,
        age: user.age,
        preferences: user.preferences,
        usage: user.usage,
        aiRelationship: user.aiRelationship,
        subscription: {
          type: user.subscription.type,
          status: user.subscription.status,
          startDate: user.subscription.startDate,
          endDate: user.subscription.endDate
        },
        createdAt: user.createdAt,
        lastActive: user.lastActive
      },
      conversations: conversations.map(conv => ({
        id: conv._id,
        title: conv.title,
        personality: conv.personality,
        messageCount: conv.messageCount,
        relationshipScore: conv.relationshipScore,
        startedAt: conv.startedAt,
        lastActivity: conv.lastActivity,
        context: conv.context
      })),
      messages: messages.map(msg => ({
        id: msg._id,
        conversationId: msg.conversationId,
        userMessage: msg.userMessage,
        aiResponse: msg.aiResponse,
        personality: msg.personality,
        timestamp: msg.timestamp,
        importance: msg.importance,
        topics: msg.topics,
        sentiment: msg.sentiment
      })),
      exportDate: new Date(),
      totalRecords: {
        conversations: conversations.length,
        messages: messages.length
      }
    };
    
    res.json({
      success: true,
      data: exportData
    });
    
  } catch (error) {
    console.error('❌ Export data error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to export user data'
    });
  }
});

// Helper function to calculate achievements
function calculateAchievements(user, personalityStats) {
  const achievements = [];
  
  // Message milestones
  const totalMessages = user.usage.totalMessages;
  if (totalMessages >= 1) achievements.push({ id: 'first_message', name: 'First Words', description: 'Sent your first message', unlocked: true });
  if (totalMessages >= 100) achievements.push({ id: 'century', name: 'Century Club', description: 'Sent 100 messages', unlocked: true });
  if (totalMessages >= 1000) achievements.push({ id: 'thousand', name: 'Thousand Messages', description: 'Sent 1,000 messages', unlocked: true });
  
  // Streak achievements
  const longestStreak = user.aiRelationship.longestStreak;
  if (longestStreak >= 7) achievements.push({ id: 'week_streak', name: 'Weekly Dedication', description: 'Chatted for 7 days straight', unlocked: true });
  if (longestStreak >= 30) achievements.push({ id: 'month_streak', name: 'Monthly Connection', description: 'Chatted for 30 days straight', unlocked: true });
  
  // Relationship achievements
  const relationshipLevel = user.aiRelationship.relationshipLevel;
  if (relationshipLevel >= 25) achievements.push({ id: 'close_friend', name: 'Close Friend', description: 'Reached relationship level 25', unlocked: true });
  if (relationshipLevel >= 50) achievements.push({ id: 'best_friend', name: 'Best Friend', description: 'Reached relationship level 50', unlocked: true });
  if (relationshipLevel >= 75) achievements.push({ id: 'soulmate', name: 'Soulmate', description: 'Reached relationship level 75', unlocked: true });
  
  // Personality achievements
  const personalityCount = personalityStats.length;
  if (personalityCount >= 2) achievements.push({ id: 'social_butterfly', name: 'Social Butterfly', description: 'Talked with 2 different personalities', unlocked: true });
  if (personalityCount >= 4) achievements.push({ id: 'all_personalities', name: 'People Person', description: 'Talked with all 4 personalities', unlocked: true });
  
  // Conversation depth achievements
  const hasDeepConversation = personalityStats.some(stat => stat.maxRelationshipScore >= 80);
  if (hasDeepConversation) achievements.push({ id: 'deep_connection', name: 'Deep Connection', description: 'Formed a deep bond in a conversation', unlocked: true });
  
  return achievements;
}

module.exports = router;