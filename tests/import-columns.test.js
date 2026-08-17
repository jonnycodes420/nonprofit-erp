// BUILD-58 Part 2 — import must never discard input without saying so.
//
// Instances fixed (from the BUILD-57 hostile-import catalogue, triaged by
// "fires in a pilot's first week"):
//   • Deceased / Do-Not-Contact columns were silently discarded (P0 — the
//     flags now land on the donor row and are honored by the mail policy).
//   • "Donor Email" defeated the email-column probe, so Import-both silently
//     linked by NAME and split donor histories.
//   • external_id never reached the DB through Import-both (the F-4
//     cross-run idempotency contract never engaged on that surface).
//   • windows-1252 CSVs imported as permanent mojibake.
//   • Negative/refund rows vanished without a trace.
//
// The class: every column in an uploaded file is MAPPED, deliberately
// IGNORED, or UNRECOGNIZED — and the summary reports all three, by name
// (classifyColumns in importShape.js; DonorImport renders it). Every skipped
// ROW is counted with its reason (buildGiftItemsFromLedger's rowReport).
//
// Verify-first: committed RED against the pre-BUILD-58 code.

const { ok, summary, api, q, closeDb, BASE } = require("./helpers");
const fs = require("fs");
const path = require("path");

const uniq = () => Math.random().toString(36).slice(2, 8);

(async () => {
  console.log("import-columns (BUILD-58 Part 2)");
  const shape = await import("../client/src/lib/importShape.js");

  // ── §1 "Donor Email" is an email column ──────────────────────────────────
  console.log("\n§1 email-column probe recognizes real-world headers");
  {
    const headers = ["Donor Name", "Donor Email", "Amount", "Date"];
    const rows = [
      { "Donor Name": "A B", "Donor Email": "a@x.org", "Amount": "50", "Date": "2026-01-02" },
      { "Donor Name": "A B", "Donor Email": "a@x.org", "Amount": "25", "Date": "2026-02-02" },
    ];
    const det = shape.detectImportShape(headers, rows);
    ok('"Donor Email" recognized as the email column', det.emailCol === "Donor Email", det);
    for (const h of ["Email", "Email Address", "E-mail", "Donor E-mail", "Contact Email", "Primary Email"]) {
      const d2 = shape.detectImportShape(["Name", h, "Amount", "Date"], [{ Name: "x", [h]: "a@x.org", Amount: "5", Date: "2026-01-01" }]);
      ok(`"${h}" recognized as an email column`, d2.emailCol === h, d2.emailCol);
    }
    ok('"Emailed Receipt" is NOT an email column (no false positive)',
      shape.detectImportShape(["Name", "Emailed Receipt", "Amount", "Date"], [{ Name: "x", "Emailed Receipt": "Y", Amount: "5", Date: "2026-01-01" }]).emailCol === "", null);
    // Import-both consequence: with "Donor Email" on the gift sheet, the match
    // key is EMAIL, not the history-splitting name fallback.
    const donorSheet = { headers: ["Name", "Email"], rows: [{ Name: "A B", Email: "a@x.org" }], det: shape.detectImportShape(["Name", "Email"], [{ Name: "A B", Email: "a@x.org" }]) };
    const giftSheet = { headers, rows, det };
    const mk = shape.pickMatchKey(donorSheet, giftSheet);
    ok("Import-both picks EMAIL as the match key for a Donor-Email gift sheet", mk.key === "email", mk);
  }

  // ── §2 deceased / do-not-contact columns are detected + parsed ───────────
  console.log("\n§2 flag columns are recognized, never silently dropped");
  {
    ok("detectFlagColumns is exported", typeof shape.detectFlagColumns === "function", Object.keys(shape));
    if (typeof shape.detectFlagColumns === "function") {
      const f1 = shape.detectFlagColumns(["Name", "Email", "Deceased", "Do Not Contact"]);
      ok("finds 'Deceased' + 'Do Not Contact'", f1.deceasedCol === "Deceased" && f1.doNotContactCol === "Do Not Contact", f1);
      const f2 = shape.detectFlagColumns(["Name", "Is Deceased?", "Do Not Solicit"]);
      ok("finds 'Is Deceased?' + 'Do Not Solicit'", f2.deceasedCol === "Is Deceased?" && f2.doNotContactCol === "Do Not Solicit", f2);
      const f3 = shape.detectFlagColumns(["Name", "Deceased Spouse Name", "Contact Notes"]);
      ok("no false positives on lookalike headers", !f3.deceasedCol && !f3.doNotContactCol, f3);
      for (const [v, want] of [["Y", true], ["yes", true], ["TRUE", true], ["1", true], ["x", true], ["Deceased", true], ["", false], ["N", false], ["no", false], ["false", false], ["0", false]])
        ok(`parseBoolFlag(${JSON.stringify(v)}) → ${want}`, shape.parseBoolFlag(v) === want, null);
    }
  }

  // ── §3 the class: every column accounted for, by name ────────────────────
  console.log("\n§3 classifyColumns — mapped · ignored · unrecognized");
  {
    ok("classifyColumns is exported", typeof shape.classifyColumns === "function", null);
    if (typeof shape.classifyColumns === "function") {
      const headers = ["Name", "Email", "Total Giving", "Deceased", "Middle Initial", "Wedding Anniversary"];
      const mapping = { Name: "name", Email: "email", "Total Giving": "total", Deceased: "deceased" };
      const c = shape.classifyColumns(headers, mapping, ["Middle Initial"]);
      ok("mapped columns listed with their targets", c.mapped.length === 4 && c.mapped.some(m => m.header === "Deceased" && m.field === "deceased"), c.mapped);
      ok("deliberately-ignored columns listed by name", c.ignored.length === 1 && c.ignored[0] === "Middle Initial", c.ignored);
      ok("unrecognized columns listed by name", c.unrecognized.length === 1 && c.unrecognized[0] === "Wedding Anniversary", c.unrecognized);
      ok("no column vanishes from the accounting", c.mapped.length + c.ignored.length + c.unrecognized.length === headers.length, c);
    }
  }

  // ── §4 encoding: windows-1252 never becomes permanent mojibake ───────────
  console.log("\n§4 non-UTF8 CSV bytes decode correctly");
  {
    ok("decodeSpreadsheetBytes is exported", typeof shape.decodeSpreadsheetBytes === "function", null);
    if (typeof shape.decodeSpreadsheetBytes === "function") {
      // "José Muñoz" in windows-1252: é=0xE9, ñ=0xF1
      const w1252 = Uint8Array.from([0x4A, 0x6F, 0x73, 0xE9, 0x20, 0x4D, 0x75, 0xF1, 0x6F, 0x7A]);
      ok("windows-1252 bytes → José Muñoz", shape.decodeSpreadsheetBytes(w1252) === "José Muñoz", JSON.stringify(shape.decodeSpreadsheetBytes(w1252)));
      const utf8 = new TextEncoder().encode("José Muñoz — ✓");
      ok("valid UTF-8 passes through untouched", shape.decodeSpreadsheetBytes(utf8) === "José Muñoz — ✓", null);
      const bom = Uint8Array.from([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode("Name")]);
      ok("UTF-8 BOM stripped", shape.decodeSpreadsheetBytes(bom) === "Name", JSON.stringify(shape.decodeSpreadsheetBytes(bom)));
    }
  }

  // ── §5 the gift-ledger row builder: externalId + row accounting ──────────
  console.log("\n§5 buildGiftItemsFromLedger — externalId survives, skipped rows have reasons");
  {
    ok("buildGiftItemsFromLedger is exported", typeof shape.buildGiftItemsFromLedger === "function", null);
    if (typeof shape.buildGiftItemsFromLedger === "function") {
      const rows = [
        { "Donor Email": "a@x.org", "Donor Name": "A B", Amount: "$100", Date: "2026-01-02", "Transaction ID": "TXN-1" },
        { "Donor Email": "a@x.org", "Donor Name": "A B", Amount: "-250", Date: "2026-01-05", "Transaction ID": "TXN-2" },   // refund
        { "Donor Email": "a@x.org", "Donor Name": "A B", Amount: "(1,000)", Date: "2026-01-06", "Transaction ID": "TXN-3" }, // refund, accounting style
        { "Donor Email": "a@x.org", "Donor Name": "A B", Amount: "n/a", Date: "2026-01-07", "Transaction ID": "TXN-4" },     // unparsable
      ];
      const tx = { donorEmail: "Donor Email", donorName: "Donor Name", amount: "Amount", date: "Date", externalId: "Transaction ID" };
      const built = shape.buildGiftItemsFromLedger(rows, tx, "");
      const withGift = built.items.filter(i => i.gift);
      ok("the good row builds a gift", withGift.length === 1, { withGift: withGift.length });
      ok("externalId rides the gift item", withGift[0]?.gift?.externalId === "TXN-1", withGift[0]?.gift);
      ok("negative rows counted WITH a reason (refunds, not silence)", built.report?.negativeRows === 2, built.report);
      ok("unparsable amounts counted WITH a reason", built.report?.unparsableAmountRows === 1, built.report);
    }
  }

  // ── §6 server: flags + external ids land in the DB ───────────────────────
  console.log("\n§6 the flags survive the real import routes");
  {
    const email = `b58imp-${uniq()}@test.local`;
    const reg = await fetch(BASE + "/auth/register-org", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: "Import Flags Org " + uniq(), userName: "Imp Admin", email, password: "loadtest1234" }),
    }).then(r => r.json());
    const tok = reg.token, orgId = reg.org.id;
    await api("POST", "/onboarding/complete", tok, {});

    const imp = await api("POST", "/donors/import", tok, {
      donors: [
        { name: "Norma Normal", email: `norma-${uniq()}@x.org` },
        { name: "Dora Deceased", email: `dora-${uniq()}@x.org`, deceased: true },
        { name: "Don Notsolicit", email: `don-${uniq()}@x.org`, doNotContact: true },
      ],
    });
    ok("/donors/import accepts flagged donors", imp.status === 200 || imp.status === 201, imp.body);
    // to_jsonb so a pre-fix schema (no columns yet) FAILS instead of crashing
    const flags = (await q("SELECT to_jsonb(d) AS j FROM donors d WHERE org_id=$1", [orgId])).map(r => r.j);
    ok("deceased flag stored", flags.find(f => f.name === "Dora Deceased")?.deceased === true, flags.map(f => ({ name: f.name, deceased: f.deceased })));
    ok("do_not_contact flag stored", flags.find(f => f.name === "Don Notsolicit")?.do_not_contact === true, flags.map(f => ({ name: f.name, dnc: f.do_not_contact })));
    ok("unflagged donor stays unflagged", flags.find(f => f.name === "Norma Normal")?.deceased === false, null);

    const imp2 = await api("POST", "/donors/import-combined", tok, {
      donors: [{ name: "Gina Ghosted", email: `gina-${uniq()}@x.org`, deceased: true }],
      gifts: [{ donorIndex: 0, amount: 40, date: "2026-01-05", type: "cash", campaign: "", notes: "", externalId: "B58-EXT-" + uniq() }],
    });
    ok("/donors/import-combined accepts flagged donors", imp2.status === 200 || imp2.status === 201, imp2.body);
    const g2 = (await q("SELECT to_jsonb(d) AS d, to_jsonb(g) AS g FROM donors d JOIN gifts g ON g.donor_id=d.id WHERE d.org_id=$1 AND d.name='Gina Ghosted'", [orgId]))[0];
    ok("import-combined: deceased stored + external_id stored", g2?.d?.deceased === true && /^B58-EXT-/.test(g2?.g?.external_id || ""), { deceased: g2?.d?.deceased, external_id: g2?.g?.external_id });
  }

  // ── §7 source pins: the client wiring can't quietly regress ──────────────
  console.log("\n§7 client wiring pins");
  {
    const donorsSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "Donors.jsx"), "utf8");
    // The RECOMMENDED menu entry must open the magical DonorImport path (the
    // one with shape detection + the Import-both CTA), not the legacy
    // CombinedImport whose multi-sheet picker forces one sheet.
    const recLine = donorsSrc.split("\n").find(l => /badge:"Recommended"/.test(l)) || "";
    ok("Recommended menu entry routes to the magical import (DonorImport)", /MagicImport|setShowImportHistory|withHistory/.test(recLine), recLine.trim().slice(0, 160));
    ok("the summary renders the column accounting (classifyColumns wired in)", /classifyColumns/.test(donorsSrc), null);
    ok("CSV parsing goes through decodeSpreadsheetBytes (encoding fix wired in)", /decodeSpreadsheetBytes/.test(donorsSrc), null);
    ok("buildBothPayload builds gift items through the accounted ledger builder", /buildGiftItemsFromLedger/.test(donorsSrc), null);
  }

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
