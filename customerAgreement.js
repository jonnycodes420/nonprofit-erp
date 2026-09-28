// customerAgreement.js — GTM-1a 5 · THE WORDS SOMEBODY AGREED TO.
//
// The click-through at signup serves THIS document, and the acceptance row
// stores the version AND the sha256 of the exact bytes that were served. A
// year from now, after the agreement has been edited twice, the question "what
// did she actually agree to?" has an answer that does not depend on anybody's
// memory of what the page said.
//
// WHERE THE FILE LIVES. `legal/customer-agreement.md`, not `claude/`, because
// `.railwayignore` excludes `claude/` and `docs/` from the backend artifact —
// the document the product serves has to be a document the product has. That
// is the entire reason it moved.
//
// VERSION is a constant here rather than parsed out of the markdown: a
// version that a typo in prose can change is not a version. It is bumped by
// hand when the document changes, in the same commit, and `verifyVersion()`
// refuses at boot if the document's own effective line no longer names it.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DOC_PATH = path.join(__dirname, "legal", "customer-agreement.md");

// Bump this WITH the document, in the same commit.
const VERSION = "2026-09-27";

let cached = null;

// The document, its version and the sha256 of the text as served. Read once
// and cached: it is a file on disk that only changes on deploy, and the
// signup path should not do file IO per request.
function agreement() {
  if (cached) return cached;
  let text;
  try { text = fs.readFileSync(DOC_PATH, "utf8"); }
  catch (e) {
    // A missing agreement must never be a silent empty page with a checkbox
    // over it. The signup route turns this into a refusal.
    return { ok: false, error: "agreement_unavailable", version: VERSION, text: "", sha256: null,
             message: "The customer agreement could not be read. Nothing has been created." };
  }
  cached = {
    ok: true,
    version: VERSION,
    text,
    sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
  };
  return cached;
}

// True when the document still says it is the version this module claims. A
// document edited without bumping VERSION would otherwise be stored under the
// previous version's name, which is the one thing this whole file exists to
// prevent.
function verifyVersion() {
  const a = agreement();
  if (!a.ok) return false;
  return a.text.includes(`Version ${VERSION}.`);
}

module.exports = { VERSION, DOC_PATH, agreement, verifyVersion };
