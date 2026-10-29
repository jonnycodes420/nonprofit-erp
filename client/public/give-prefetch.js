// give-prefetch.js — HARDEN-2 item 1, moved out of give.html by SECURE-2 item 5
// (the app's Content-Security-Policy runs no inline script). The giving page's
// payload is asked for here, while the page's own script downloads, instead of
// after it has run; Donate.jsx takes it from window.__givePrefetch
// (src/lib/givePrefetch.js) by its URL. The API base is the data-api attribute
// Vite fills from VITE_API_URL.
(function () {
  try {
    var me = document.currentScript;
    var api = (me && me.getAttribute("data-api")) || "";
    if (!/^https?:\/\//.test(api)) api = "https://nonprofit-erp-production.up.railway.app";
    var seg = location.pathname.replace(/\/+$/, "").split("/").slice(2);
    if (!seg[0] || seg.length > 3) return;
    var url = api + "/org/" + seg[0] + (seg[2] ? "/giving-page/" + seg[1] + "/fundraiser/" + seg[2] + "/public"
      : seg[1] ? "/giving-page/" + seg[1] + "/public" : "/public");
    var m = /(?:^|; )steward_give_ab=([ab])(?:;|$)/.exec(document.cookie);
    if (m) url += "?v=" + m[1];
    var box = window.__givePrefetch = {};
    var ask = function (u) {
      box[u] = fetch(u).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }, function () { return { ok: false, data: null }; }); });
      box[u].catch(function () {});
    };
    ask(url);
    if (!seg[1] && /[?&]memberships(=|&|$)/.test(location.search)) ask(api + "/org/" + seg[0] + "/memberships/public");
  } catch (e) { /* Donate.jsx asks for the payload itself */ }
})();
