require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieSession = require('cookie-session');

const authRoutes = require('./routes/auth');
const gmailRoutes = require('./routes/gmail');
const chatRoutes = require('./routes/chat');

const app = express();

app.use(helmet());

// Lock CORS down to your own frontend's origin in production. Defaults to
// allowing localhost dev origins; set ALLOWED_ORIGIN in .env once deployed.
const allowedOrigin = process.env.ALLOWED_ORIGIN || true; // `true` = reflect request origin, dev only
app.use(cors({ origin: allowedOrigin, credentials: true }));

// Generic rate limit across the API. Chat gets a tighter limit below since
// it's the most expensive (and most abusable) route.
app.use(rateLimit({ windowMs: 60 * 1000, max: 100 }));
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

app.use(express.json({ limit: '10mb' })); // generous limit for camera frames
app.use(
  cookieSession({
    name: 'signal_session',
    keys: [process.env.SESSION_SECRET || 'dev_only_secret'],
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  })
);

// Serves index.html (the chat/voice UI) and admin.html (the dashboard)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(authRoutes);
app.use(gmailRoutes);
app.use('/api/chat', chatLimiter);
app.use(chatRoutes);

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change_this_to_a_random_string') {
  console.warn('⚠️  SESSION_SECRET is missing or still the placeholder value — set a real random secret in .env');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Signal agent server running at http://localhost:${PORT}`);
});
