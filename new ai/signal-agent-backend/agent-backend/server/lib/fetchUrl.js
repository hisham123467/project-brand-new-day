// Lets the agent read a specific URL the user shares. This is deliberately
// locked down: it only allows http/https, refuses to fetch anything that
// resolves to a private/internal address (so the agent can't be tricked
// into hitting your own internal network, cloud metadata endpoints, etc.),
// caps response size, and times out quickly.

const dns = require('dns').promises;
const net = require('net');
const { convert } = require('html-to-text');

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 1_000_000; // 1MB cap on raw response
const MAX_TEXT_CHARS = 6000; // cap on what we hand back to the model

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local / cloud metadata
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  // IPv6 loopback / unique local / link-local
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;
  return false;
}

async function safeFetchUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: 'That is not a valid URL.' };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { error: 'Only http and https links can be read.' };
  }

  // Resolve and check every IP the hostname points to, blocking the
  // request if any of them is a private/internal address.
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    return { error: 'Could not resolve that domain.' };
  }
  if (addresses.some(a => isPrivateIp(a.address))) {
    return { error: 'That address cannot be fetched.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'SignalAgent/0.1 (+link-reading tool)' }
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { error: `Unsupported content type: ${contentType || 'unknown'}` };
    }

    const reader = res.body.getReader();
    let received = 0;
    let chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_BYTES) {
        controller.abort();
        break;
      }
      chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString('utf-8');

    const text = convert(html, {
      wordwrap: false,
      selectors: [
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'img', format: 'skip' }
      ]
    }).trim();

    return {
      url: url.toString(),
      text: text.slice(0, MAX_TEXT_CHARS)
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { error: 'The page took too long to respond.' };
    }
    return { error: 'Failed to fetch that page: ' + err.message };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { safeFetchUrl };
