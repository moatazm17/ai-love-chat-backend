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
const server = http.createServer(app);

// Socket.IO setup for real-time chat
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Security middleware
app.use(helmet());
app.use(cors());

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
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-love-chat', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
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
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'AI Love Chat Backend'
  });
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
  console.error('❌ Server error:', err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
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