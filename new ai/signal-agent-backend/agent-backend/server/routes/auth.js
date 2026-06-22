const express = require('express');
const { createOAuthClient, GMAIL_SCOPES } = require('../lib/googleClient');
const { google } = require('googleapis');
const store = require('../lib/store');

const router = express.Router();

// Step 1: user clicks "Connect Gmail" in the admin page, which hits this route.
// It redirects them to Google's real login + consent screen — we never see
// or touch their password at any point.
router.get('/auth/google', (req, res) => {
  const oauth2Client = createOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // so we get a refresh token
    prompt: 'consent',
    scope: GMAIL_SCOPES
  });
  res.redirect(url);
});

// Step 2: Google redirects the user back here with a one-time code after
// THEY approve the consent screen on Google's own site.
router.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing auth code from Google.');

  try {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Look up who just authenticated, using Google's own userinfo endpoint
    const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
    const { data: profile } = await oauth2.userinfo.get();

    // Persist tokens to disk, keyed by this user's stable Google id.
    // Refresh token is only returned by Google on first consent — if a
    // returning user doesn't get a new one, keep the one we already have.
    const existing = store.getUser(profile.id);
    store.saveUser(profile.id, {
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || existing?.refreshToken,
      expiryDate: tokens.expiry_date
    });

    // The cookie only ever holds a reference id, never the tokens themselves.
    req.session.userId = profile.id;

    res.redirect('/admin.html');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.status(500).send('Google sign-in failed. Check server logs.');
  }
});

router.get('/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ connected: false });
  const user = store.getUser(req.session.userId);
  if (!user) return res.json({ connected: false });
  res.json({
    connected: true,
    user: { email: user.email, name: user.name, picture: user.picture }
  });
});

router.post('/auth/logout', (req, res) => {
  if (req.session.userId) {
    store.deleteUser(req.session.userId);
  }
  req.session = null;
  res.json({ ok: true });
});

module.exports = router;
