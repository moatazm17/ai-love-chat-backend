// Quick test for OpenAI API
require('dotenv').config();
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testAI() {
  try {
    console.log('🤖 Testing OpenAI API...');
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system", 
          content: "You are Emma, a caring and supportive AI girlfriend. Keep responses warm and friendly."
        },
        {
          role: "user", 
          content: "Hi Emma! How are you today?"
        }
      ],
      max_tokens: 100,
      temperature: 0.7
    });

    console.log('✅ OpenAI API working!');
    console.log('🎭 Emma says:', response.choices[0].message.content);
    console.log('💰 Tokens used:', response.usage.total_tokens);
    
  } catch (error) {
    console.error('❌ OpenAI Error:', error.message);
  }
}

testAI();