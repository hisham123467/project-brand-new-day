# Signal — Agent Backend

This is the backend layer for the Signal AI agent: it adds web browsing and
real, OAuth-based Gmail access on top of the chat/voice frontend you already
have.

## What's in here

```
server/
  index.js            – main Express app
  routes/auth.js       – Google OAuth login flow (the "Connect Gmail" button)
  routes/gmail.js       – reads the signed-in user's own inbox (read-only)
  routes/chat.js         – chat endpoint with web search enabled
  lib/googleClient.js     – OAuth2 client helper
  .env.example             – copy to .env and fill in your keys
public/
  admin.html                – dashboard where a signed-in user manages their
                               own Gmail connection and sees their own inbox
```

The frontend chat/voice page (`index.html` from before) should now point its
fetch calls at `http://localhost:3000/api/chat` instead of calling the
Anthropic API directly, so requests go through this server.

## Setup

1. **Install dependencies**
   ```
   cd server
   npm install
   ```

2. **Get an Anthropic API key**
   From https://console.anthropic.com/settings/keys

3. **Set up Google OAuth (for Gmail)**
   - Go to https://console.cloud.google.com/apis/credentials
   - Create an OAuth 2.0 Client ID, type "Web application"
   - Add `http://localhost:3000/auth/google/callback` as an authorized redirect URI
   - Under "OAuth consent screen," add the scope `https://www.googleapis.com/auth/gmail.readonly`
   - While your app is in "Testing" mode, add your own Google account as a test user — Google won't let anyone else's account through until you publish the app for verification

4. **Configure environment variables**
   ```
   cp .env.example .env
   ```
   Then fill in `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET`.

5. **Run it**
   ```
   npm start
   ```
   Server runs at http://localhost:3000. Visit `/admin.html` to connect Gmail.

## What's new in this round: links, auto-reading, code, and security hardening

**Reading specific links.** `web_search` (added earlier) searches the web broadly.
This round adds a separate `read_url` tool — when a user pastes a specific link
or says "what does this page say," the agent calls `read_url` itself and reads
the actual page back, no extra step needed from the user. It's locked down on
purpose: only `http`/`https`, every hostname is resolved and checked against
private/internal IP ranges before fetching (so it can't be tricked into hitting
your own internal network or cloud metadata endpoints), responses are capped at
1MB, and there's an 8-second timeout. See `server/lib/fetchUrl.js`.

**Code execution — off by default.** `run_code` lets the agent execute short
JS snippets and show the output (handy for "actually check that calculation").
This is the one feature here where "safe" needs an asterisk: Node's built-in
`vm` module blocks the obvious stuff (no `require`, `process`, filesystem, or
network inside the sandbox) but it is **not a hardened security boundary** —
sandbox escapes in `vm`-based sandboxes are a known class of issue. That's why
it's disabled unless you explicitly set `ENABLE_CODE_EXECUTION=true`. If you
want this exposed to the public rather than just yourself, the real fix is
running each execution in a throwaway Docker container (or microVM) with no
network access and hard resource limits — happy to build that version if you
want to take this further. Full reasoning is in `server/lib/runCode.js`.

**Security hardening across the server:**
- `helmet` sets sane security headers by default
- Rate limiting: 100 requests/min generally, 20/min specifically on `/api/chat`
  (the most expensive and most abusable route)
- CORS now reads from `ALLOWED_ORIGIN` in `.env` instead of allowing any origin —
  set this to your real frontend URL once deployed
- Session cookies are `sameSite: lax` and marked `secure` automatically in
  production
- A startup warning fires if `SESSION_SECRET` is missing or still the
  placeholder value

None of this replaces the production checklist further down (real database,
HTTPS, OAuth verification) — it raises the floor on what's here already.



There's no path anywhere in this code that takes someone else's email
address or password. The only way data shows up is:

1. A user clicks "Connect Gmail" on `/admin.html`
2. They're redirected to Google's **own** login page (not anything this app
   controls) and sign in there
3. Google asks them to approve the specific permission ("read your email")
4. Google sends back a token tied to that one account
5. That token is written to `server/data/users.json`, keyed by that user's
   Google account id, and is only ever used to read that same account's
   inbox. The browser cookie only stores a reference id, never the token
   itself.
6. Access tokens expire roughly every hour — `gmailClientFor` checks the
   stored expiry and silently refreshes using the refresh token before
   each Gmail call, so the connection stays live without the user having
   to reconnect.

This is the only way the Gmail API can be used for a multi-user product —
it's also exactly how apps like Superhuman or Sanebox work under the hood.

## Bug fixes in this round

- **Double-send on Enter:** the camera-capture wiring added in an earlier
  pass attached a second `keydown` listener instead of replacing the first
  (a `removeEventListener` call used a mismatched function reference, so it
  silently did nothing). Result: pressing Enter sent every message twice.
  Clicking the send button was unaffected. Fixed by folding camera capture
  directly into `handleSend()` instead of patching listeners after the fact.
- Minor: `vm.Script`'s constructor doesn't actually take a `timeout` option
  (only `runInContext` does) — removed the dead option; behavior was already
  correct since the real timeout was being applied correctly either way.
- Minor: mic error handling now also resets the listening UI state, so a
  failed mic permission doesn't leave the orb stuck in "listening."
- Verified: all backend files pass `node --check`, dependencies install
  cleanly, and the server boots successfully end to end.

## Important: this is a development scaffold, not production-ready

A few things you'd want before real users touch this:
- `server/data/users.json` is fine for local development but isn't safe
  for concurrent writes at scale — move to Postgres/Mongo/etc. before
  real traffic
- Add HTTPS — Google won't allow OAuth redirect URIs over plain HTTP except
  for `localhost`
- Submit the app for Google's OAuth verification before going beyond a
  handful of test users (Google requires this for sensitive scopes like
  Gmail)
- Rate-limit and add auth checks more broadly as you add features
- Encrypt tokens at rest if you move to a real database

## Camera / vision

This is already wired up: the frontend (`public/index.html`) captures a
camera frame as base64 and sends it as an image block inside the same
`/api/chat` request as the user's message, so vision goes through your
server exactly like text does — nothing calls Anthropic directly from the
browser anymore.

## Next layers

- Move `server/data/users.json` to a real database
- Deploy somewhere with HTTPS (Render, Railway, Fly.io, a VPS, etc.) so this
  isn't limited to localhost
- Add the rest of Google's OAuth verification flow if you want this used
  by people outside your own test users
