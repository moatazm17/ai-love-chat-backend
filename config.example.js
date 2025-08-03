// AI Love Chat Backend Configuration
// Copy this file to config.js and update with your actual values

module.exports = {
  // Database
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-love-chat'
  },

  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'ai-love-chat-secret-key',
    expiresIn: '30d'
  },

  // OpenAI API
  openai: {
    apiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key-here'
  },

  // Stripe Payment Processing
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_your_stripe_secret_key_here',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_your_stripe_publishable_key_here',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_your_webhook_secret_here'
  },

  // Redis (Optional - for caching)
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },

  // App Configuration
  app: {
    port: process.env.PORT || 5000,
    clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
    environment: process.env.NODE_ENV || 'development'
  },

  // Subscription Plans
  subscriptionPlans: {
    basic: {
      price: 4.99,
      dailyMessages: 100,
      personalities: ['emma', 'sophia']
    },
    premium: {
      price: 9.99,
      dailyMessages: -1, // unlimited
      personalities: ['emma', 'sophia', 'luna', 'aria']
    },
    elite: {
      price: 19.99,
      dailyMessages: -1, // unlimited
      personalities: ['emma', 'sophia', 'luna', 'aria'],
      customPersonalities: true
    }
  },

  // Rate Limiting
  rateLimiting: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100
  },

  // Security
  security: {
    bcryptRounds: 12,
    sessionTimeout: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
};