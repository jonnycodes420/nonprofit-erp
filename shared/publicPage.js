// shared/publicPage.js — EVENTS-1. THE ONE PUBLIC SURFACE, RENDERED ONCE.
//
// VOL-1 built this shell for the volunteer sign-up page: the org's own band
// colour and logo, a cream card stack, 16px inputs so a phone does not zoom,
// and 48px buttons because it is used standing up. EVENTS-1 needs exactly the
// same shell for a registration page, and a second copy of it is how two
// public surfaces end up wearing different versions of the same brand.
//
// So it lives here, both callers import it, and `footer` is the only thing
// that differs between them.
//
// Pure: no DB, no network, no clock. It renders a string.

const escapeHtml = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function publicPage({ title, brand, body, wide = false, footer = "Steward." }) {
  const logo = brand.logoDataUri || brand.logoAbsUrl;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f0ede6;color:#0f1a12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5}
  .band{background:${brand.band};color:${brand.bandFg};padding:18px 16px;display:flex;align-items:center;gap:12px}
  .band img{height:34px;width:auto;display:block}
  .band .nm{font-size:17px;font-weight:700;letter-spacing:-0.01em}
  .wrap{max-width:${wide ? 720 : 560}px;margin:0 auto;padding:20px 16px 56px}
  .card{background:#fff;border:1px solid #e8e4db;border-radius:14px;padding:18px 16px;margin:0 0 14px}
  h1{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:27px;line-height:1.15;margin:0 0 8px;letter-spacing:-0.01em}
  h2{font-size:18px;font-weight:700;margin:0 0 4px}
  p{margin:0 0 10px}
  .muted{color:#5a554f;font-size:14px}
  .small{font-size:13px;color:#5a554f}
  label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}
  input,textarea,select{width:100%;border:1px solid #d4cfc6;border-radius:9px;padding:12px;font-size:16px;font-family:inherit;background:#fff;color:#0f1a12;min-height:46px}
  textarea{min-height:88px}
  .btn{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:48px;background:${brand.band};color:${brand.bandFg};border:none;border-radius:10px;padding:13px 18px;font-size:16px;font-weight:700;cursor:pointer;text-decoration:none;font-family:inherit;margin-top:14px}
  .btn.quiet{background:transparent;color:#0f1a12;border:1.5px solid #0f1a12}
  .btn.small{width:auto;min-height:40px;padding:9px 14px;font-size:14px;margin-top:0}
  .pill{display:inline-block;font-size:12px;font-weight:700;border-radius:99px;padding:3px 10px}
  .pill.open{background:#edf3ee;color:#0d5c3a}
  .pill.full{background:#f6eccf;color:#5c4710}
  .pill.shut{background:#e8e4db;color:#5a554f}
  .row{display:flex;gap:10px;align-items:baseline;justify-content:space-between;flex-wrap:wrap}
  .foot{text-align:center;font-size:12px;color:#5a554f;padding:8px 16px 32px}
  .err{background:#f6ece8;border:1px solid #e0a893;border-radius:9px;padding:11px 13px;font-size:14px;margin:0 0 12px}
  .ok{background:#edf3ee;border:1px solid #cfe8dc;border-radius:9px;padding:11px 13px;font-size:14px;margin:0 0 12px}
  .hp{position:absolute;left:-9999px}
</style></head>
<body>
<div class="band">${logo ? `<img src="${escapeHtml(logo)}" alt="">` : ""}<span class="nm">${escapeHtml(brand.displayName || "")}</span></div>
<div class="wrap">${body}</div>
<div class="foot">${escapeHtml(footer)}</div>
</body></html>`;
}


export { escapeHtml };
