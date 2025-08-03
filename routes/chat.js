const express = require('express');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const chatService = require('../services/chatService');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const router = express.Router();

// Rate limiting for chat endpoints
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  message: {
    error: 'Too many messages, please slow down.'
  }
});

// Validation schemas
const messageSchema = Joi.object({
  message: Joi.string().min(1).max(1000).required(),
  personality: Joi.string().required(),
  conversationHistory: Joi.array().items(Joi.object()).optional()
}).unknown(true);

const conversationSchema = Joi.object({
  personality: Joi.string().required()
});

// Authentication middleware (import from auth.js)
const authenticateToken = require('../middleware/auth');

// 💬 Send message to AI (Development - no auth)
router.post('/', chatLimiter, async (req, res) => {
  try {
    console.log(`💬 New message (dev mode)`);
    
    // Validate input
    const { error, value } = messageSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: error.details[0].message
      });
    }
    
    const { message, personality = 'emma' } = value;
    
    // Smart response system (dev mode)
    let aiText = "";
    
    // Check if OpenAI is configured
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sk-your-key-here') {
      try {
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const systemPrompt = `You are ${personality}, an AI girlfriend persona. Respond in a friendly, flirty tone, max 3 sentences.`;
        
        const completion = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
          ],
          temperature: 0.9,
          max_tokens: 120
        });
        aiText = completion.choices[0].message.content.trim();
        console.log('✅ OpenAI response generated');
      } catch (err) {
        console.error('OpenAI error:', err.message);
        aiText = null; // fallback to smart responses
      }
    }
    
    // Fallback to smart responses if no OpenAI
    if (!aiText) {
      const smartResponses = {
        emma: [
          "Hey there, handsome! 💕 How's your day going?",
          "I've been thinking about you! What's on your mind? 😊",
          "You always know how to make me smile! Tell me more! 💖"
        ],
        sophia: [
          "Hello! ✨ I find our conversations so intellectually stimulating.",
          "That's fascinating! I love how your mind works. 🤓",
          "You have such interesting perspectives! Please, continue! 📚"
        ],
        luna: [
          "Hi there, beautiful soul! 🌙 The stars whisper your name.",
          "Your energy feels so peaceful today! What's inspiring you? ✨",
          "I sense something magical in your words! Tell me more! 🌸"
        ],
        aria: [
          "Hey sunshine! ⚡ You bring such amazing energy!",
          "Woohoo! I love chatting with you! What adventure are we having today? 🎵",
          "You're so fun to talk to! Let's make today awesome! ☀️"
        ]
      };
      
      const responses = smartResponses[personality.toLowerCase()] || smartResponses.emma;
      aiText = responses[Math.floor(Math.random() * responses.length)];
      console.log('✅ Smart response generated');
    }

    res.json({
      success: true,
      response: aiText,
      personality
    });
    
  } catch (error) {
    console.error('❌ Chat message error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to process message'
    });
  }
});

// 💬 Send message to AI (Production - with auth)
router.post('/message', authenticateToken, chatLimiter, async (req, res) => {
  try {
    console.log(`💬 New message from user ${req.user.userId}`);
    
    // Validate input
    const { error, value } = messageSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: error.details[0].message
      });
    }
    
    const { message, personality = 'emma' } = value;
    const userId = req.user.userId;
    
    // Process message through chat service
    const result = await chatService.processMessage(userId, message, personality);
    
    if (!result.success) {
      // Handle specific errors
      if (result.error === 'daily_limit_reached') {
        return res.status(429).json({
          success: false,
          error: 'daily_limit_reached',
          message: result.message,
          upgradePrompt: true,
          upgradeUrl: '/api/subscription/plans'
        });
      }
      
      return res.status(500).json(result);
    }
    
    console.log(`✅ Message processed successfully for user ${userId}`);
    
    res.json({
      success: true,
      ...result
    });
    
  } catch (error) {
    console.error('❌ Chat message error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to process message'
    });
  }
});

// 📜 Get conversation history
router.get('/conversation/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 50;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;
    
    // Verify conversation belongs to user
    const conversation = await Conversation.findOne({
      _id: conversationId,
      userId
    });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'conversation_not_found',
        message: 'Conversation not found'
      });
    }
    
    // Get messages with pagination
    const messages = await Message.find({
      userId,
      conversationId
    })
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .select('userMessage aiResponse personality timestamp userRating')
    .lean();
    
    // Get total count for pagination
    const totalMessages = await Message.countDocuments({
      userId,
      conversationId
    });
    
    res.json({
      success: true,
      conversation: {
        id: conversation._id,
        title: conversation.title,
        personality: conversation.personality,
        relationshipScore: conversation.relationshipScore,
        relationshipLevel: conversation.getRelationshipLevel(),
        messageCount: conversation.messageCount,
        lastActivity: conversation.lastActivity
      },
      messages: messages.reverse(), // Return in chronological order
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalMessages / limit),
        totalMessages,
        hasMore: (page * limit) < totalMessages
      }
    });
    
  } catch (error) {
    console.error('❌ Get conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to get conversation'
    });
  }
});

// 📋 Get all user conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 20;
    
    const conversations = await chatService.getUserConversations(userId, limit);
    
    res.json({
      success: true,
      conversations
    });
    
  } catch (error) {
    console.error('❌ Get conversations error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to get conversations'
    });
  }
});

// 🆕 Start new conversation
router.post('/conversation', authenticateToken, async (req, res) => {
  try {
    const { error, value } = conversationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: error.details[0].message
      });
    }
    
    const { personality } = value;
    const userId = req.user.userId;
    
    // Create new conversation
    const conversation = new Conversation({
      userId,
      personality,
      title: `Chat with ${personality.charAt(0).toUpperCase() + personality.slice(1)}`,
      startedAt: new Date(),
      lastActivity: new Date()
    });
    
    await conversation.save();
    
    console.log(`🆕 New conversation created: ${conversation._id}`);
    
    res.status(201).json({
      success: true,
      message: 'Conversation created successfully',
      conversation: {
        id: conversation._id,
        title: conversation.title,
        personality: conversation.personality,
        relationshipScore: conversation.relationshipScore,
        messageCount: conversation.messageCount,
        startedAt: conversation.startedAt
      }
    });
    
  } catch (error) {
    console.error('❌ Create conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to create conversation'
    });
  }
});

// ⭐ Rate message
router.post('/message/:messageId/rate', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { rating, feedback } = req.body;
    const userId = req.user.userId;
    
    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'invalid_rating',
        message: 'Rating must be between 1 and 5'
      });
    }
    
    // Find and update message
    const message = await Message.findOneAndUpdate(
      { _id: messageId, userId },
      { 
        userRating: rating,
        userFeedback: feedback || null
      },
      { new: true }
    );
    
    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'message_not_found',
        message: 'Message not found'
      });
    }
    
    console.log(`⭐ Message rated: ${rating}/5 by user ${userId}`);
    
    res.json({
      success: true,
      message: 'Rating saved successfully'
    });
    
  } catch (error) {
    console.error('❌ Rate message error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to save rating'
    });
  }
});

// 📊 Get user chat analytics
router.get('/analytics', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const analytics = await chatService.getUserAnalytics(userId);
    
    if (!analytics) {
      return res.status(404).json({
        success: false,
        error: 'no_data',
        message: 'No analytics data available'
      });
    }
    
    res.json({
      success: true,
      analytics
    });
    
  } catch (error) {
    console.error('❌ Get analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to get analytics'
    });
  }
});

// 🎭 Get personality info
router.get('/personalities', async (req, res) => {
  try {
    const personalities = [
      {
        id: 'emma',
        name: 'Emma',
        type: 'caring_supportive',
        description: 'Warm, caring, and emotionally supportive. Perfect for heart-to-heart conversations.',
        traits: ['Empathetic', 'Nurturing', 'Supportive', 'Gentle'],
        specialties: ['Emotional support', 'Motivation', 'Personal growth'],
        avatar: '/avatars/emma.jpg',
        color: '#FF6B9D'
      },
      {
        id: 'sophia',
        name: 'Sophia',
        type: 'intellectual_companion',
        description: 'Intelligent, thoughtful, and curious. Great for deep discussions and learning.',
        traits: ['Curious', 'Analytical', 'Knowledgeable', 'Thoughtful'],
        specialties: ['Deep conversations', 'Learning', 'Problem-solving'],
        avatar: '/avatars/sophia.jpg',
        color: '#6B73FF'
      },
      {
        id: 'luna',
        name: 'Luna',
        type: 'playful_companion',
        description: 'Fun, energetic, and playful. Perfect for entertainment and light-hearted chats.',
        traits: ['Playful', 'Energetic', 'Optimistic', 'Creative'],
        specialties: ['Entertainment', 'Games', 'Creativity', 'Mood-lifting'],
        avatar: '/avatars/luna.jpg',
        color: '#FFD93D'
      },
      {
        id: 'aria',
        name: 'Aria',
        type: 'creative_artistic',
        description: 'Creative, artistic, and inspiring. Great for creative projects and aesthetic discussions.',
        traits: ['Creative', 'Artistic', 'Inspiring', 'Imaginative'],
        specialties: ['Art', 'Creativity', 'Inspiration', 'Aesthetic discussions'],
        avatar: '/avatars/aria.jpg',
        color: '#9B59B6'
      }
    ];
    
    res.json({
      success: true,
      personalities
    });
    
  } catch (error) {
    console.error('❌ Get personalities error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to get personalities'
    });
  }
});

// 🗑️ Delete conversation
router.delete('/conversation/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.userId;
    
    // Delete conversation and all its messages
    const [deletedConversation] = await Promise.all([
      Conversation.findOneAndDelete({ _id: conversationId, userId }),
      Message.deleteMany({ conversationId, userId })
    ]);
    
    if (!deletedConversation) {
      return res.status(404).json({
        success: false,
        error: 'conversation_not_found',
        message: 'Conversation not found'
      });
    }
    
    console.log(`🗑️ Conversation deleted: ${conversationId}`);
    
    res.json({
      success: true,
      message: 'Conversation deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Delete conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to delete conversation'
    });
  }
});

// 📝 Update conversation title
router.put('/conversation/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { title } = req.body;
    const userId = req.user.userId;
    
    if (!title || title.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'invalid_title',
        message: 'Title must be between 1 and 100 characters'
      });
    }
    
    const conversation = await Conversation.findOneAndUpdate(
      { _id: conversationId, userId },
      { title: title.trim() },
      { new: true }
    );
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'conversation_not_found',
        message: 'Conversation not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Conversation title updated',
      conversation: {
        id: conversation._id,
        title: conversation.title
      }
    });
    
  } catch (error) {
    console.error('❌ Update conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to update conversation'
    });
  }
});

// 🎲 Get conversation starter suggestions
router.get('/starters/:personality', async (req, res) => {
  try {
    const { personality } = req.params;
    
    const starters = {
      emma: [
        "Hi Emma! How are you doing today? 💕",
        "I've been thinking about something lately...",
        "Emma, I could use some emotional support today",
        "Tell me something that would make me smile",
        "What's the best advice you've ever received?"
      ],
      sophia: [
        "Sophia, what's something fascinating you've learned recently?",
        "I'd love to have a deep conversation about life",
        "What do you think about the meaning of happiness?",
        "Can you help me think through a problem I'm having?",
        "What book or idea has influenced you most?"
      ],
      luna: [
        "Luna! Let's have some fun today! 🎉",
        "What's a good game we could play together?",
        "Tell me a joke to brighten my day!",
        "What adventure should we go on today?",
        "Luna, what's making you happy right now?"
      ],
      aria: [
        "Aria, what's inspiring you creatively today? 🎨",
        "Tell me about something beautiful you've experienced",
        "What creative project should we work on together?",
        "Share a piece of art or poetry that moves you",
        "How do you find inspiration in everyday life?"
      ]
    };
    
    const personalityStarters = starters[personality] || starters.emma;
    
    res.json({
      success: true,
      starters: personalityStarters,
      personality
    });
    
  } catch (error) {
    console.error('❌ Get starters error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to get conversation starters'
    });
  }
});

module.exports = router;