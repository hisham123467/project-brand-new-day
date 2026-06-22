const express = require('express');
const { google } = require('googleapis');
const { createOAuthClient } = require('../lib/googleClient');
const store = require('../lib/store');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId || !store.getUser(req.session.userId)) {
    return res.status(401).json({ error: 'Not connected to Gmail. Sign in first.' });
  }
  next();
}

// Builds an authenticated Gmail client for whichever user owns this
// session, refreshing the access token first if it's expired. Refreshed
// tokens are written back to the store so this stays valid across requests.
async function gmailClientFor(req) {
  const userRecord = store.getUser(req.session.userId);
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: userRecord.accessToken,
    refresh_token: userRecord.refreshToken,
    expiry_date: userRecord.expiryDate
  });

  const isExpired = !userRecord.expiryDate || userRecord.expiryDate < Date.now() + 60000;
  if (isExpired && userRecord.refreshToken) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    store.saveUser(req.session.userId, {
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date
    });
  }

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Lists the most recent messages in the SIGNED-IN user's own inbox.
// There is no path here that takes an arbitrary email address — it always
// acts on whichever Google account the session owner authenticated as.
router.get('/api/gmail/messages', requireAuth, async (req, res) => {
  try {
    const gmail = await gmailClientFor(req);
    const list = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 10
    });

    const messages = list.data.messages || [];
    const details = await Promise.all(
      messages.map(async (m) => {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date']
        });
        const headers = msg.data.payload.headers || [];
        const get = (name) => headers.find(h => h.name === name)?.value || '';
        return {
          id: m.id,
          subject: get('Subject'),
          from: get('From'),
          date: get('Date'),
          snippet: msg.data.snippet
        };
      })
    );

    res.json({ messages: details });
  } catch (err) {
    console.error('Gmail fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch Gmail messages.' });
  }
});

module.exports = router;
