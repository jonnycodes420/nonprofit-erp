// surveyLinks.js — SURVEY-1. A survey's public link, and a person's own link.
//
// A PERSONAL LINK names the person it was made for, so a named survey answered
// through it lands on their record without asking who they are. It is signed
// (HMAC over the survey and the person) and holds nothing else; a tampered or
// borrowed-from-another-survey link is just the public link. An anonymous
// survey ignores it entirely: nothing about the person who opened it is read
// or kept.
const crypto = require("crypto");
const { publicAppUrl } = require("./publicUrl");

const secret = () => process.env.SURVEY_LINK_SECRET || process.env.JWT_SECRET || "survey-link-dev-secret";
const sig = (surveyId, donorId) => crypto.createHmac("sha256", secret()).update(`survey:${surveyId}:${donorId}`).digest("base64url").slice(0, 24);

function personalToken(surveyId, donorId) { return `${donorId}.${sig(surveyId, donorId)}`; }

// The person a token names, or null. Constant-time compare.
function readToken(surveyId, token) {
  const m = /^([A-Za-z0-9_-]{1,80})\.([A-Za-z0-9_-]{24})$/.exec(String(token || ""));
  if (!m) return null;
  const want = Buffer.from(sig(surveyId, m[1])), got = Buffer.from(m[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? m[1] : null;
}

function publicUrl(orgSlug, slug) { return `${publicAppUrl()}/survey/${encodeURIComponent(orgSlug)}/${encodeURIComponent(slug)}`; }
function personalUrl(orgSlug, slug, surveyId, donorId) { return `${publicUrl(orgSlug, slug)}?t=${encodeURIComponent(personalToken(surveyId, donorId))}`; }

module.exports = { personalToken, readToken, publicUrl, personalUrl };
