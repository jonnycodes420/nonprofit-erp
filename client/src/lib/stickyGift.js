// stickyGift.js · QUICKADD-1. "SAME AS LAST".
//
// Six Good Giving Challenge gifts in a row share a date, a campaign, an appeal,
// a fund, a fundraiser and a method. After one gift is saved, the next gift
// form starts from those six, each shown as a "Same as last" chip she can
// clear. Kept for this tab only (sessionStorage), keyed by org, so it never
// follows her into tomorrow or into another organisation's books. Nothing here
// is sent anywhere: the gift form sends what the form shows.
export const STICKY_FIELDS = ["date", "method", "fund", "campaign", "appeal", "page"];

function key() {
  let org = "";
  try { org = (JSON.parse(localStorage.getItem("npe_org") || "{}") || {}).id || ""; } catch { org = ""; }
  return "steward.lastGift.v1:" + org;
}

// { date, method, fund, campaign, appeal, page }, only the ones that were set.
export function lastGift() {
  try {
    const v = JSON.parse(sessionStorage.getItem(key()) || "null");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

export function rememberGift(v) {
  const out = {};
  for (const k of STICKY_FIELDS) {
    const x = v && v[k];
    if (x == null || x === "") continue;
    if (k === "fund" && (x.split || !x.fund_id)) continue;   // a split belongs to one gift, never the next
    out[k] = x;
  }
  try { sessionStorage.setItem(key(), JSON.stringify(out)); } catch { /* private window: nothing carries over */ }
}

// The words a chip says for one carried value.
export function stickyWord(k, v, { fundName = "", dateWord = d => d } = {}) {
  if (v == null || v === "") return "";
  if (k === "date") return dateWord(v);
  if (k === "method") return String(v);
  if (k === "fund") return fundName || "the same fund";
  return (v && v.name) || "";
}
