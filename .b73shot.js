const path=require("path");
const { chromium } = require(path.join(process.env.HOME,"steward-qa","node_modules","playwright"));
const fs=require("fs");
(async()=>{
  const BASE=process.env.BASE;
  const lr=await fetch(BASE+"/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:"director@harborlight.demo",password:"demo-harbor-2026"})});
  const j=await lr.json();
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
  await p.addInitScript(([t,u,o])=>{localStorage.setItem("npe_token",t);localStorage.setItem("npe_user",u);localStorage.setItem("npe_org",o);},
    [j.token,JSON.stringify(j.user),JSON.stringify(j.org)]);
  await p.goto("http://localhost:4173/dashboard",{waitUntil:"networkidle"});
  await p.waitForTimeout(3500);
  fs.mkdirSync("docs/build73-demo",{recursive:true});
  await p.screenshot({path:"docs/build73-demo/first-screen-1440.png"});
  const txt=await p.evaluate(()=>document.body.innerText);
  console.log("=== FIRST SCREEN TEXT (first 900 chars) ===");
  console.log(txt.slice(0,900));
  console.log("\n=== BANNED FAMILY ON THE RENDERED PAGE ===");
  for(const w of ["recovered","re-engaged","reengaged","recaptured","won back","brought back"])
    console.log("  "+w.padEnd(14)+(new RegExp("\\b"+w.replace("-","-?")+"\\b","i").test(txt)?"*** PRESENT ***":"absent"));
  await b.close();
})();
