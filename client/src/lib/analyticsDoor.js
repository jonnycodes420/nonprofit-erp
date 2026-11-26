// lib/analyticsDoor.js · ANALYTICS-1. The few bytes of analytics every page
// carries: a queue. Screens call track() and main.jsx the rest; lib/analytics.js
// (the filters, the config, posthog-js) is fetched only on the production site,
// after load, so Home's first look carries neither.
let mod, off, started;
const q = [];
const call = (n, a) => { if (off) return; if (!mod) return void (q.length < 200 && q.push([n, a])); try { mod[n](...a); } catch { /* never breaks a page */ } };
export const track = (...a) => call("track", a);
export const identifyFrom = (...a) => call("identifyFrom", a);
export const forget = () => call("forget", []);
export function start() {
  if (started) return; started = 1;
  if (!/^(www\.)?stewardapp\.dev$/.test(location.hostname) || navigator.webdriver) return void (off = 1, q.length = 0);
  import("./analytics").then(m => { m.start(); mod = m; for (const [n, a] of q.splice(0)) call(n, a); }, () => { off = 1; q.length = 0; });
}
