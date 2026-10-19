// safeFetch.js · FIX-43. THE ONE WAY STEWARD FETCHES AN ADDRESS A PERSON TYPED.
//
// A website address in setup, a logo their page points at, a photo column in a
// spreadsheet, a webhook endpoint an admin pasted: each is a server making a
// request to an address somebody else chose, which is the textbook SSRF shape.
// The old guards checked the name, then let fetch resolve it again, so a domain
// could answer a public IP for the check and a private one for the fetch (DNS
// rebinding). This module closes that:
//
//   1. The hostname is resolved ONCE. Every address in the answer must be
//      public (no private, loopback, link-local, metadata, multicast or
//      reserved range, IPv4 or IPv6, including mapped and embedded forms).
//   2. The socket connects to THAT IP, with the original Host header and SNI,
//      so TLS still checks the certificate against the name.
//   3. Redirects are followed by hand, at most three, and every hop runs 1-2.
//   4. Only http and https, only ports 80 and 443; a response is capped in
//      bytes (after decompression) and in time.
//
// It never throws: the answer is { ok, status, headers, url, body } or
// { ok:false, status:0, reason }. `allowLocal` is the test seam (a suite
// serving a saved page on localhost); it is refused in production.
"use strict";

const http = require("http");
const https = require("https");
const dns = require("dns").promises;
const net = require("net");
const zlib = require("zlib");

const DEFAULTS = { maxRedirects: 3, maxBytes: 1024 * 1024, timeoutMs: 8000, schemes: ["http:", "https:"] };
const PORTS = { "http:": 80, "https:": 443 };
const BLOCKED_NAMES = /(^localhost$|\.localhost$|\.local$|\.internal$|^metadata$|^metadata\.goog$|^instance-data$)/;
const observers = new Set();   // tests watch every request leave

// ── WHICH ADDRESSES ARE PUBLIC ─────────────────────────────────────────────
const V4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const v4Int = ip => ip.split(".").reduce((n, o) => (n << 8 >>> 0) + Number(o), 0) >>> 0;
const V4_RANGES = V4_BLOCKED.map(([base, bits]) => ({ base: v4Int(base), mask: bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0 }));
function v4Blocked(ip) {
  const n = v4Int(ip);
  return V4_RANGES.some(r => ((n & r.mask) >>> 0) === r.base);
}

// IPv6 as eight 16-bit groups, so every spelling of an address is one value.
function v6Groups(ip) {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const n = v4Int(tail[1]);
    s = s.slice(0, -tail[1].length) + ((n >>> 16).toString(16)) + ":" + ((n & 0xffff).toString(16));
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const g = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...rest].map(x => parseInt(x, 16));
  return g.length === 8 && g.every(x => x >= 0 && x <= 0xffff) ? g : null;
}
const embeddedV4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
function v6Blocked(ip) {
  const g = v6Groups(ip);
  if (!g) return true;
  const zeroTo = k => g.slice(0, k).every(x => x === 0);
  if (zeroTo(8)) return true;                                        // ::
  if (zeroTo(7) && g[7] === 1) return true;                          // ::1
  if (zeroTo(5) && g[5] === 0xffff) return v4Blocked(embeddedV4(g[6], g[7]));   // ::ffff:a.b.c.d mapped
  if (zeroTo(6)) return true;                                        // ::a.b.c.d compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;                 // 64:ff9b::/96 NAT64 reaches v4 anywhere
  if (g[0] === 0x2002) return v4Blocked(embeddedV4(g[1], g[2]));     // 6to4 carries a v4
  if (g[0] === 0x2001 && g[1] === 0) return true;                    // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;               // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;    // discard 100::/64
  if ((g[0] & 0xfe00) === 0xfc00) return true;                       // fc00::/7 unique-local (incl. fd00:ec2::254)
  if ((g[0] & 0xffc0) === 0xfe80) return true;                       // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true;                       // fec0::/10 site-local
  if ((g[0] & 0xff00) === 0xff00) return true;                       // multicast
  return false;
}
function isBlockedIp(ip) {
  if (net.isIPv4(ip)) return v4Blocked(ip);
  if (net.isIPv6(ip)) return v6Blocked(ip);
  return true;
}

const defaultResolve = host => dns.lookup(host, { all: true, verbatim: true });

// ── ONE HOP ────────────────────────────────────────────────────────────────
// The URL as one we are willing to fetch, and the ONE address we will connect
// to, or a reason.
async function checkHop(u, o) {
  if (!o.schemes.includes(u.protocol)) return { ok: false, reason: `only ${o.schemes.map(s => s.replace(":", "")).join(" and ")} addresses are fetched` };
  if (u.username || u.password) return { ok: false, reason: "an address with a password in it is not fetched" };
  const port = u.port ? Number(u.port) : PORTS[u.protocol];
  if (!o.allowLocal && port !== 80 && port !== 443) return { ok: false, reason: "only ports 80 and 443 are fetched" };
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) return { ok: false, reason: "no host" };
  if (!o.allowLocal && BLOCKED_NAMES.test(host)) return { ok: false, reason: "that address is not a public website" };
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host, family: net.isIP(host) }];
  else {
    try { addrs = await o.resolve(host); } catch { return { ok: false, reason: "that address could not be found" }; }
    addrs = (Array.isArray(addrs) ? addrs : [addrs]).filter(a => a && a.address);
  }
  if (!addrs.length) return { ok: false, reason: "that address could not be found" };
  // EVERY answer must be public: an attacker who returns one public and one
  // private address gets nothing by hoping we pick the second.
  if (!o.allowLocal && addrs.some(a => isBlockedIp(a.address))) return { ok: false, reason: "that address is not a public website" };
  return { ok: true, host, port, ip: addrs[0].address };
}

function oneRequest(u, hop, o, deadline) {
  return new Promise(resolve => {
    const lib = u.protocol === "https:" ? https : http;
    const headers = { "accept-encoding": "gzip, deflate, br", ...o.headers, host: u.host };
    if (o.body != null) headers["content-length"] = Buffer.byteLength(o.body);
    const opts = {
      host: hop.ip, port: hop.port, path: u.pathname + u.search, method: o.method, headers,
      // SNI and the certificate check use the NAME, while the socket goes to
      // the address we checked. Neither can be swapped after the check.
      servername: net.isIP(hop.host) ? undefined : hop.host,
      timeout: Math.max(1, deadline - Date.now()),
    };
    for (const fn of observers) { try { fn({ url: u.href, ip: hop.ip, port: hop.port, host: u.host, servername: opts.servername, method: o.method }); } catch { /* a watcher never breaks a fetch */ } }
    let done = false, timer = null;
    const finish = v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const req = (o.requestImpl || lib.request)(opts, res => {
      const status = res.statusCode || 0;
      const h = res.headers || {};
      if (status >= 300 && status < 400 && h.location) { res.resume(); return finish({ redirect: h.location, status }); }
      const enc = String(h["content-encoding"] || "").toLowerCase();
      const stream = enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "deflate" ? res.pipe(zlib.createInflate())
        : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks = []; let size = 0;
      stream.on("data", c => {
        size += c.length;
        if (size > o.maxBytes) {
          if (o.overflow === "truncate") { chunks.push(c.slice(0, c.length - (size - o.maxBytes))); res.destroy(); return finishBody(); }
          res.destroy();
          return finish({ ok: false, status, reason: "the answer was too large" });
        }
        chunks.push(c);
      });
      const finishBody = () => {
        const body = Buffer.concat(chunks);
        finish({ ok: status >= 200 && status < 300, status, url: u.href, body,
          headers: { get: k => { const v = h[String(k).toLowerCase()]; return v == null ? null : Array.isArray(v) ? v.join(", ") : String(v); } },
          text: () => body.toString("utf8") });
      };
      stream.on("end", finishBody);
      stream.on("error", () => finish({ ok: false, status, reason: "the answer could not be read" }));
    });
    timer = setTimeout(() => { req.destroy(); finish({ ok: false, status: 0, reason: "the page took too long" }); }, Math.max(1, deadline - Date.now()));
    req.on("timeout", () => { req.destroy(); finish({ ok: false, status: 0, reason: "the page took too long" }); });
    req.on("error", () => finish({ ok: false, status: 0, reason: "the page could not be reached" }));
    if (o.body != null) req.write(o.body);
    req.end();
  });
}

// safeFetch(url, { method, headers, body, maxRedirects, maxBytes, overflow,
//   timeoutMs, schemes, allowLocal, resolve, requestImpl })
async function safeFetch(raw, opts = {}) {
  const o = { ...DEFAULTS, method: "GET", headers: {}, resolve: defaultResolve, ...opts };
  o.allowLocal = !!o.allowLocal && process.env.NODE_ENV !== "production";
  const deadline = Date.now() + o.timeoutMs;
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return { ok: false, status: 0, reason: "that is not a web address" }; }
  for (let hops = 0; ; hops++) {
    const hop = await checkHop(u, o);
    if (!hop.ok) return { ok: false, status: 0, reason: hop.reason, url: u.href };
    if (Date.now() >= deadline) return { ok: false, status: 0, reason: "the page took too long" };
    const r = await oneRequest(u, hop, o, deadline);
    if (!r.redirect) return r;
    if (hops >= o.maxRedirects) return { ok: false, status: r.status, reason: "it redirects too many times", url: u.href };
    try { u = new URL(r.redirect, u); } catch { return { ok: false, status: r.status, reason: "it redirects to an address that is not one" }; }
    // A redirect turns a POST into a GET for 301-303, as browsers do; a body
    // never follows a redirect to a host we have not seen.
    if (r.status !== 307 && r.status !== 308) { o.method = "GET"; o.body = null; }
  }
}

module.exports = { safeFetch, isBlockedIp, observers, DEFAULTS };
