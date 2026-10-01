// FIX-11 Part 5 verification walk — THE BCC ADDRESS, WHERE SOMEBODY WOULD LOOK.
//
// INT-4 built the whole inbound path and nothing on any screen said the
// address existed, so nobody could use it. This walks the door a person
// actually uses: the user chip in the top bar, which already leads to
// Settings, Account.
//
//   APP=http://localhost:4313 API=http://localhost:5841 node scripts/fix11-bcc-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path=require("path");const {chromium}=require(path.join(process.env.HOME,"steward-qa","node_modules","playwright"));
const APP=process.env.APP||"http://localhost:4313";
const API=process.env.API||"http://localhost:5841";
let f=0; const ok=(l,c,d)=>{console.log((c?"  PASS  ":"  FAIL  ")+l+(c?"":" — "+String(JSON.stringify(d)??"").slice(0,260)));if(!c)f++;};
(async()=>{
const EMAIL=`bcc${Date.now()}@example.org`;
const api=async(p,o={},tok)=>{const r=await fetch(API+p,{...o,headers:{"Content-Type":"application/json",...(tok?{Authorization:"Bearer "+tok}:{}),...(o.headers||{})}});const t=await r.text();let b;try{b=JSON.parse(t)}catch{b=t};return{status:r.status,body:b}};
const reg=await api("/auth/register",{method:"POST",body:JSON.stringify({email:EMAIL,password:"Testpass123!",orgName:"BCC Walk",name:"Dana Reyes"})});
const tok=reg.body.token; await api("/onboarding/complete",{method:"POST",body:"{}"},tok);
const org=(await api("/org",{},tok)).body;
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1440,height:1000},permissions:["clipboard-read","clipboard-write"]});const p=await ctx.newPage();
const errs=[];p.on("console",m=>{if(m.type()==="error"&&!/favicon|fonts|_vercel|ai\/stream/.test(m.location()?.url||""))errs.push(m.text().slice(0,110));});
await p.goto(APP+"/dashboard",{waitUntil:"domcontentloaded"});
await p.evaluate(([t,u,o])=>{localStorage.setItem("npe_token",t);localStorage.setItem("npe_user",JSON.stringify(u));localStorage.setItem("npe_org",JSON.stringify(o));},[tok,reg.body.user,org]);
await p.goto(APP+"/dashboard",{waitUntil:"domcontentloaded"});
await p.waitForSelector(".app-root",{timeout:25000});
const g=await p.$('[data-testid="first-run-go"]'); if(g){await g.click();await p.waitForTimeout(600);}
const l=p.locator('button').filter({hasText:/I'll finish later/}).first(); if(await l.count()){await l.click().catch(()=>{});await p.waitForTimeout(500);}
// the user chip is the profile menu's door
const chip=p.locator('button[title="Account settings"]').first();
ok("the user chip leads to the account screen",await chip.count()>0);
await chip.click(); await p.waitForTimeout(2200);
await p.waitForSelector('[data-testid="bcc-address"]',{timeout:15000}).catch(()=>{});
const card=p.locator('[data-testid="bcc-address"]');
ok("the BCC address card is on the account screen",await card.count()>0);
if(await card.count()){
 const txt=await card.innerText();
 ok("…showing the address",/log\+bcc-walk@log\.stewardapp\.dev|log\+[a-z0-9-]+@log\.stewardapp\.dev/.test(txt),{txt:txt.slice(0,300)});
 ok("…saying what it does",/files it on their record/.test(txt),{txt:txt.slice(0,260)});
 ok("…and that it is one address for the organisation",/one address for the whole organisation/.test(txt));
 ok("…and what happens to a message naming nobody",/stored nowhere at all/.test(txt));
 ok("…with no em dash",!/—/.test(txt),{found:(txt.match(/[^\n]*—[^\n]*/g)||[]).slice(0,2)});
 const copy=p.locator('[data-testid="bcc-copy"]');
 ok("there is a copy button",await copy.count()>0);
 await copy.click(); await p.waitForTimeout(600);
 ok("…which says it copied",/Copied/.test(await copy.innerText()));
 const clip=await p.evaluate(()=>navigator.clipboard.readText()).catch(()=>"");
 ok("…and the address really is on the clipboard",/^log\+[a-z0-9-]+@log\.stewardapp\.dev$/.test(String(clip).trim()),{clip});
}
ok("no console errors",errs.length===0,{errs:errs.slice(0,3)});
const phone=await ctx.newPage(); await phone.setViewportSize({width:390,height:844});
await phone.goto(APP+"/dashboard",{waitUntil:"domcontentloaded"});
await phone.evaluate(([t,u,o])=>{localStorage.setItem("npe_token",t);localStorage.setItem("npe_user",JSON.stringify(u));localStorage.setItem("npe_org",JSON.stringify(o));},[tok,reg.body.user,org]);
await phone.goto(APP+"/dashboard",{waitUntil:"domcontentloaded"});
await phone.waitForSelector(".app-root",{timeout:25000});
const g2=await phone.$('[data-testid="first-run-go"]'); if(g2){await g2.click();await phone.waitForTimeout(500);}
await phone.click(".mobile-bottom-bar button:last-child").catch(()=>{});
await phone.waitForTimeout(800);
const st=phone.locator('.mobile-more-drawer [data-nav-id="settings"]').first();
if(await st.count()){await st.click();await phone.waitForTimeout(2000);}
const acct=phone.locator('button, a').filter({hasText:/^Account$/}).first();
if(await acct.count()){await acct.click();await phone.waitForTimeout(2000);}
ok("the card is reachable at 390",await phone.locator('[data-testid="bcc-address"]').count()>0);
const hs=await phone.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2);
ok("no horizontal scroll at 390",!hs);
await b.close(); console.log(`\n${f} failure(s)`); process.exit(f?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
