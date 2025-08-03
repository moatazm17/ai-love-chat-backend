const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const socketIo = require('socket.io');
const http = require('http');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const subscriptionRoutes = require('./routes/subscription');
const userRoutes = require('./routes/user');

const app = express();
// Trust the first proxy (Railway / Render / Heroku) so rate-limit & IP detection work correctly
app.set('trust proxy', true);
const server = http.createServer(app);

// Socket.IO setup for real-time chat
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-frontend-domain.com'] // Replace with actual frontend URL
    : ['http://localhost:3000', 'http://localhost:8081'], // Development origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting - prevent API abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-love-chat');
    console.log('🚀 MongoDB connected successfully');
  } catch (error) {
    console.error('⚠️  MongoDB connection error, continuing without DB:', error.message);
    // In development we continue without DB to avoid crashing
    // process.exit(1);
  }
};

// Connect to database
connectDB();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/user', userRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'AI Love Chat Backend',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    checks: {}
  };

  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState === 1) {
      healthCheck.checks.mongodb = { status: 'connected', message: 'Database is accessible' };
    } else {
      healthCheck.checks.mongodb = { status: 'disconnected', message: 'Database connection failed' };
      healthCheck.status = 'degraded';
    }

    // Check OpenAI API key
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-')) {
      healthCheck.checks.openai = { status: 'configured', message: 'OpenAI API key is present' };
    } else {
      healthCheck.checks.openai = { status: 'missing', message: 'OpenAI API key not configured' };
      healthCheck.status = 'degraded';
    }

    // Check JWT secret
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length > 32) {
      healthCheck.checks.auth = { status: 'configured', message: 'JWT secret is properly configured' };
    } else {
      healthCheck.checks.auth = { status: 'weak', message: 'JWT secret is missing or too short' };
      healthCheck.status = 'degraded';
    }

    res.json(healthCheck);
  } catch (error) {
    res.status(503).json({
      ...healthCheck,
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('👤 User connected:', socket.id);

  // Join user to their personal room
  socket.on('join_room', (userId) => {
    socket.join(userId);
    console.log(`👤 User ${userId} joined room`);
  });

  // Handle incoming messages
  socket.on('send_message', async (data) => {
    try {
      const { userId, message, personality } = data;
      
      // Emit typing indicator
      socket.to(userId).emit('ai_typing', { typing: true });
      
      // Process message with AI (imported from chat service)
      const chatService = require('./services/chatService');
      const response = await chatService.processMessage(userId, message, personality);
      
      // Stop typing indicator and send response
      socket.to(userId).emit('ai_typing', { typing: false });
      socket.to(userId).emit('ai_response', response);
      
    } catch (error) {
      console.error('❌ Socket message error:', error);
      socket.emit('error', { message: 'Failed to process message' });
    }
  });

  socket.on('disconnect', () => {
    console.log('👋 User disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Log error with more context
  console.error('❌ Server error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  // Determine error type and status code
  let statusCode = 500;
  let errorType = 'internal_error';
  
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorType = 'validation_error';
  } else if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorType = 'auth_error';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    errorType = 'invalid_id';
  }

  res.status(statusCode).json({ 
    success: false,
    error: errorType,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Handle 404 routes
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 AI Love Chat Backend running on port ${PORT}`);
  console.log(`📱 Socket.IO ready for real-time chat`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = { app, io };