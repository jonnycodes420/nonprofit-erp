// REDTEAM-2 · THE DATABASE'S CERTIFICATE.
//
// Every app pool (the main pool, the cancel pool, the set-wise pool) takes its
// TLS settings from here, so they never disagree.
//
//   DB_SSL=disable          no TLS (the stock Postgres CI and the scratch stack use)
//   PGSSLROOTCERT_PEM       the CA certificate itself, PEM text (\n may be written as a literal "\n")
//   PGSSLROOTCERT_PATH      or a path to a PEM file
//   neither                 encrypted, certificate NOT checked: exactly as before REDTEAM-2,
//                           and `npm run status` warns (dbTls on /health is "unverified")
//
// With a CA, the server's certificate must chain to it and name the host we
// dialled (rejectUnauthorized, Node's own hostname check), or the connection is
// refused. A CA that is set but can't be read or isn't a certificate stops the
// boot: a check that is asked for and quietly not made would be worse than none.
// docs/needs-jonathan/REDTEAM-2.md has the steps; no certificate is committed.
const fs = require("fs");

const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

function caPem(env = process.env) {
  const inline = String(env.PGSSLROOTCERT_PEM || "").trim();
  const path = String(env.PGSSLROOTCERT_PATH || "").trim();
  if (!inline && !path) return null;
  let pem;
  if (inline) pem = inline.replace(/\\n/g, "\n");
  else {
    try { pem = fs.readFileSync(path, "utf8"); }
    catch (e) { throw new Error(`[db] PGSSLROOTCERT_PATH is set but can't be read (${e.code || e.message}); refusing to connect without the certificate check it asks for`); }
  }
  if (!PEM_RE.test(pem)) throw new Error(`[db] ${inline ? "PGSSLROOTCERT_PEM" : "PGSSLROOTCERT_PATH"} is set but holds no PEM certificate; refusing to connect without the certificate check it asks for`);
  return pem;
}

// "off" | "verified" | "unverified": what /health reports (never the certificate).
function tlsMode(env = process.env) {
  if (env.DB_SSL === "disable") return "off";
  return caPem(env) ? "verified" : "unverified";
}

function pgSsl(env = process.env) {
  if (env.DB_SSL === "disable") return false;
  const ca = caPem(env);
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

// pg lets ssl options in the URL (sslmode, sslrootcert, ...) replace the ssl
// object it is given, so with a CA set they are taken out: the check asked for
// here is the one that runs. Without a CA the URL is passed through untouched.
const URL_SSL_KEYS = ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslca", "uselibpqcompat"];
function connectionString(url, env = process.env) {
  if (!url || env.DB_SSL === "disable" || !caPem(env)) return url;
  try {
    const u = new URL(url);
    for (const k of URL_SSL_KEYS) u.searchParams.delete(k);
    return u.toString();
  } catch { return url; }
}

// The two options every pool spreads into its config. pg names the server for
// the certificate check only when the host is a name; for an IP address it
// leaves Node to check the certificate against "localhost". So the IP we dial
// is passed on, and a certificate that doesn't name it is refused.
function poolTls(env = process.env) {
  const cs = connectionString(env.DATABASE_URL, env), ssl = pgSsl(env);
  if (ssl && ssl.ca) {
    let host = null;
    try { host = new URL(cs).hostname.replace(/^\[|\]$/g, ""); } catch {}
    if (host && require("net").isIP(host)) ssl.host = host;
  }
  return { connectionString: cs, ssl };
}

module.exports = { caPem, tlsMode, pgSsl, connectionString, poolTls };
