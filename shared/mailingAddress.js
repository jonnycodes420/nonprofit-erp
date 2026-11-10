// shared/mailingAddress.js · ASKS-1 item 1. A PERSON'S MAILING ADDRESS, WRITTEN ONE WAY.
//
// Sarah (CKRH), 10 Nov: "when I go to run a report for People, there is no
// tick box for Street Address, just City, State, and Zip Code." The street is
// now a field everywhere the address is (the People report, the Donors list's
// columns, the donors CSV), and so is the whole address for a mail merge or a
// label: the street (and line 2, after a comma) on the first line, then
// "City, ST ZIP". A part that is blank is left out; a person with no address
// at all reads as blank, never as a stray comma.
//
// The SQL form (the report builder) and the JS form (the list and the CSV) are
// here side by side, so the two cannot drift. An ES module; the CommonJS
// server requires it as it requires shared/giftWords.js.

const t = v => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

// { address, address2, city, state, zip } → "12 Elm St, Apt 4\nLexington, KY 40502"
export function mailingAddress(d) {
  if (!d) return "";
  const street = [t(d.address), t(d.address2)].filter(Boolean).join(", ");
  const place = [[t(d.city), t(d.state)].filter(Boolean).join(", "), t(d.zip)].filter(Boolean).join(" ");
  return [street, place].filter(Boolean).join("\n");
}

// The same, in SQL, for a donors row aliased `d`.
const T_ = c => `NULLIF(BTRIM(regexp_replace(COALESCE(${c},''), '\\s+', ' ', 'g')),'')`;
export function MAILING_ADDRESS_SQL(d = "d") {
  return `COALESCE(CONCAT_WS(E'\\n',
    NULLIF(CONCAT_WS(', ', ${T_(`${d}.address`)}, ${T_(`${d}.address2`)}),''),
    NULLIF(CONCAT_WS(' ', NULLIF(CONCAT_WS(', ', ${T_(`${d}.city`)}, ${T_(`${d}.state`)}),''), ${T_(`${d}.zip`)}),'')),'')`;
}
