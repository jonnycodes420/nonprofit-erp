// server/receipts/letterDoc.js · LETTERS-1 item 1. HER OWN LETTER, FROM WORD.
//
// "I have like a current template for my thank you letter. And I tried to copy
// and paste it in, and it just didn't look good... Is there a way to upload it?"
//
// A .docx is read into a LAYOUT: the page (size, margins), the letterhead (the
// Word header), the body and the footer, each a list of blocks. A block is a
// paragraph (alignment, spacing, indent, and runs that keep their font, size,
// colour, bold, italic, underline), a picture (PNG or JPEG, at its size) or a
// simple table (a row of columns, the way most letterheads put a logo beside
// an address). The PDF (letterPdf.js) and the Word file (letterWord.js) are
// drawn from the same layout, so what she previews is what prints.
//
// Three rules:
//   1. NOTHING IS DROPPED SILENTLY. A text box, a shape, a picture in a format
//      the renderer cannot draw, a footnote, a font that prints as its nearest
//      standard face: each is a sentence in `notCarried`.
//   2. A FIELD IS OFFERED, NEVER GUESSED. "[First Name]", "<<FirstName>>" and
//      Word's own «FirstName» merge fields are `candidates` with a suggested
//      Steward field; she confirms each, and only then does the text become
//      {{first_name}}. A {{token}} already in the file is a field as it stands,
//      and an unknown one is refused at save (shared/ackLetter.js).
//   3. THE LAYOUT IS DATA. No HTML and no script is kept; a picture is kept as
//      a PNG or JPEG data URI and nothing else.
//
// mammoth (a free library) reads the same file for its plain text, so text this
// reader did not place is named in `notCarried` rather than lost.
"use strict";

const JSZip = require("jszip");
const { DOMParser } = require("@xmldom/xmldom");

const MAX_DOCX_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const TW = 20;            // twips per point
const EMU = 12700;        // EMU per point

// The PDF renderer's own faces: a Word font prints as the nearest of three.
const SERIF = /times|georgia|garamond|cambria|book antiqua|palatino|baskerville|century|bodoni|didot|serif|minion|caslon|constantia/i;
const MONO = /courier|mono|consolas|menlo/i;
function faceOf(font) {
  const f = String(font || "");
  if (MONO.test(f)) return "Courier";
  if (SERIF.test(f) && !/sans/i.test(f)) return "Times";
  return "Helvetica";
}

// ── merge-field candidates ─────────────────────────────────────────────────
// What a Word letter writes where a name goes, mapped to Steward's field.
const ALIASES = {
  firstname: "first_name", first: "first_name", fname: "first_name", givenname: "first_name",
  lastname: "last_name", last: "last_name", surname: "last_name", lname: "last_name", familyname: "last_name",
  name: "name", fullname: "name", donorname: "name", donor: "name",
  salutation: "salutation", dear: "salutation", greeting: "salutation",
  amount: "gift_amount", giftamount: "gift_amount", donationamount: "gift_amount", gift: "gift_amount", donation: "gift_amount", totalamount: "gift_amount",
  date: "gift_date", giftdate: "gift_date", donationdate: "gift_date", datereceived: "gift_date",
  event: "event_name", eventname: "event_name",
  campaign: "campaign_name", campaignname: "campaign_name",
  deductible: "deductible_amount", deductibleamount: "deductible_amount", taxdeductibleamount: "deductible_amount", taxdeductible: "deductible_amount",
  fund: "fund", fundname: "fund", designation: "fund",
  address: "address_block", addressblock: "address_block", mailingaddress: "address_block",
  today: "today", todaysdate: "today", currentdate: "today", letterdate: "today",
  orgname: "org_name", organization: "org_name", organizationname: "org_name", organisation: "org_name",
  signer: "signer", signature: "signer", yourname: "signer",
  title: "signer_title", signertitle: "signer_title",
  year: "year", taxyear: "year",
  tribute: "tribute", inmemoryof: "tribute", inhonorof: "tribute",
};
const CANDIDATE_RE = /\{\{\s*[a-zA-Z_]+\s*\}\}|\[[A-Za-z][A-Za-z0-9 _'.-]{0,38}\]|<<\s*[A-Za-z][A-Za-z0-9 _'.-]{0,38}\s*>>|«\s*[A-Za-z][A-Za-z0-9 _'.-]{0,38}\s*»/g;
function suggestFor(raw) {
  const inner = String(raw).replace(/^(\[|<<|«)|(\]|>>|»)$/g, "");
  const k = inner.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ALIASES[k] || null;
}

// ── XML helpers ────────────────────────────────────────────────────────────
const kids = (el, local) => {
  const out = [];
  for (let n = el && el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (!local || n.localName === local)) out.push(n);
  return out;
};
const kid = (el, local) => kids(el, local)[0] || null;
const attr = (el, name) => (el ? (el.getAttributeNS(W, name) || el.getAttribute("w:" + name) || el.getAttribute(name) || null) : null);
const descendants = (el, local) => (el ? Array.from(el.getElementsByTagNameNS("*", local)) : []);
const onOff = el => (el ? !/^(0|false|off|none)$/i.test(attr(el, "val") || "1") : undefined);

// ── styles ─────────────────────────────────────────────────────────────────
function readRPr(rPr) {
  if (!rPr) return {};
  const o = {};
  const b = kid(rPr, "b"); if (b) o.bold = onOff(b);
  const i = kid(rPr, "i"); if (i) o.italic = onOff(i);
  const u = kid(rPr, "u"); if (u) o.underline = !/^none$/i.test(attr(u, "val") || "single");
  const sz = kid(rPr, "sz"); if (sz && attr(sz, "val")) o.size = Number(attr(sz, "val")) / 2;
  const c = kid(rPr, "color"); const cv = c && attr(c, "val");
  if (cv && /^[0-9a-f]{6}$/i.test(cv)) o.color = "#" + cv.toUpperCase();
  const f = kid(rPr, "rFonts"); const fv = f && (attr(f, "ascii") || attr(f, "hAnsi") || attr(f, "cs"));
  if (fv) o.font = fv;
  const caps = kid(rPr, "caps"); if (caps && onOff(caps)) o.caps = true;
  return o;
}
function readPPr(pPr) {
  if (!pPr) return {};
  const o = {};
  const jc = kid(pPr, "jc"); const j = jc && attr(jc, "val");
  if (j) o.align = j === "center" ? "center" : (j === "right" || j === "end") ? "right" : (j === "both" || j === "distribute") ? "justify" : "left";
  const sp = kid(pPr, "spacing");
  if (sp) {
    if (attr(sp, "before") != null) o.before = Number(attr(sp, "before")) / TW;
    if (attr(sp, "after") != null) o.after = Number(attr(sp, "after")) / TW;
    const line = attr(sp, "line"), rule = attr(sp, "lineRule");
    if (line != null) o.line = !rule || rule === "auto" ? { mult: Number(line) / 240 } : { exact: Number(line) / TW };
  }
  const ind = kid(pPr, "ind");
  if (ind) {
    const l = attr(ind, "left") ?? attr(ind, "start"), r = attr(ind, "right") ?? attr(ind, "end");
    if (l != null) o.indentLeft = Number(l) / TW;
    if (r != null) o.indentRight = Number(r) / TW;
    if (attr(ind, "firstLine") != null) o.firstLine = Number(attr(ind, "firstLine")) / TW;
    if (attr(ind, "hanging") != null) o.firstLine = -Number(attr(ind, "hanging")) / TW;
  }
  return o;
}
function readStyles(xml) {
  const out = { defaultsP: {}, defaultsR: {}, byId: {} };
  if (!xml) return out;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const dd = descendants(doc, "docDefaults")[0];
  if (dd) {
    out.defaultsR = readRPr(descendants(dd, "rPr")[0]);
    out.defaultsP = readPPr(descendants(dd, "pPr")[0]);
  }
  let normal = null;
  for (const st of descendants(doc, "style")) {
    const id = attr(st, "styleId");
    if (!id) continue;
    const based = kid(st, "basedOn");
    out.byId[id] = { basedOn: based ? attr(based, "val") : null, p: readPPr(kid(st, "pPr")), r: readRPr(kid(st, "rPr")) };
    if (attr(st, "type") === "paragraph" && attr(st, "default") === "1") normal = id;
  }
  out.normal = normal;
  return out;
}
function styleChain(styles, id, depth = 0) {
  const s = id && styles.byId[id];
  if (!s || depth > 8) return { p: {}, r: {} };
  const up = styleChain(styles, s.basedOn, depth + 1);
  return { p: { ...up.p, ...s.p }, r: { ...up.r, ...s.r } };
}

// ── one part (body, header or footer) ─────────────────────────────────────
function makeReader({ zip, rels, styles, notes, candidates, fonts }) {
  const images = new Map();   // rId → data URI (read once)

  async function imageFor(rId, where) {
    if (images.has(rId)) return images.get(rId);
    const target = rels[rId];
    let uri = null;
    if (target) {
      const file = zip.file(target);
      const ext = (target.split(".").pop() || "").toLowerCase();
      if (!file) notes.add(`A picture in the ${where} could not be found in the file.`);
      else if (!["png", "jpg", "jpeg"].includes(ext)) notes.add(`A picture in the ${where} is a ${ext.toUpperCase()} file, which the letter cannot print. Save it as a PNG or JPEG in Word and upload again.`);
      else {
        const b = await file.async("nodebuffer");
        if (b.length > MAX_IMAGE_BYTES) notes.add(`A picture in the ${where} is larger than 1 MB and was left out. Make it smaller in Word and upload again.`);
        else uri = `data:image/${ext === "png" ? "png" : "jpeg"};base64,${b.toString("base64")}`;
      }
    }
    images.set(rId, uri);
    return uri;
  }

  async function drawingImage(el, where) {
    // wp:inline or wp:anchor → extent → a:blip r:embed
    const extent = descendants(el, "extent")[0];
    const blip = descendants(el, "blip")[0];
    const imagedata = descendants(el, "imagedata")[0];
    const rId = blip ? (blip.getAttribute("r:embed") || blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"))
      : imagedata ? (imagedata.getAttribute("r:id") || imagedata.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")) : null;
    if (descendants(el, "txbxContent").length) {
      const t = descendants(el, "t").map(n => n.textContent).join("").trim();
      notes.add(`A text box in the ${where}${t ? ` ("${t.slice(0, 60)}${t.length > 60 ? "…" : ""}")` : ""} did not carry over. Type its words into the letter itself.`);
      return null;
    }
    if (!rId) {
      if (descendants(el, "chart").length) notes.add(`A chart in the ${where} did not carry over.`);
      else notes.add(`A shape or line in the ${where} did not carry over.`);
      return null;
    }
    const uri = await imageFor(rId, where);
    if (!uri) return null;
    let w = 120, h = 60;
    if (extent) { w = Number(extent.getAttribute("cx")) / EMU || w; h = Number(extent.getAttribute("cy")) / EMU || h; }
    else {
      const shape = descendants(el, "shape")[0];
      const st = shape && shape.getAttribute("style") || "";
      const mw = /width:([\d.]+)pt/.exec(st), mh = /height:([\d.]+)pt/.exec(st);
      if (mw) w = Number(mw[1]); if (mh) h = Number(mh[1]);
    }
    if (descendants(el, "anchor").length) notes.add(`A picture that floats beside the text in the ${where} is printed in line with the text instead.`);
    return { type: "image", src: uri, width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10 };
  }

  // Runs of one paragraph, following Word's complex fields: a MERGEFIELD's
  // shown text is replaced by «Name», which is offered as a field.
  async function paragraph(p, where, pStyleBase) {
    const pPr = kid(p, "pPr");
    const own = readPPr(pPr);
    const sid = pPr && kid(pPr, "pStyle") ? attr(kid(pPr, "pStyle"), "val") : styles.normal;
    const chain = styleChain(styles, sid);
    const base = { ...styles.defaultsR, ...chain.r, ...(pStyleBase || {}) };
    const para = { type: "paragraph", ...styles.defaultsP, ...chain.p, ...own, runs: [] };
    const pics = [];
    let field = null;   // { instr, showing }
    const pushText = (text, rPr) => {
      if (!text) return;
      if (field && field.showing) return;   // the field's shown result is replaced by its name
      const r = { ...base, ...readRPr(rPr), text };
      if (r.font) fonts.add(r.font);
      para.runs.push(r);
    };
    const walk = async el => {
      for (const n of kids(el)) {
        const ln = n.localName;
        if (ln === "pPr") continue;
        if (ln === "r") {
          const rPr = kid(n, "rPr");
          for (const c of kids(n)) {
            const cl = c.localName;
            if (cl === "t") pushText(c.textContent, rPr);
            else if (cl === "tab" || cl === "ptab") pushText("\t", rPr);
            else if (cl === "br" || cl === "cr") {
              if ((attr(c, "type") || "") === "page") notes.add(`A page break in the ${where} was left out: each letter prints on one page.`);
              else pushText("\n", rPr);
            } else if (cl === "fldChar") {
              const t = attr(c, "fldCharType");
              if (t === "begin") field = { instr: "", showing: false };
              else if (t === "separate" && field) {
                const m = /MERGEFIELD\s+"?([^\s"\\]+)"?/i.exec(field.instr);
                if (m) { field.showing = false; pushText(`«${m[1]}»`, rPr); field.showing = true; }
                else field.showing = false;
              } else if (t === "end") field = null;
            } else if (cl === "instrText" && field) field.instr += c.textContent;
            else if (cl === "drawing" || cl === "pict" || cl === "object") {
              const img = await drawingImage(c, where); if (img) pics.push(img);
            } else if (cl === "AlternateContent") {
              const choice = kid(c, "Choice");
              if (choice) { const img = await drawingImage(choice, where); if (img) pics.push(img); }
            } else if (cl === "footnoteReference" || cl === "endnoteReference") notes.add(`A footnote in the ${where} did not carry over.`);
            else if (cl === "sym") pushText("•", rPr);
          }
        } else if (ln === "fldSimple") {
          const m = /MERGEFIELD\s+"?([^\s"\\]+)"?/i.exec(attr(n, "instr") || "");
          if (m) pushText(`«${m[1]}»`, kid(descendants(n, "r")[0] || n, "rPr"));
          else await walk(n);
        } else if (ln === "hyperlink" || ln === "smartTag" || ln === "ins" || ln === "sdt" || ln === "sdtContent" || ln === "customXml") {
          await walk(ln === "sdt" ? (kid(n, "sdtContent") || n) : n);
        } else if (ln === "AlternateContent") {
          const choice = kid(n, "Choice"); if (choice) await walk(choice);
        } else if (ln === "pict" || ln === "drawing") {
          const img = await drawingImage(n, where); if (img) pics.push(img);
        }
      }
    };
    await walk(p);
    para.runs = mergeRuns(para.runs);
    for (const r of para.runs) for (const m of r.text.matchAll(CANDIDATE_RE)) {
      const raw = m[0];
      if (!candidates.has(raw)) candidates.set(raw, { raw, token: /^\{\{/.test(raw), suggest: /^\{\{/.test(raw) ? raw.replace(/[{}\s]/g, "") : suggestFor(raw) });
    }
    const out = [];
    for (const img of pics) out.push({ ...img, align: para.align || "left" });
    if (para.runs.length || !pics.length) out.push(para);
    return out;
  }

  async function blocksOf(container, where) {
    const out = [];
    for (const n of kids(container)) {
      if (n.localName === "p") out.push(...await paragraph(n, where));
      else if (n.localName === "tbl") out.push(await table(n, where));
      else if (n.localName === "sdt") out.push(...await blocksOf(kid(n, "sdtContent") || n, where));
    }
    return out;
  }

  async function table(tbl, where) {
    const widths = descendants(kid(tbl, "tblGrid"), "gridCol").map(g => Number(attr(g, "w")) / TW || 0);
    const rows = [];
    for (const tr of kids(tbl, "tr")) {
      const cells = [];
      for (const tc of kids(tr, "tc")) {
        if (descendants(tc, "tbl").length) notes.add(`A table inside a table in the ${where} is printed as plain paragraphs.`);
        const tcPr = kid(tc, "tcPr"); const span = tcPr && kid(tcPr, "gridSpan");
        cells.push({ span: span ? Number(attr(span, "val")) || 1 : 1, blocks: await blocksOf(tc, where) });
      }
      rows.push({ cells });
    }
    const borders = descendants(kid(tbl, "tblPr"), "tblBorders")[0];
    if (borders && kids(borders).some(b => !/^(nil|none)$/i.test(attr(b, "val") || "nil"))) notes.add(`The lines around a table in the ${where} did not carry over; its text and pictures did.`);
    return { type: "table", widths, rows };
  }

  return { blocksOf };
}

// Word splits text into runs wherever it likes ("{{fir" + "st_name}}"). Runs
// that look the same are joined, and a field split across differently-styled
// runs takes the first run's look, so no field is ever lost to a split.
function mergeRuns(runs) {
  const same = (a, b) => ["bold", "italic", "underline", "size", "color", "font", "caps"].every(k => (a[k] || null) === (b[k] || null));
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && same(last, r)) last.text += r.text; else out.push({ ...r });
  }
  // A field split across runs of different looks
  let i = 0;
  while (i < out.length - 1) {
    const text = out[i].text;
    const open = Math.max(text.lastIndexOf("{{"), text.lastIndexOf("["), text.lastIndexOf("<<"), text.lastIndexOf("«"));
    const closeAfter = open >= 0 ? /\}\}|\]|>>|»/.exec(text.slice(open)) : null;
    if (open >= 0 && !closeAfter && /^[^\n]{0,40}?(\}\}|\]|>>|»)/.test(out.slice(i + 1).map(r => r.text).join(""))) {
      out[i].text += out[i + 1].text; out.splice(i + 1, 1); continue;
    }
    i++;
  }
  return out;
}

async function relsOf(zip, part) {
  const dir = part.replace(/[^/]+$/, ""), name = part.split("/").pop();
  const f = zip.file(`${dir}_rels/${name}.rels`);
  const map = {};
  if (!f) return map;
  const doc = new DOMParser().parseFromString(await f.async("string"), "text/xml");
  for (const r of Array.from(doc.getElementsByTagName("Relationship"))) {
    const t = r.getAttribute("Target") || "";
    if (r.getAttribute("TargetMode") === "External") continue;
    map[r.getAttribute("Id")] = t.startsWith("/") ? t.slice(1) : (dir + t).replace(/[^/]+\/\.\.\//g, "");
  }
  return map;
}

// The whole file → { page, header, body, footer, candidates, notCarried, text }.
async function parseDocx(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw Object.assign(new Error("That file is empty."), { status: 400 });
  if (buf.length > MAX_DOCX_BYTES) throw Object.assign(new Error("That file is larger than 4 MB. Make the pictures in it smaller and upload again."), { status: 400 });
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw Object.assign(new Error("That is not a Word (.docx) file. In Word, choose File, Save As, Word Document (.docx)."), { status: 400 }); }
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw Object.assign(new Error("That is not a Word (.docx) file. In Word, choose File, Save As, Word Document (.docx)."), { status: 400 });
  const notes = new Set(), candidates = new Map(), fonts = new Set();
  const stylesXml = zip.file("word/styles.xml") ? await zip.file("word/styles.xml").async("string") : null;
  const styles = readStyles(stylesXml);
  const doc = new DOMParser().parseFromString(await docFile.async("string"), "text/xml");
  const body = descendants(doc, "body")[0];
  const docRels = await relsOf(zip, "word/document.xml");

  // The page: the last section's size and margins.
  const sects = descendants(body, "sectPr");
  if (sects.length > 1) notes.add("The letter has more than one section; it is printed with the first page's layout.");
  const sect = sects[sects.length - 1];
  const pgSz = sect && kid(sect, "pgSz"), pgMar = sect && kid(sect, "pgMar");
  const num = (el, a, d) => (el && attr(el, a) != null ? Number(attr(el, a)) / TW : d);
  const page = {
    width: num(pgSz, "w", 612), height: num(pgSz, "h", 792),
    top: num(pgMar, "top", 72), bottom: num(pgMar, "bottom", 72), left: num(pgMar, "left", 72), right: num(pgMar, "right", 72),
    header: num(pgMar, "header", 36), footer: num(pgMar, "footer", 36),
  };
  if (Math.abs(page.width - 612) > 6 || Math.abs(page.height - 792) > 6) notes.add("The page is not US Letter; it prints on Letter paper with the same margins.");
  page.width = 612; page.height = 792;

  const partOf = async (refName, where) => {
    const refs = sect ? kids(sect, refName) : [];
    const ref = refs.find(r => attr(r, "type") === "first" && sect && kid(sect, "titlePg")) || refs.find(r => (attr(r, "type") || "default") === "default") || refs[0];
    if (!ref) return [];
    const rId = ref.getAttribute("r:id") || ref.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = docRels[rId];
    const f = target && zip.file(target);
    if (!f) return [];
    const x = new DOMParser().parseFromString(await f.async("string"), "text/xml");
    const reader = makeReader({ zip, rels: await relsOf(zip, target), styles, notes, candidates, fonts });
    return reader.blocksOf(x.documentElement, where);
  };

  const reader = makeReader({ zip, rels: docRels, styles, notes, candidates, fonts });
  const layout = {
    page,
    header: await partOf("headerReference", "letterhead"),
    body: await reader.blocksOf(body, "letter"),
    footer: await partOf("footerReference", "footer"),
  };
  // Trailing empty paragraphs in the body add nothing but a second page.
  while (layout.body.length && isEmptyPara(layout.body[layout.body.length - 1])) layout.body.pop();

  const faces = [...fonts].filter(f => faceOf(f) && !/^(times new roman|helvetica|arial|courier new|courier)$/i.test(f));
  if (faces.length) notes.add(`Your ${faces.length === 1 ? "font" : "fonts"} ${faces.join(", ")} ${faces.length === 1 ? "prints" : "print"} as the nearest standard font (${[...new Set(faces.map(faceOf))].join(", ")}). Sizes, colors, bold and italic are kept.`);

  // What mammoth reads that this reader did not place is named, not lost.
  const text = layoutText(layout);
  try {
    const mammoth = require("mammoth");
    const raw = (await mammoth.extractRawText({ buffer: buf })).value || "";
    // A line is lost when most of its words are nowhere in what was placed
    // (mammoth shows a merge field's result, not its name, so whole-line
    // matching would cry wolf on every field).
    const placed = new Set(wordsOf(text + " " + [...candidates.keys()].join(" ") + " " + [...notes].join(" ")));
    const lost = raw.split(/\n+/).map(s => s.trim()).filter(s => {
      const w = wordsOf(s);
      return w.length && w.filter(x => !placed.has(x)).length * 2 > w.length;
    });
    if (lost.length) notes.add(`Some text did not carry over: "${lost.slice(0, 3).map(s => s.slice(0, 60)).join('", "')}"${lost.length > 3 ? ` and ${lost.length - 3} more` : ""}.`);
  } catch { /* a reader that fails costs the check, not the letter */ }

  return { layout, text, candidates: [...candidates.values()], notCarried: [...notes] };
}
const wordsOf = s => (String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const isEmptyPara = b => b && b.type === "paragraph" && !b.runs.some(r => r.text.trim());

// The layout's words, in order: what `body` stores, so the save-time field
// check and the missing-field check read the same tokens the print fills.
function layoutText(layout) {
  const lines = [];
  const walk = blocks => {
    for (const b of blocks || []) {
      if (b.type === "paragraph") lines.push(b.runs.map(r => r.text).join(""));
      else if (b.type === "table") for (const row of b.rows) for (const c of row.cells) walk(c.blocks);
    }
  };
  walk(layout.header); walk(layout.body); walk(layout.footer);
  return lines.join("\n");
}

// Her confirmed choices: "[First Name]" → {{first_name}}; a choice of null
// leaves the text as she wrote it. Applied to every run in every part.
function applyFields(layout, mapping) {
  const pairs = Object.entries(mapping || {}).filter(([raw, key]) => raw && key && /^[a-z_]+$/.test(key));
  const fix = blocks => (blocks || []).map(b => {
    if (b.type === "paragraph") return { ...b, runs: b.runs.map(r => ({ ...r, text: pairs.reduce((t, [raw, key]) => t.split(raw).join(`{{${key}}}`), r.text) })) };
    if (b.type === "table") return { ...b, rows: b.rows.map(row => ({ cells: row.cells.map(c => ({ ...c, blocks: fix(c.blocks) })) })) };
    return b;
  });
  return { ...layout, header: fix(layout.header), body: fix(layout.body), footer: fix(layout.footer) };
}

// Fill every {{token}} in a layout from one letter's fields (empty for a
// field that may be empty; the caller has already left out a letter that is
// missing one that may not).
function fillLayout(layout, fields) {
  const fill = t => String(t).replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, k) => (fields[k] == null ? "" : String(fields[k])));
  const fix = blocks => (blocks || []).map(b => {
    if (b.type === "paragraph") {
      const signer = b.runs.some(r => /\{\{\s*signer\s*\}\}/.test(r.text));
      return { ...b, signer, runs: b.runs.map(r => ({ ...r, text: fill(r.text) })) };
    }
    if (b.type === "table") return { ...b, rows: b.rows.map(row => ({ cells: row.cells.map(c => ({ ...c, blocks: fix(c.blocks) })) })) };
    return b;
  });
  return { ...layout, header: fix(layout.header), body: fix(layout.body), footer: fix(layout.footer) };
}

// A stored layout is checked before it is kept: only the shapes above, and
// pictures only as PNG or JPEG data URIs.
function cleanLayout(l) {
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const str = v => (v == null ? undefined : String(v).slice(0, 4000));
  const run = r => ({ text: String(r.text || "").slice(0, 4000), bold: !!r.bold || undefined, italic: !!r.italic || undefined, underline: !!r.underline || undefined,
    caps: !!r.caps || undefined, size: r.size ? Math.min(96, Math.max(4, num(r.size, 11))) : undefined,
    color: /^#[0-9A-Fa-f]{6}$/.test(r.color || "") ? r.color : undefined, font: r.font ? str(r.font).slice(0, 60) : undefined });
  const block = b => {
    if (!b || typeof b !== "object") return null;
    if (b.type === "image") return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(b.src || "") && b.src.length < MAX_IMAGE_BYTES * 1.4
      ? { type: "image", src: b.src, width: Math.min(612, num(b.width, 100)), height: Math.min(792, num(b.height, 50)), align: ["left", "center", "right"].includes(b.align) ? b.align : "left" } : null;
    if (b.type === "paragraph") return { type: "paragraph", align: ["left", "center", "right", "justify"].includes(b.align) ? b.align : undefined,
      before: b.before != null ? num(b.before, 0) : undefined, after: b.after != null ? num(b.after, 0) : undefined,
      line: b.line && (b.line.mult || b.line.exact) ? (b.line.mult ? { mult: Math.min(4, num(b.line.mult, 1)) } : { exact: Math.min(144, num(b.line.exact, 14)) }) : undefined,
      indentLeft: b.indentLeft != null ? num(b.indentLeft, 0) : undefined, indentRight: b.indentRight != null ? num(b.indentRight, 0) : undefined,
      firstLine: b.firstLine != null ? num(b.firstLine, 0) : undefined, runs: (Array.isArray(b.runs) ? b.runs : []).slice(0, 400).map(run) };
    if (b.type === "table") return { type: "table", widths: (Array.isArray(b.widths) ? b.widths : []).slice(0, 12).map(w => num(w, 0)),
      rows: (Array.isArray(b.rows) ? b.rows : []).slice(0, 40).map(row => ({ cells: (Array.isArray(row.cells) ? row.cells : []).slice(0, 12)
        .map(c => ({ span: Math.max(1, Math.min(12, num(c.span, 1))), blocks: blocks(c.blocks) })) })) };
    return null;
  };
  const blocks = list => (Array.isArray(list) ? list : []).slice(0, 400).map(block).filter(Boolean);
  const p = l && l.page || {};
  return { page: { width: 612, height: 792, top: num(p.top, 72), bottom: num(p.bottom, 72), left: num(p.left, 72), right: num(p.right, 72), header: num(p.header, 36), footer: num(p.footer, 36) },
    header: blocks(l && l.header), body: blocks(l && l.body), footer: blocks(l && l.footer) };
}

// A save from the upload screen: { layout, fields: { "[First Name]": "first_name" },
// sourceName, notCarried }. The layout is cleaned, her confirmed fields are
// applied, and the words are read back off the layout.
function fromRequest(b) {
  if (!b || !b.layout) return {};
  if (typeof b.layout !== "object") return { error: "That letter layout could not be read. Upload the Word file again." };
  const layout = applyFields(cleanLayout(b.layout), b.fields && typeof b.fields === "object" ? b.fields : {});
  if (!layout.body.length) return { error: "That letter has nothing in it. Upload the Word file again." };
  return { layout, body: layoutText(layout), sourceName: String(b.sourceName || "").slice(0, 200) || null,
    notCarried: Array.isArray(b.notCarried) ? b.notCarried.slice(0, 30).map(x => String(x).slice(0, 400)) : null };
}

module.exports = { fromRequest, parseDocx, applyFields, fillLayout, layoutText, cleanLayout, faceOf, suggestFor, mergeRuns, MAX_DOCX_BYTES };
