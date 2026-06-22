// A minimal persistent store so Google tokens survive a server restart,
// without pulling in a full database for this scaffold. Swap this for
// Postgres/Mongo/etc. before running with real users — file-based storage
// like this doesn't handle concurrent writes safely at scale.

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'users.json');

function ensureFile() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}));
}

function readAll() {
  ensureFile();
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Each user is keyed by their Google account id (stable, not email —
// emails can change, Google ids don't).
function saveUser(googleId, record) {
  const all = readAll();
  all[googleId] = { ...(all[googleId] || {}), ...record };
  writeAll(all);
  return all[googleId];
}

function getUser(googleId) {
  const all = readAll();
  return all[googleId] || null;
}

function deleteUser(googleId) {
  const all = readAll();
  delete all[googleId];
  writeAll(all);
}

module.exports = { saveUser, getUser, deleteUser };
