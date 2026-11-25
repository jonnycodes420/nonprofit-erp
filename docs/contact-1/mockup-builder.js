// Runs IN the page. Builds the proposed Contact tab from the person's real (read-only) facts.
window.__contactMock = function(data){
  const INK="#0F1A12", WHITE="#FFFFFF", CREAM="#F0EDE6", EM="#0D5C3A", BRASS="#C9A84C", DIM="rgba(15,26,18,.58)", LINE="rgba(15,26,18,.12)";
  const d=data.d, cx=(data.rail&&data.rail.contact)||{}, hh=data.hh||{};
  const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const card=(title,body,action="")=>`<section style="background:${WHITE};border:1px solid ${LINE};border-radius:12px;padding:18px 20px;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px"><h3 style="margin:0;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;font-variant:small-caps;color:${INK};opacity:.7;font-weight:700">${title}</h3>${action}</div>${body}</section>`;
  const row=(label,value,extra="")=>`<div class="cmk-row" style="padding:9px 0;border-top:1px solid ${LINE};font-size:14px"><div class="cmk-l" style="color:${DIM};font-size:12.5px">${label}</div><div class="cmk-v" style="overflow-wrap:anywhere;color:${INK}">${value}</div><div class="cmk-x">${extra}</div></div>`;
  const copyBtn=(t="Copy")=>`<button style="background:${WHITE};border:1px solid ${LINE};border-radius:7px;padding:4px 10px;font:inherit;font-size:12px;font-weight:700;color:${INK}">${t}</button>`;
  const flag=t=>`<span style="display:inline-block;margin-left:8px;font-size:11.5px;font-weight:700;color:${INK};background:${BRASS}33;border:1px solid ${BRASS};border-radius:99px;padding:1px 8px">${esc(t)}</span>`;
  const okTag=t=>`<span style="display:inline-block;margin-left:8px;font-size:11.5px;color:${DIM}">${esc(t)}</span>`;
  const street=[d.address,d.address2].filter(Boolean), last=`${d.city||""}${d.state?", "+d.state:""}${d.zip?" "+d.zip:""}`;
  const addressee=d.salutation&&!/^dear\b/i.test(d.salutation)?d.salutation:d.name;
  const members=(hh.people||hh.members||[]).filter(m=>m.id!==d.id); const differs=new Set(((hh.address||{}).differs)||[]);
  const block=[addressee,...street,last].map(esc).join("<br>");
  const fl=(cx.flags||[]);
  const css=`<style>.cmk-row{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:10px;align-items:center}@media (max-width:600px){.cmk-row{grid-template-columns:minmax(0,1fr) auto;row-gap:2px}.cmk-l{grid-column:1/-1}}</style>`;
  const shared=members.filter(m=>!differs.has(m.name)).map(m=>m.name.split(" ")[0]), apart=members.filter(m=>differs.has(m.name)).map(m=>m.name.split(" ")[0]);
  const html=css+`<div data-mock="contact-tab" style="padding:24px var(--dp-gutter,40px);display:flex;flex-direction:column;gap:16px">
   <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
     <div style="font-size:14px;color:${DIM}">Everything to reach ${esc((d.name||"").split(" ")[0])}, without opening Edit.</div>
     <button style="background:${WHITE};border:1.5px solid ${INK};border-radius:9px;padding:8px 14px;font:inherit;font-size:13px;font-weight:700;color:${INK}">Edit</button>
   </div>
   ${card("Mailing address",`<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1 1 240px;font-size:15.5px;line-height:1.55;color:${INK};background:${CREAM};border-radius:8px;padding:14px 16px;font-family:inherit">${block}</div>
      <div style="flex:0 1 220px;display:flex;flex-direction:column;gap:8px">
        <button style="background:${WHITE};border:1.5px solid ${INK};border-radius:9px;padding:9px 14px;font:inherit;font-size:13px;font-weight:700;color:${INK}">Copy address</button>
        <div style="font-size:12px;color:${DIM};line-height:1.45">Puts the name and full address on the clipboard, for an invoice or an envelope. The same block the window envelope prints.</div>
        <div style="font-size:12px;color:${INK}">Address it to: <u style="text-underline-offset:3px">${esc(addressee)}</u>${members.length&&hh.addressee?` or <u style="text-underline-offset:3px;color:${DIM}">${esc(hh.addressee)}</u>`:""}</div>
      </div></div>
      <div style="margin-top:10px;font-size:12.5px;color:${DIM}">Home${shared.length?` · shared with ${esc(shared.join(", "))}`:""}${apart.length?` · ${esc(apart.join(", "))} lives at a different address`:""}${d.do_not_mail?flag("Do not mail"):okTag("Mail is fine")}</div>`)}
   ${card("Email and phone",[
      d.email?row("Email",esc(d.email)+(d.email_unreachable?flag("Bounced"):"")+(d.do_not_email?flag("Opted out"):""),copyBtn()):row("Email",`<span style="color:${DIM}">None on file</span>`),
      d.email2?row("Other email",esc(d.email2),copyBtn()):"",
      d.phone?row("Phone",esc(d.phone)+(d.phone_unreachable?flag("Marked wrong"):""),copyBtn()):row("Phone",`<span style="color:${DIM}">None on file</span>`),
      d.mobile?row("Mobile",esc(d.mobile),copyBtn()):row("Mobile",`<span style="color:${DIM}">None on file</span>`),
    ].join(""))}
   ${card("Preferences",[
      row("Prefers",cx.preferred?esc(cx.preferred):`<span style="color:${DIM}">Not said yet</span>`),
      row("Do not",fl.length?fl.map(f=>flag(f.label)).join(""):`<span style="color:${DIM}">No restrictions: calls, mail and email are all fine</span>`),
      row("Automatic emails",esc((data.auto&&data.auto.line)||"Follows your settings")),
    ].join(""))}
   ${members.length?card("Household · "+esc(hh.name||""),members.map(m=>`<div style="padding:10px 0;border-top:1px solid ${LINE}">
      <div style="font-size:14px;font-weight:700;color:${INK}">${esc(m.name)}</div>
      <div style="font-size:13px;color:${INK};margin-top:3px">${[m.email,m.phone].filter(Boolean).map(esc).join(" · ")||`<span style="color:${DIM}">No email or phone of their own</span>`}</div>
      <div style="font-size:12.5px;color:${DIM};margin-top:2px">${differs.has(m.name)?"A different address (opens their profile)":"Same address"}${(m.preferences||[]).length?" · "+m.preferences.map(esc).join(", "):""}</div></div>`).join(""),
      `<span style="font-size:12px;color:${DIM}">Each person keeps their own details</span>`):""}
  </div>`;
  return html;
};
