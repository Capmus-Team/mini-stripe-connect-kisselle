// server.js - Express server setup for Stripe Connect
const express = require('express');
const stripe = require('stripe')('sk_test_51REcwxQqkCxm9OSdb7dJmibcGneIQV4Gil6HECM1vOq33XSYgEASQGwOvLuI7vByt3FsgsfgjzTGCYuNfbdcdj9w00FVJCVEIj');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Client ID for Stripe Connect
const CLIENT_ID = 'ca_SDjikpzoMuEZBZaGwjzrMrzlJXQE1DTy';
const REDIRECT_URI = 'http://localhost:3000/oauth/callback';

/**
 * 1. OAuth flow - redirect users to Stripe to authorize
 */
app.get('/connect/oauth', (req, res) => {
  const state = req.query.state || Math.random().toString(36).substring(2, 15);
  
  // Save state to validate on callback
  // In production, you'd use a session store or database
  
  const authorizationUrl = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&scope=read_write&state=${state}`;
  
  res.redirect(authorizationUrl);
});

/**
 * 2. Handle OAuth callback from Stripe
 */
app.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  
  // Validate state parameter to prevent CSRF
  // In production, compare with saved state
  
  try {
    // Exchange authorization code for access token
    const response = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });
    
    // response.stripe_user_id contains the connected account ID
    const connectedAccountId = response.stripe_user_id;
    
    // Store this account ID in your database
    // saveAccountToDatabase(connectedAccountId, response);
    
    res.send(`Account connected successfully! Account ID: ${connectedAccountId}`);
  } catch (error) {
    console.error('OAuth error:', error);
    res.status(500).send('Error connecting Stripe account');
  }
});

/**
 * 3. Create a payment intent for a marketplace transaction
 */
app.post('/api/create-payment', async (req, res) => {
  const { amount, connectedAccountId, applicationFeeAmount } = req.body;
  
  try {
    // Create a PaymentIntent on behalf of the connected account
    const paymentIntent = await stripe.paymentIntents.create({
      amount, // amount in cents
      currency: 'usd',
      application_fee_amount: applicationFeeAmount, // your platform fee
      transfer_data: {
        destination: connectedAccountId, // the seller's account ID
      },
    });
    
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('Payment intent error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 4. Endpoint to create an Express account link for onboarding
 */
app.post('/api/create-account-link', async (req, res) => {
  const { accountId } = req.body;
  
  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: 'http://localhost:3000/onboarding/refresh',
      return_url: 'http://localhost:3000/onboarding/complete',
      type: 'account_onboarding',
    });
    
    res.json({ url: accountLink.url });
  } catch (error) {
    console.error('Account link error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 5. Express account creation endpoint
 */
app.post('/api/create-express-account', async (req, res) => {
  const { email, country } = req.body;
  
  try {
    const account = await stripe.accounts.create({
      type: 'express',
      country: country || 'US',
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    
    res.json({ accountId: account.id });
  } catch (error) {
    console.error('Account creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 6. Webhook handler for Stripe events
 */
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = 'whsec_8pqxrpnqndd6OtLC8VELXIbRXEdi6KmY'; // Your webhook secret
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle specific events
  switch (event.type) {
    case 'account.updated':
      const account = event.data.object;
      console.log(`Account ${account.id} was updated`);
      // Update account status in your database
      break;
      
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log(`PaymentIntent ${paymentIntent.id} succeeded`);
      // Handle successful payment
      break;
      
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
  
  res.json({ received: true });
});

// Start server with proper error handling
let server = null;

function startServer() {
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
}

startServer();