const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const authenticateToken = require('../middleware/auth');
const router = express.Router();

// 💎 Subscription plans
const SUBSCRIPTION_PLANS = {
  basic: {
    id: 'basic',
    name: 'Basic',
    price: 4.99,
    currency: 'usd',
    interval: 'month',
    features: [
      '100 messages per day',
      '2 AI personalities',
      'No advertisements',
      'Basic memory system'
    ],
    limits: {
      dailyMessages: 100,
      personalities: ['emma', 'sophia']
    }
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    price: 9.99,
    currency: 'usd',
    interval: 'month',
    features: [
      'Unlimited messages',
      'All 4 AI personalities',
      'Advanced memory system',
      'Priority responses',
      'Conversation analytics'
    ],
    limits: {
      dailyMessages: -1, // unlimited
      personalities: ['emma', 'sophia', 'luna', 'aria']
    }
  },
  elite: {
    id: 'elite',
    name: 'Elite',
    price: 19.99,
    currency: 'usd',
    interval: 'month',
    features: [
      'Everything in Premium',
      'Custom AI personalities',
      'Fastest response times',
      'Advanced relationship analytics',
      'Priority customer support'
    ],
    limits: {
      dailyMessages: -1, // unlimited
      personalities: ['emma', 'sophia', 'luna', 'aria'],
      customPersonalities: true
    }
  }
};

// 📋 Get subscription plans
router.get('/plans', async (req, res) => {
  try {
    res.json({
      success: true,
      plans: Object.values(SUBSCRIPTION_PLANS)
    });
  } catch (error) {
    console.error('❌ Get plans error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to get subscription plans'
    });
  }
});

// 💳 Create subscription checkout session
router.post('/create-checkout-session', authenticateToken, async (req, res) => {
  try {
    const { planId } = req.body;
    const userId = req.user.userId;
    
    // Validate plan
    const plan = SUBSCRIPTION_PLANS[planId];
    if (!plan) {
      return res.status(400).json({
        success: false,
        error: 'invalid_plan',
        message: 'Invalid subscription plan'
      });
    }
    
    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'User not found'
      });
    }
    
    // Create or retrieve Stripe customer
    let customerId = user.subscription.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: userId.toString()
        }
      });
      
      customerId = customer.id;
      user.subscription.stripeCustomerId = customerId;
      await user.save();
    }
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: plan.currency,
            product_data: {
              name: `AI Love Chat ${plan.name}`,
              description: `Monthly subscription to AI Love Chat ${plan.name} plan`,
            },
            unit_amount: Math.round(plan.price * 100), // Convert to cents
            recurring: {
              interval: plan.interval,
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/subscription/cancelled`,
      metadata: {
        userId: userId.toString(),
        planId: planId
      }
    });
    
    res.json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id
    });
    
  } catch (error) {
    console.error('❌ Create checkout session error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to create checkout session'
    });
  }
});

// ✅ Handle successful subscription
router.post('/success', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.userId;
    
    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.metadata.userId !== userId.toString()) {
      return res.status(400).json({
        success: false,
        error: 'invalid_session',
        message: 'Invalid session'
      });
    }
    
    // Get subscription details
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    const planId = session.metadata.planId;
    const plan = SUBSCRIPTION_PLANS[planId];
    
    // Update user subscription
    const user = await User.findByIdAndUpdate(
      userId,
      {
        'subscription.type': planId,
        'subscription.status': 'active',
        'subscription.startDate': new Date(),
        'subscription.endDate': new Date(subscription.current_period_end * 1000),
        'subscription.stripeSubscriptionId': subscription.id
      },
      { new: true }
    );
    
    console.log(`✅ Subscription activated: ${planId} for user ${userId}`);
    
    res.json({
      success: true,
      message: 'Subscription activated successfully',
      subscription: {
        plan: plan.name,
        status: 'active',
        features: plan.features
      }
    });
    
  } catch (error) {
    console.error('❌ Subscription success error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to process subscription'
    });
  }
});

// 🚫 Cancel subscription
router.post('/cancel', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const user = await User.findById(userId);
    if (!user || !user.subscription.stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        error: 'no_subscription',
        message: 'No active subscription found'
      });
    }
    
    // Cancel subscription at period end
    await stripe.subscriptions.update(user.subscription.stripeSubscriptionId, {
      cancel_at_period_end: true
    });
    
    // Update user status
    user.subscription.status = 'cancelled';
    await user.save();
    
    console.log(`🚫 Subscription cancelled for user ${userId}`);
    
    res.json({
      success: true,
      message: 'Subscription will be cancelled at the end of the current period'
    });
    
  } catch (error) {
    console.error('❌ Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to cancel subscription'
    });
  }
});

// 🔄 Reactivate subscription
router.post('/reactivate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const user = await User.findById(userId);
    if (!user || !user.subscription.stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        error: 'no_subscription',
        message: 'No subscription found'
      });
    }
    
    // Reactivate subscription
    await stripe.subscriptions.update(user.subscription.stripeSubscriptionId, {
      cancel_at_period_end: false
    });
    
    // Update user status
    user.subscription.status = 'active';
    await user.save();
    
    console.log(`🔄 Subscription reactivated for user ${userId}`);
    
    res.json({
      success: true,
      message: 'Subscription reactivated successfully'
    });
    
  } catch (error) {
    console.error('❌ Reactivate subscription error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to reactivate subscription'
    });
  }
});

// 📊 Get subscription status
router.get('/status', authenticateToken, async (req, res) => {
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
    
    let subscriptionDetails = null;
    
    // If user has active subscription, get details from Stripe
    if (user.subscription.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(user.subscription.stripeSubscriptionId);
        subscriptionDetails = {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end
        };
      } catch (stripeError) {
        console.error('Stripe subscription fetch error:', stripeError);
      }
    }
    
    const plan = SUBSCRIPTION_PLANS[user.subscription.type] || null;
    
    res.json({
      success: true,
      subscription: {
        type: user.subscription.type,
        status: user.subscription.status,
        plan: plan ? {
          name: plan.name,
          price: plan.price,
          features: plan.features
        } : null,
        usage: {
          messagesUsedToday: user.usage.messagesUsedToday,
          messagesLeft: user.canSendMessage() ? 
            (user.subscription.type === 'free' ? 15 - user.usage.messagesUsedToday : -1) : 0,
          totalMessages: user.usage.totalMessages
        },
        stripeDetails: subscriptionDetails
      }
    });
    
  } catch (error) {
    console.error('❌ Get subscription status error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to get subscription status'
    });
  }
});

// 🎫 Generate promo code usage
router.post('/promo', authenticateToken, async (req, res) => {
  try {
    const { promoCode } = req.body;
    const userId = req.user.userId;
    
    // Simple promo codes (in production, store these in database)
    const promoCodes = {
      'WELCOME50': {
        type: 'messages',
        value: 50,
        description: '50 bonus messages'
      },
      'PREMIUM7': {
        type: 'trial',
        value: 7,
        plan: 'premium',
        description: '7 days Premium trial'
      }
    };
    
    const promo = promoCodes[promoCode.toUpperCase()];
    if (!promo) {
      return res.status(400).json({
        success: false,
        error: 'invalid_promo',
        message: 'Invalid promo code'
      });
    }
    
    const user = await User.findById(userId);
    
    if (promo.type === 'messages') {
      // Add bonus messages (reset daily count)
      user.usage.messagesUsedToday = Math.max(0, user.usage.messagesUsedToday - promo.value);
      await user.save();
      
      res.json({
        success: true,
        message: `${promo.value} bonus messages added!`,
        bonus: promo.value
      });
      
    } else if (promo.type === 'trial') {
      // Activate trial subscription
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + promo.value);
      
      user.subscription.type = promo.plan;
      user.subscription.status = 'active';
      user.subscription.startDate = new Date();
      user.subscription.endDate = endDate;
      await user.save();
      
      res.json({
        success: true,
        message: `${promo.value} days ${promo.plan} trial activated!`,
        trialDays: promo.value
      });
    }
    
  } catch (error) {
    console.error('❌ Promo code error:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to apply promo code'
    });
  }
});

// 🎧 Webhook handler for Stripe events
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  try {
    // Handle the event
    switch (event.type) {
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
        
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
        
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
        
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
        
      default:
        console.log(`Unhandled event type ${event.type}`);
    }
    
    res.json({received: true});
    
  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    res.status(500).json({error: 'Webhook handler failed'});
  }
});

// Webhook helper functions
async function handleSubscriptionUpdated(subscription) {
  try {
    const user = await User.findOne({
      'subscription.stripeSubscriptionId': subscription.id
    });
    
    if (user) {
      user.subscription.status = subscription.status;
      user.subscription.endDate = new Date(subscription.current_period_end * 1000);
      await user.save();
      
      console.log(`📄 Subscription updated for user ${user._id}`);
    }
  } catch (error) {
    console.error('Error handling subscription update:', error);
  }
}

async function handleSubscriptionDeleted(subscription) {
  try {
    const user = await User.findOne({
      'subscription.stripeSubscriptionId': subscription.id
    });
    
    if (user) {
      user.subscription.type = 'free';
      user.subscription.status = 'expired';
      user.subscription.endDate = new Date();
      await user.save();
      
      console.log(`🚫 Subscription deleted for user ${user._id}`);
    }
  } catch (error) {
    console.error('Error handling subscription deletion:', error);
  }
}

async function handlePaymentSucceeded(invoice) {
  console.log(`💳 Payment succeeded: ${invoice.id}`);
  // You could send a thank you email here
}

async function handlePaymentFailed(invoice) {
  console.log(`❌ Payment failed: ${invoice.id}`);
  // You could send a payment failed email here
}

module.exports = router;