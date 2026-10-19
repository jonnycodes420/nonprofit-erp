// tests/fix43-safe-fetch.test.js · FIX-43 Part 1. THE ONE SAFE FETCH.
//
// Security: every address a person typed (a website in setup, a logo on their
// page, a spreadsheet photo, a webhook endpoint) is fetched by safeFetch.js.
// This suite drives it with a stand-in resolver and a stand-in network, so it
// never touches the real internet:
//   * DNS rebinding: a resolver that answers public, then private, must never
//     put a socket on the private address, and the fetch fails;
//   * an answer that mixes a public and a private address is refused;
//   * a redirect to a private address (by name or literal) fails, and so does
//     a fourth redirect; every hop is resolved and checked;
//   * http/https on 80/443 only; the body is capped; a slow answer times out;
//   * a normal public page still works, and on a real socket the connection
//     goes to the resolved address with the original Host header and SNI.
//   * every caller is on it: setupSite, the logo, the photo queue, webhooks.
//
// Planted defects that turned this red: oneRequest connecting to the NAME with
// a lookup that asks the resolver again ("rebinding"); checkHop skipped on
// redirect hops ("redirect to private"); `addrs.some` narrowed to addrs[0]
// ("mixed answer"); server.js photo queue back on bare fetch ("callers").
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { Readable } = require("stream");
const SF = require("../safeFetch");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " : " + JSON.stringify(extra).slice(0, 400) : "")); }
}

// THE STAND-IN NETWORK. Each IP serves what is in NET; any other IP refuses.
// Every connect is recorded, so a test can say which address a socket reached.
const CONNECTS = [];
let NET = {};
function requestImpl(opts, cb) {
  const req = new EventEmitter();
  req.write = () => {}; req.destroy = () => {};
  // Like a real socket: a NAME is looked up through opts.lookup at connect
  // time, an IP is connected to as given.
  const connect = go => (require("net").isIP(opts.host) || !opts.lookup ? go(opts.host)
    : opts.lookup(opts.host, {}, (e, ip) => e ? req.emit("error", e) : go(ip)));
  req.end = () => setImmediate(() => connect(ip => {
    CONNECTS.push({ ip, port: opts.port, host: opts.headers.host, servername: opts.servername, method: opts.method });
    const route = NET[ip];
    if (!route) return req.emit("error", new Error("ECONNREFUSED"));
    const a = typeof route === "function" ? route(opts) : route;
    if (a.hang) return;
    const res = Readable.from([Buffer.from(a.body || "")]);
    res.statusCode = a.status || 200; res.headers = a.headers || { "content-type": "text/html" };
    cb(res);
  }));
  return req;
}
// A resolver that answers from a script of answers, one per call.
function resolver(map) {
  const calls = {};
  const fn = async host => {
    calls[host] = (calls[host] || 0) + 1;
    const a = map[host];
    if (!a) throw new Error("ENOTFOUND");
    const list = Array.isArray(a[0]) ? a[Math.min(calls[host], a.length) - 1] : a;
    return list.map(address => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  fn.calls = calls;
  return fn;
}
const PUB = "93.184.216.34", PUB2 = "151.101.1.67", PRIV = "10.0.0.5", META = "169.254.169.254";
const SECRET = { body: "the metadata secret", headers: { "content-type": "text/plain" } };

(async () => {
  console.log("\n§1 DNS rebinding");
  {
    CONNECTS.length = 0;
    NET = { [PRIV]: SECRET };                     // the public answer serves nothing; the private one holds the secret
    const resolve = resolver({ "rebind.example": [[PUB], [PRIV]] });
    const r = await SF.safeFetch("https://rebind.example/", { resolve, requestImpl, timeoutMs: 2000 });
    ok("§1 a resolver that answers public then private fails the fetch", r.ok === false, r);
    ok("§1 no socket ever reached the private address", !CONNECTS.some(c => c.ip === PRIV), CONNECTS);
    ok("§1 the name was resolved exactly once, and the socket went to that answer", resolve.calls["rebind.example"] === 1 && CONNECTS.length === 1 && CONNECTS[0].ip === PUB, { calls: resolve.calls, CONNECTS });
    ok("§1 the connection carries the original Host and SNI", CONNECTS[0] && CONNECTS[0].host === "rebind.example" && CONNECTS[0].servername === "rebind.example", CONNECTS[0]);
  }
  {
    CONNECTS.length = 0;
    NET = { [PUB]: { body: "ok" }, [PRIV]: SECRET };
    const r = await SF.safeFetch("https://mixed.example/", { resolve: resolver({ "mixed.example": [PUB, PRIV] }), requestImpl });
    ok("§1 an answer with one public and one private address is refused before any socket", r.ok === false && CONNECTS.length === 0, { r, CONNECTS });
  }
  {
    const literals = ["http://127.0.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:a9fe:a9fe]/", "http://169.254.169.254/latest/meta-data/",
      "http://[fd00:ec2::254]/", "http://2130706433/", "http://0x7f.1/", "http://[fe80::1]/", "http://100.100.100.200/", "http://0.0.0.0/", "http://[64:ff9b::a9fe:a9fe]/"];
    CONNECTS.length = 0;
    const results = [];
    for (const u of literals) results.push(await SF.safeFetch(u, { resolve: resolver({}), requestImpl }));
    ok("§1 private, loopback, link-local, metadata and mapped literals are all refused, no socket", results.every(r => r.ok === false) && CONNECTS.length === 0, results.map((r, i) => [literals[i], r.ok]));
    const names = ["http://localhost/", "http://metadata.google.internal/", "http://box.local/"];
    const nr = [];
    for (const u of names) nr.push(await SF.safeFetch(u, { resolve: resolver({ localhost: [PUB], "metadata.google.internal": [PUB], "box.local": [PUB] }), requestImpl }));
    ok("§1 internal names are refused even when they resolve public", nr.every(r => r.ok === false) && CONNECTS.length === 0, nr);
  }

  console.log("\n§2 redirects, every hop checked");
  {
    CONNECTS.length = 0;
    NET = { [PUB]: { status: 302, headers: { location: "http://inside.example/latest/" } }, [PRIV]: SECRET };
    const resolve = resolver({ "outside.example": [PUB], "inside.example": [PRIV] });
    const r = await SF.safeFetch("http://outside.example/", { resolve, requestImpl });
    ok("§2 a redirect to a name that resolves private fails", r.ok === false && !CONNECTS.some(c => c.ip === PRIV), { r, CONNECTS });
    ok("§2 the redirect hop was resolved and checked", resolve.calls["inside.example"] === 1, resolve.calls);
  }
  {
    CONNECTS.length = 0;
    NET = { [PUB]: { status: 301, headers: { location: `http://${META}/latest/meta-data/` } }, [META]: SECRET };
    const r = await SF.safeFetch("http://outside.example/", { resolve: resolver({ "outside.example": [PUB] }), requestImpl });
    ok("§2 a redirect to the metadata address fails", r.ok === false && !CONNECTS.some(c => c.ip === META), { r, CONNECTS });
  }
  {
    CONNECTS.length = 0;
    NET = { [PUB]: o => { const n = Number((o.path.match(/\d+/) || [0])[0]); return { status: 302, headers: { location: `/hop${n + 1}` } }; } };
    const r = await SF.safeFetch("https://loop.example/hop0", { resolve: resolver({ "loop.example": [PUB] }), requestImpl });
    ok("§2 at most three redirects are followed", r.ok === false && /too many/.test(r.reason) && CONNECTS.length === 4, { r, n: CONNECTS.length });
  }
  {
    CONNECTS.length = 0;
    NET = { [PUB]: { status: 301, headers: { location: "https://www.good.example/" } }, [PUB2]: { body: "<title>Good</title>" } };
    const r = await SF.safeFetch("https://good.example/", { resolve: resolver({ "good.example": [PUB], "www.good.example": [PUB2] }), requestImpl });
    ok("§2 a redirect to another public host is followed and lands", r.ok === true && r.url === "https://www.good.example/" && r.text().includes("Good"), r);
  }

  console.log("\n§3 schemes, ports, size and time");
  {
    CONNECTS.length = 0;
    NET = { [PUB]: { body: "x" } };
    const resolve = resolver({ "good.example": [PUB] });
    const bad = await Promise.all(["ftp://good.example/", "file:///etc/passwd", "https://good.example:8443/", "http://good.example:22/", "gopher://good.example/", "https://user:pw@good.example/"]
      .map(u => SF.safeFetch(u, { resolve, requestImpl })));
    ok("§3 only http and https on ports 80 and 443, never credentials", bad.every(r => r.ok === false) && CONNECTS.length === 0, bad.map(r => r.reason));
    NET = { [PUB]: { body: "y".repeat(5000) } };
    const big = await SF.safeFetch("https://good.example/", { resolve, requestImpl, maxBytes: 1000 });
    const cut = await SF.safeFetch("https://good.example/", { resolve, requestImpl, maxBytes: 1000, overflow: "truncate" });
    ok("§3 a body over the cap is refused, or cut at the cap when asked", big.ok === false && /too large/.test(big.reason) && cut.ok === true && cut.body.length === 1000, { big, cut: cut.body && cut.body.length });
    NET = { [PUB]: { hang: true } };
    const t0 = Date.now();
    const slow = await SF.safeFetch("https://good.example/", { resolve, requestImpl, timeoutMs: 300 });
    ok("§3 an answer that never comes times out", slow.ok === false && /too long/.test(slow.reason) && Date.now() - t0 < 2000, slow);
    const https1 = await SF.safeFetch("http://good.example/", { resolve, requestImpl, schemes: ["https:"] });
    ok("§3 a caller that asks for https only gets https only", https1.ok === false, https1);
  }

  console.log("\n§4 a normal public page still works");
  {
    CONNECTS.length = 0;
    NET = { [PUB]: { body: "<html><title>Riverbend</title></html>", headers: { "content-type": "text/html; charset=utf-8" } } };
    const r = await SF.safeFetch("https://riverbend.example/about", { resolve: resolver({ "riverbend.example": [PUB] }), requestImpl });
    ok("§4 a public page answers 200 with its body and headers", r.ok === true && r.status === 200 && r.text().includes("Riverbend") && /text\/html/.test(r.headers.get("content-type")), r);
    ok("§4 the path and Host went through unchanged", CONNECTS[0] && CONNECTS[0].ip === PUB && CONNECTS[0].host === "riverbend.example", CONNECTS[0]);
  }
  {
    // A real socket: the resolver says site.test is 127.0.0.1 (the local seam
    // is on, as setup's suite runs it). The server sees the ORIGINAL Host, so
    // the socket went to the address while the request kept the name.
    let seenHost = null;
    const srv = http.createServer((req, res) => { seenHost = req.headers.host; res.writeHead(200, { "content-type": "text/plain" }); res.end("real socket"); });
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    const r = await SF.safeFetch(`http://site.test:${port}/`, { resolve: resolver({ "site.test": ["127.0.0.1"] }), allowLocal: true });
    ok("§4 on a real socket the connection reaches the resolved address with the original Host", r.ok === true && r.text() === "real socket" && seenHost === `site.test:${port}`, { r: r.reason, seenHost });
    const off = await SF.safeFetch(`http://site.test:${port}/`, { resolve: resolver({ "site.test": ["127.0.0.1"] }) });
    ok("§4 without the local seam the same address is refused", off.ok === false, off);
    srv.close();
  }

  console.log("\n§5 every place Steward fetches a typed address is on it");
  {
    const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    const site = read("setupSite.js"), setup = read("setup.js"), server = read("server.js");
    const fn = (src, name) => { const i = src.indexOf(`async function ${name}(`); return i < 0 ? "" : src.slice(i, src.indexOf("\n}\n", i)); };
    const callers = {
      "setupSite fetchText": fn(site, "fetchText"),
      "setup fetchLogo": fn(setup, "fetchLogo"),
      "photo queue fetchRemoteImage": fn(server, "fetchRemoteImage"),
      "webhook deliveries": fn(server, "deliverDueWebhooks") || (() => { const i = server.indexOf("FROM webhook_deliveries d JOIN webhook_endpoints e"); return server.slice(i, i + 2500); })(),
    };
    const off = Object.entries(callers).filter(([, src]) => !src || !/safeFetch\(/.test(src) || /[^.\w]fetch\(/.test(src.replace(/safeFetch\(/g, "")));
    ok("§5 setup's pages, the logo, the photo queue and webhook deliveries all use safeFetch and no bare fetch", off.length === 0, off.map(([k]) => k));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
