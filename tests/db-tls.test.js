// tests/db-tls.test.js · REDTEAM-2 item 2. THE DATABASE'S CERTIFICATE IS CHECKED WHEN A CA IS SET.
// Run: node tests/db-tls.test.js   (needs initdb/pg_ctl and openssl; no scratch database used)
//
// Builds its own throwaway Postgres cluster in a temp folder, with TLS on and a
// certificate signed by a made-up CA ("Harbor Test Root") that names only
// `localhost`. A second made-up CA ("Decoy Root") signed nothing here. Then
// opens a connection through the REAL app pool (server/db/pool.js, in a child
// process with only the env changed) and checks:
//   §1 no CA set: connects, as before REDTEAM-2 (encrypted, not checked), /health says "unverified"
//   §2 the right CA, by PEM text: connects, over TLS, "verified"
//   §3 the right CA, by path: connects
//   §4 the decoy CA: refused
//   §5 the right CA, but dialled as 127.0.0.1 (the certificate names localhost): refused
//   §6 the decoy CA with ?sslmode=no-verify in the URL: still refused (the URL can't undo the check)
//   §7 the set-wise pool (server/shared/pools.js) is refused with the decoy CA too
//   §8 a CA path that can't be read, or a PEM var with no certificate: the pool refuses to start
//
// HOW IT GOES RED: make dbTls.pgSsl return { ca, rejectUnauthorized: false }
// (or put pool.js back to the hard-coded { rejectUnauthorized: false }) and §4,
// §5, §6 and §7 connect. Leave the URL's sslmode in place and §6 connects.
// Never commits a certificate: every key and certificate is made here and deleted.

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? `  — ${extra}` : ""}`); } };

function findBin(name) {
  const dirs = (process.env.PATH || "").split(":");
  try { for (const v of fs.readdirSync("/usr/lib/postgresql").sort().reverse()) dirs.push(`/usr/lib/postgresql/${v}/bin`); } catch {}
  dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  for (const d of dirs) { const p = path.join(d, name); if (fs.existsSync(p)) return p; }
  return null;
}
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steward-dbtls-"));
const pgdata = path.join(dir, "pgdata");
let pgStarted = false;
const PG_CTL = findBin("pg_ctl"), INITDB = findBin("initdb"), OPENSSL = findBin("openssl");

function ssl(args) { execFileSync(OPENSSL, args, { cwd: dir, stdio: "pipe" }); }
function makeCerts() {
  fs.writeFileSync(path.join(dir, "ext.cnf"), "basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n");
  for (const [n, cn] of [["ca", "Harbor Test Root"], ["decoy", "Decoy Root"]]) {
    ssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${cn}`, "-keyout", `${n}.key`, "-out", `${n}.crt`,
      "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
  }
  ssl(["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", "server.key", "-out", "server.csr"]);
  ssl(["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-days", "2", "-out", "server.crt", "-extfile", "ext.cnf"]);
  fs.chmodSync(path.join(dir, "server.key"), 0o600);
}

async function startPg() {
  execFileSync(INITDB, ["-D", pgdata, "-U", "harbortest", "--auth=trust", "-E", "UTF8", "--no-instructions"], { stdio: "pipe" });
  const port = await freePort();
  fs.appendFileSync(path.join(pgdata, "postgresql.conf"), [
    `port = ${port}`, `listen_addresses = '127.0.0.1'`, `unix_socket_directories = '${dir}'`, "ssl = on",
    `ssl_cert_file = '${path.join(dir, "server.crt")}'`, `ssl_key_file = '${path.join(dir, "server.key")}'`, "fsync = off", "max_connections = 30", ""].join("\n"));
  // Only TLS connections are allowed in, so a pass can't be a plain-text connection.
  fs.writeFileSync(path.join(pgdata, "pg_hba.conf"), "local all all trust\nhostssl all all 127.0.0.1/32 trust\nhostssl all all ::1/128 trust\n");
  execFileSync(PG_CTL, ["-D", pgdata, "-l", path.join(dir, "pg.log"), "-w", "-t", "30", "start"], { stdio: "pipe" });
  pgStarted = true;
  return port;
}

// One connection through the app's own pool module, in a fresh process with only these env vars changed.
function connectVia(env, which = "main") {
  const code = which === "main"
    ? `const {pool}=require("./server/db/pool");pool.query("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()").then(r=>{console.log("CONNECTED "+r.rows[0].ssl+" "+require("./server/shared/dbTls").tlsMode());process.exit(0)},e=>{console.log("REFUSED "+(e.code||"")+" "+e.message);process.exit(0)})`
    : `const {setPool}=require("./server/shared/pools");setPool().query("SELECT 1").then(()=>{console.log("CONNECTED");process.exit(0)},e=>{console.log("REFUSED "+(e.code||"")+" "+e.message);process.exit(0)})`;
  const base = { ...process.env };
  for (const k of ["DB_SSL", "PGSSLROOTCERT_PEM", "PGSSLROOTCERT_PATH", "PGSSLMODE", "PGSSLROOTCERT"]) delete base[k];
  const r = spawnSync(process.execPath, ["-e", code], { cwd: ROOT, env: { ...base, ...env }, encoding: "utf8", timeout: 30000 });
  return ((r.stdout || "") + (r.stderr || "")).trim();
}

(async () => {
  console.log("db-tls · REDTEAM-2: the database's certificate");
  if (!PG_CTL || !INITDB || !OPENSSL) { console.log(`  ✗ needs initdb, pg_ctl and openssl (found ${INITDB}, ${PG_CTL}, ${OPENSSL})`); process.exit(1); }
  makeCerts();
  const port = await startPg();
  const pem = f => fs.readFileSync(path.join(dir, f), "utf8");
  const url = host => `postgresql://harbortest@${host}:${port}/postgres`;

  let out = connectVia({ DATABASE_URL: url("localhost") });
  ok("§1 no CA set: connects over TLS as before, unchecked", /^CONNECTED true unverified/m.test(out), out);

  out = connectVia({ DATABASE_URL: url("localhost"), PGSSLROOTCERT_PEM: pem("ca.crt") });
  ok("§2 the right CA (PEM text): connects over TLS, verified", /^CONNECTED true verified/m.test(out), out);

  out = connectVia({ DATABASE_URL: url("localhost"), PGSSLROOTCERT_PEM: pem("ca.crt").replace(/\n/g, "\\n") });
  ok("§2b the right CA with its newlines written as \\n (how a one-line env var holds it): connects", /^CONNECTED true verified/m.test(out), out);

  out = connectVia({ DATABASE_URL: url("localhost"), PGSSLROOTCERT_PATH: path.join(dir, "ca.crt") });
  ok("§3 the right CA (path): connects", /^CONNECTED true verified/m.test(out), out);

  out = connectVia({ DATABASE_URL: url("localhost"), PGSSLROOTCERT_PEM: pem("decoy.crt") });
  ok("§4 a CA that didn't sign the server's certificate: refused", /^REFUSED/m.test(out) && !/CONNECTED/.test(out), out);

  out = connectVia({ DATABASE_URL: url("127.0.0.1"), PGSSLROOTCERT_PEM: pem("ca.crt") });
  ok("§5 the right CA, but a host the certificate doesn't name: refused", /^REFUSED/m.test(out) && /altnames|hostname|IP/i.test(out), out);

  out = connectVia({ DATABASE_URL: url("localhost") + "?sslmode=no-verify", PGSSLROOTCERT_PEM: pem("decoy.crt") });
  ok("§6 the decoy CA with sslmode=no-verify in the URL: still refused", /^REFUSED/m.test(out), out);

  out = connectVia({ DATABASE_URL: url("localhost"), PGSSLROOTCERT_PEM: pem("decoy.crt") }, "set");
  ok("§7 the set-wise pool with the decoy CA: refused", /^REFUSED/m.test(out), out);
  out = connectVia({ DATABASE_URL: url("localhost"), PGSSLROOTCERT_PEM: pem("ca.crt") }, "set");
  ok("§7b the set-wise pool with the right CA: connects", /^CONNECTED/m.test(out), out);

  out = connectVia({ DATABASE_URL: url("localhost"), PGSSLROOTCERT_PATH: path.join(dir, "no-such.crt") });
  ok("§8 a CA path that can't be read: the pool won't start", !/CONNECTED/.test(out) && /PGSSLROOTCERT_PATH is set but can't be read/.test(out), out);
  out = connectVia({ DATABASE_URL: url("localhost"), PGSSLROOTCERT_PEM: "not a certificate" });
  ok("§8b a PEM var with no certificate in it: the pool won't start", !/CONNECTED/.test(out) && /holds no PEM certificate/.test(out), out);
})().catch(e => { fail++; console.log("  ✗ crashed: " + e.stack); }).finally(() => {
  if (pgStarted) { try { execFileSync(PG_CTL, ["-D", pgdata, "-m", "immediate", "-w", "stop"], { stdio: "pipe" }); } catch {} }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
