// server/give/notOpenBrand.js · FLOWS-13 item 2 (W-1114-Atlas-15). A PAGE THAT ISN'T OPEN IS STILL THEIRS.
//
// "The public giving page showed "Not open yet" with no logo or header." The
// not-open answers carried only the sentence, so a donor who followed the link
// saw a bare line with no sign of whose page it was. They now carry the same
// name and logo the open page draws (giveThemePayload: the giving page's logo,
// else the one saved under Settings, Organization), and the page draws its
// header above the sentence.
"use strict";

// `org` is a row selected with GIVE_THEME_COLS (give_logo, display_name).
function notOpenBrand(org, giveThemePayload) {
  const th = giveThemePayload(org) || {};
  return { brand: { name: th.displayName || (org && org.name) || "", logo: th.logo || null, primary: th.primary || null, primaryFg: th.primaryFg || null } };
}

module.exports = { notOpenBrand };
