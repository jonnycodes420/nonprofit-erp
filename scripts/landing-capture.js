#!/usr/bin/env node
// Landing-page product image capture (BUILD-08 Phase A).
//
// Recaptures every product image on Landing.jsx from the REAL deployed
// product, tightly cropped to the meaningful region so UI text stays near
// native size when displayed (the BUILD-07 captures were full-app 1440px
// shots displayed at ~535px — text at ~37% scale read soft). Encodes WebP
// q92 at 1x + 2x, and prints a manifest (docs/landing-capture-manifest.json)
// with each asset's display dimensions plus the re-measured goal-bar overlay
// geometry for Landing.jsx's hero animation.
//
// macOS-only for the receipt image: the /receipts/preview PDF is rasterized
// with `sips` (built into macOS), then trimmed to its content with sharp —
// the raw render is a letter page with a huge empty bottom half.
//
// Usage:
//   PLAYWRIGHT_DIR=/scratch/with/playwright+sharp node scripts/landing-capture.js
// Env: BASE (default https://www.stewardapp.dev), API, EMAIL, PASSWORD,
//      PLAYWRIGHT_DIR (node_modules containing playwright AND sharp —
//      neither is a project dep, install both in a scratch dir).

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");
const sharp = require("sharp");

const BASE = process.env.BASE || "https://www.stewardapp.dev";
const API = process.env.API || "https://nonprofit-erp-production.up.railway.app";
const EMAIL = process.env.EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.PASSWORD || "demo1234";
const PUB = path.join(__dirname, "..", "client", "public");
const SCRATCH = process.env.SCRATCH || fs.mkdtempSync(path.join(require("os").tmpdir(), "lpcap-"));
const manifest = { capturedAt: new Date().toISOString(), base: BASE, images: {} };

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  return r.json();
}

async function appPage(browser, session, { w, h, dsf }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk);
    localStorage.setItem("npe_user", JSON.stringify(u));
    localStorage.setItem("npe_org", JSON.stringify(o));
  }, [session.token, session.user, session.org]);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  return { ctx, page };
}

// Document-relative bounding box (fullPage screenshots start at doc top).
const bbox = (page, fn) => page.evaluate((fnSrc) => {
  const el = (0, eval)(`(${fnSrc})`)();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
}, fn.toString());

// Crop a region (css px) out of a fullPage capture taken at `dsf`, then write
// 2x + 1x WebP. The 2x asset keeps the crop at (up to) 2 device px per css px;
// 1x is half that. Display size (returned) = crop css size.
async function emit(pngPath, crop, dsf, name) {
  const img = sharp(pngPath).extract({
    left: Math.round(crop.x * dsf), top: Math.round(crop.y * dsf),
    width: Math.round(crop.w * dsf), height: Math.round(crop.h * dsf),
  });
  const buf = await img.png().toBuffer();
  const w2 = Math.round(crop.w * 2), w1 = Math.round(crop.w);
  await sharp(buf).resize({ width: w2, withoutEnlargement: true }).webp({ quality: 92 }).toFile(path.join(PUB, `${name}-2x.webp`));
  await sharp(buf).resize({ width: w1 }).webp({ quality: 92 }).toFile(path.join(PUB, `${name}.webp`));
  const meta1 = await sharp(path.join(PUB, `${name}.webp`)).metadata();
  manifest.images[name] = { displayW: meta1.width, displayH: meta1.height };
  console.log(`  ✓ ${name}: display ${meta1.width}×${meta1.height} (1x + 2x written)`);
}

(async () => {
  const session = await login();
  console.log(`Logged in as ${EMAIL}`);
  const browser = await chromium.launch();

  // ── 1. Hero (lp-home): goal banner → retention card, narrow viewport so the
  //       crop width ≈ the hero column's display width (near-native text). ──
  {
    const { ctx, page } = await appPage(browser, session, { w: 880, h: 1400, dsf: 3 });
    const shot = path.join(SCRATCH, "hero.png");
    await page.screenshot({ path: shot, fullPage: true });
    const banner = await bbox(page, () => document.querySelector(".dash-goal-banner"));
    // Retention card: the white card containing the "Donor Retention Rate" label.
    const retention = await bbox(page, () => {
      const label = [...document.querySelectorAll("div")].find(d => d.childElementCount === 0 && d.textContent.trim() === "Donor Retention Rate");
      if (!label) return null;
      let n = label;
      while (n && getComputedStyle(n).borderRadius !== "16px") n = n.parentElement;
      return n;
    });
    if (!banner) throw new Error("goal banner not found");
    // End the hero above the First-Touch Delay section — the hero's story is
    // "goal + retention noticed", not the whole metrics card.
    const ftd = await bbox(page, () => [...document.querySelectorAll("div")].find(d => d.childElementCount === 0 && d.textContent.trim() === "First-Touch Delay"));
    const pad = 14;
    let bottom = retention ? retention.y + retention.h : banner.y + banner.h;
    if (ftd && ftd.y > banner.y) bottom = Math.min(bottom, ftd.y - 26);
    const crop = { x: banner.x - pad, y: banner.y - pad, w: banner.w + pad * 2, h: bottom - banner.y + pad * 2 };
    await emit(shot, crop, 3, "lp-home");

    // Goal-bar geometry for the hero animation overlay, relative to the crop.
    const geo = await page.evaluate(() => {
      const banner = document.querySelector(".dash-goal-banner");
      const track = [...banner.querySelectorAll("div")].find(d => d.offsetHeight === 11 && getComputedStyle(d).borderRadius === "99px" && d.children.length === 1);
      if (!track) return null;
      const fill = track.children[0];
      const t = track.getBoundingClientRect(), f = fill.getBoundingClientRect();
      const pctText = [...banner.querySelectorAll("div")].map(d => d.textContent.trim()).find(s => /^\d+%$/.test(s));
      return { track: { x: t.x + scrollX, y: t.y + scrollY, w: t.width, h: t.height }, fillW: f.width, percent: pctText };
    });
    if (geo) {
      manifest.goalOverlay = {
        left: (((geo.track.x - crop.x) / crop.w) * 100).toFixed(3) + "%",
        top: (((geo.track.y - crop.y) / crop.h) * 100).toFixed(3) + "%",
        width: ((geo.fillW / crop.w) * 100).toFixed(3) + "%",
        height: ((geo.track.h / crop.h) * 100).toFixed(3) + "%",
        truePercent: geo.percent,
      };
      console.log("  goal overlay:", JSON.stringify(manifest.goalOverlay));
    } else console.log("  ⚠ goal bar not found — overlay geometry NOT updated");

    // Step 3 image (lp-climb): the goal-progress region — the number visibly
    // climbing. (The demo org's retention report currently trends down and it
    // has no recurring-recovery data, so those would undercut the step's
    // line; the goal bar is the honest "watch it climb" visual available.)
    const climb = await page.evaluate(() => {
      const banner = document.querySelector(".dash-goal-banner");
      const pct = [...banner.querySelectorAll("div")].find(d => d.childElementCount === 0 && /^\d+%$/.test(d.textContent.trim()));
      const track = [...banner.querySelectorAll("div")].find(d => d.offsetHeight === 11 && getComputedStyle(d).borderRadius === "99px");
      if (!pct || !track) return null;
      const p = pct.getBoundingClientRect(), t = track.getBoundingClientRect();
      return { x: t.x + scrollX - 2, y: p.y + scrollY - 6, w: t.width + 4, h: (t.y + t.height + 36) - p.y + 6 };
    });
    if (climb) await emit(shot, climb, 3, "lp-climb");
    else console.log("  ⚠ goal-progress region not found");
    await ctx.close();
  }

  // ── 2. Queue (lp-queue) + step crops, at a wider viewport where the queue
  //       column ≈ its display width in the moment section. ──
  {
    const { ctx, page } = await appPage(browser, session, { w: 1240, h: 1400, dsf: 2 });
    const shot = path.join(SCRATCH, "main.png");
    await page.screenshot({ path: shot, fullPage: true });

    const qCard = await bbox(page, () => document.querySelector(".dash-main-grid > div:first-child > div:first-child"));
    if (!qCard) throw new Error("queue card not found");
    const rows = await page.evaluate(() => [...document.querySelectorAll(".dash-queue-row")].map(el => {
      const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    }));
    // Full queue card, capped after ~6 rows so the crop stays tight.
    const capBottom = rows[5] ? rows[5].y + rows[5].h : qCard.y + qCard.h;
    await emit(shot, { x: qCard.x - 10, y: qCard.y - 10, w: qCard.w + 20, h: Math.min(qCard.y + qCard.h, capBottom) - qCard.y + 20 }, 2, "lp-queue");

    // Step 2 image: three queue rows, no header — "see who needs attention".
    if (rows.length >= 3) {
      const top = rows[0].y, bot = rows[2].y + rows[2].h;
      await emit(shot, { x: qCard.x, y: top - 4, w: qCard.w, h: bot - top + 8 }, 2, "lp-attention");
    }

    // Step 1 image: the real CSV import modal (Donors → ↑ Import).
    await page.click('.app-sidebar button:has-text("Donors")');
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(900);
    await page.click('button:has-text("↑ Import")');
    await page.waitForTimeout(700);
    const modal = await bbox(page, () => document.querySelector(".modal-sheet-inner"));
    if (modal) {
      const shot2 = path.join(SCRATCH, "import.png");
      await page.screenshot({ path: shot2, fullPage: true });
      // Upper portion only: title + dropzone reads as "import"; the footer's
      // empty result table doesn't.
      await emit(shot2, { x: modal.x, y: modal.y, w: modal.w, h: Math.min(modal.h, 430) }, 2, "lp-import");
    } else console.log("  ⚠ import modal not found");
    await ctx.close();
  }

  // ── 3. Receipt (lp-receipt): real /receipts/preview PDF → sips → trim. ──
  {
    const r = await fetch(`${API}/receipts/preview`, { headers: { Authorization: `Bearer ${session.token}` } });
    if (!r.ok) throw new Error(`receipts/preview failed: ${r.status}`);
    const pdfPath = path.join(SCRATCH, "receipt.pdf");
    fs.writeFileSync(pdfPath, Buffer.from(await r.arrayBuffer()));
    const pngPath = path.join(SCRATCH, "receipt.png");
    execFileSync("sips", ["-s", "format", "png", "--resampleWidth", "2400", pdfPath, "--out", pngPath], { stdio: "pipe" });
    // The raw render is a full letter page whose meaningful content sits in
    // the top ~third, with the legal footer pinned to the very bottom — a
    // plain trim keeps the empty middle. Scan rows for ink and cut at the
    // first big white gap after the content block, dropping the footer.
    // sips renders the PDF with a TRANSPARENT background — flatten to white
    // first or every row reads as ink and trim() finds nothing to keep.
    const flatPng = await sharp(pngPath).flatten({ background: "#ffffff" }).png().toBuffer();
    const raw = await sharp(flatPng).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { width: rw, height: rh } = raw.info;
    const rowHasInk = (y) => { for (let x = 0; x < rw; x += 3) if (raw.data[y * rw + x] < 235) return true; return false; };
    let contentEnd = rh, seenInk = false, gap = 0;
    for (let y = 0; y < rh; y++) {
      if (rowHasInk(y)) { seenInk = true; gap = 0; contentEnd = y; }
      else if (seenInk && ++gap > Math.round(rh * 0.12)) break;
    }
    const cut = Math.min(rh, contentEnd + Math.round(rh * 0.02));
    const trimmed = await sharp(flatPng).extract({ left: 0, top: 0, width: rw, height: cut }).trim({ threshold: 8 }).toBuffer();
    const m = await sharp(trimmed).metadata();
    const border = Math.round(m.width * 0.045);
    const padded = await sharp(trimmed).extend({ top: border, bottom: border, left: border, right: border, background: "#ffffff" }).toBuffer();
    const mp = await sharp(padded).metadata();
    const w1 = Math.round(mp.width / 4); // sips render ≈4x the display size
    await sharp(padded).resize({ width: w1 * 2 }).webp({ quality: 92 }).toFile(path.join(PUB, "lp-receipt-2x.webp"));
    await sharp(padded).resize({ width: w1 }).webp({ quality: 92 }).toFile(path.join(PUB, "lp-receipt.webp"));
    const meta1 = await sharp(path.join(PUB, "lp-receipt.webp")).metadata();
    manifest.images["lp-receipt"] = { displayW: meta1.width, displayH: meta1.height };
    console.log(`  ✓ lp-receipt: display ${meta1.width}×${meta1.height} (trimmed to content)`);
  }

  await browser.close();
  const out = path.join(__dirname, "..", "docs", "landing-capture-manifest.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest → ${out}`);
})().catch(e => { console.error(e); process.exit(1); });
