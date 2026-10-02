// lib/api.js - small shared helpers for talking to the Steward public API.
//
// The key travels in the x-api-key header.
//
// THE HOST IS FIXED (D026, FIX-13). Nobody self-hosts Steward, so there is no
// API host field: every call goes to the one production API. That removes the
// only thing in this app an outsider could type into a URL, which is what
// D026 is about. stewardapp.dev does not serve /api/v1 (no rewrite in
// vercel.json), so the Railway host is the API host.
//
// assertSafeHost STAYS, as a guard on the fixed host: https, a real dotted
// hostname, nothing that resolves to the machine Zapier runs on or to a cloud
// metadata service. If somebody ever edits API_BASE_URL into something unsafe,
// every call fails loudly instead of sending the key there.

const API_BASE_URL = 'https://nonprofit-erp-production.up.railway.app';

// Hostnames that must never be called, however they are spelled.
const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata', 'metadata.google.internal', 'instance-data',
]);

const isIpv4 = host => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

// Private, loopback, link-local and carrier-grade-NAT space, plus the cloud
// metadata address every provider parks on 169.254.169.254.
const isPrivateIpv4 = host => {
  const p = host.split('.').map(Number);
  if (p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
};

// Throws a sentence the person can act on, or returns the cleaned-up origin.
const assertSafeHost = raw => {
  const text = String(raw || '').trim();
  if (!text) throw new Error('The API host is empty.');

  let url;
  try {
    url = new URL(text);
  } catch (e) {
    throw new Error(`"${text}" is not a web address. The API host looks like https://your-steward-host.example.org.`);
  }

  if (url.protocol !== 'https:') {
    throw new Error('The API host must start with https://. Steward will not send your API key over an unencrypted connection.');
  }
  if (url.username || url.password) {
    throw new Error('The API host must not carry a username or password. Put your key in the API key field instead.');
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error(`"${host}" is a local address. Zapier runs on its own servers, so it cannot reach a Steward on your machine or inside your network.`);
  }
  if (host.startsWith('[') || host.includes(':')) {
    throw new Error('The API host must be a hostname, not a raw IPv6 address.');
  }
  if (isIpv4(host)) {
    if (isPrivateIpv4(host)) {
      throw new Error(`"${host}" is a private or reserved address that Zapier cannot reach. Use the hostname your Steward is served on.`);
    }
    throw new Error('The API host must be a hostname, not an IP address, so the certificate can be checked.');
  }
  if (!host.includes('.') || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('-') || host.includes('..')) {
    throw new Error(`"${host}" is not a full hostname. The API host looks like https://your-steward-host.example.org.`);
  }

  // Keep a non-default port only if one was typed; drop path, query and hash.
  return `https://${host}${url.port ? ':' + url.port : ''}`;
};

// Takes the bundle only so every call site reads the same; the host is fixed.
const baseUrl = () => assertSafeHost(API_BASE_URL);

const headers = bundle => ({ 'x-api-key': bundle.authData.apiKey });

module.exports = { baseUrl, headers, assertSafeHost, API_BASE_URL };
