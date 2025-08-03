# AI Love Chat Backend

Backend server for the AI Love Chat mobile application.

## Features

- OpenAI integration for AI conversations
- User authentication and management
- Real-time chat with Socket.IO
- Subscription management
- Rate limiting and security

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp config.example.js config.js
# Edit config.js with your actual values
```

3. Start the server:
```bash
npm start
```

## Environment Variables

- `MONGODB_URI`: MongoDB connection string
- `OPENAI_API_KEY`: OpenAI API key
- `JWT_SECRET`: JWT secret key
- `PORT`: Server port (default: 5000)

## API Endpoints

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/chat` - Send message to AI
- `GET /api/health` - Health check

## Deployment

This backend is designed to be deployed on Railway, Heroku, or similar platforms. 