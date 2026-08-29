// CAN-SPAM postal-address footer (2026-07-17) — verifies that
// unsubscribeEmailFooterHtml renders the org's legal name + receipt_address
// (HTML-escaped, newlines flattened) above the unsubscribe link on real
// campaign sends, and that an address-less org still sends with the old
// unsubscribe-only footer.
//
// Extra setup beyond tests/README.md: the server must be booted with
//   RESEND_BASE_URL=http://localhost:5602  DEMO_SMTP_FROM=noreply@stewardapp.dev
// and this suite starts its own mock Resend capture server on port 5602
// (Resend's SDK honors RESEND_BASE_URL), so no real email ever leaves.

const http = require("http");
const { BASE, ok, summary, api, SINK_PORT } = require("./helpers");

const captured = []; // { path, body } for every POST the server makes to "Resend"
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push({ path: req.url, body: body ? JSON.parse(body) : null }); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});

async function makeOrg(name, email) {
  const r = await api("POST", "/auth/register-org", null, {
    orgName: name, userName: "Footer Test", email, password: "loadtest1234",
  });
  if (!r.body.token) throw new Error("register-org failed: " + r.text);
  await api("POST", "/onboarding/complete", r.body.token);
  return r.body;
}

// Sends a one-recipient campaign through the real route and returns the
// captured Resend payload for that recipient.
async function sendCampaign(reg, donorEmail) {
  await api("POST", "/donors", reg.token, { name: "Footer Donor", email: donorEmail });
  const c = await api("POST", "/campaigns", reg.token, {
    name: "Footer " + donorEmail, subject: "Footer test", body: "Hello {{first_name}}.", segment: { mode: "all" },
  });
  await api("POST", `/campaigns/${c.body.id}/send`, reg.token);
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const rows = await api("GET", "/campaigns", reg.token);
    if (rows.body.find?.(x => x.id === c.body.id)?.status === "sent") break;
  }
  return captured.find(e => e.path === "/emails" && (e.body?.to === donorEmail || e.body?.to?.includes?.(donorEmail)))?.body;
}

(async () => {
  await new Promise((res, rej) => { mock.on("error", rej); mock.listen(SINK_PORT, res); });
  const stamp = Date.now();

  console.log("\nOrg with receipt_address configured:");
  const orgA = await makeOrg("Footer Addressed Org", `footer-a-${stamp}@example.com`);
  await api("PATCH", `/orgs/${orgA.org.id}`, orgA.token, {
    legalName: "Footer Addressed Organization Inc.",
    receiptAddress: "123 Steward Lane\nSpringfield, IL 62704",
  });
  const htmlA = (await sendCampaign(orgA, `footer-donor-a-${stamp}@example.com`))?.html || "";
  ok("footer carries legal name + address, newlines flattened",
    /Footer Addressed Organization Inc\. · 123 Steward Lane, Springfield, IL 62704/.test(htmlA), htmlA.slice(-400));
  ok("unsubscribe link still present", /Unsubscribe<\/a> from these emails/.test(htmlA));

  console.log("\nOrg without receipt_address:");
  const orgB = await makeOrg("Footer Bare Org", `footer-b-${stamp}@example.com`);
  const htmlB = (await sendCampaign(orgB, `footer-donor-b-${stamp}@example.com`))?.html || "";
  ok("send not blocked, unsubscribe-only footer", /Unsubscribe<\/a> from these emails/.test(htmlB), htmlB.slice(-300));
  ok("no address separator in footer", !/·/.test(htmlB.slice(htmlB.indexOf("margin-top:32px"))));

  console.log("\nHTML-escaping of address fields:");
  const orgC = await makeOrg("Footer Escape Org", `footer-c-${stamp}@example.com`);
  await api("PATCH", `/orgs/${orgC.org.id}`, orgC.token, {
    legalName: "Escape & Sons <Test>",
    receiptAddress: "1 <script>alert(1)</script> Way",
  });
  const htmlC = (await sendCampaign(orgC, `footer-donor-c-${stamp}@example.com`))?.html || "";
  ok("raw markup never reaches the email", !/<script>/.test(htmlC));
  ok("escaped entities rendered", /Escape &amp; Sons &lt;Test&gt; · 1 &lt;script&gt;/.test(htmlC), htmlC.slice(-400));

  mock.close();
  summary();
})().catch(e => { console.error("SUITE ERROR:", e); mock.close(); process.exit(1); });
