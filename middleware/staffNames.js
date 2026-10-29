// middleware/staffNames.js · FIX-57 item 3. NAMES, NOT EMAILS.
//
// Until FIX-57 the actor stamp wrote a signed-in person's EMAIL into every
// `*_by_name` column (server.js actor()), so cards, activity and Going out read
// "Reviewed by robin@fix56.test". New writes carry the name now. Rows already
// written keep what they say (no row changes at deploy), so this seam, mounted
// above every router, shows them by name on the way out: a JSON field that
// names who did something (`reviewedBy`, `turnedOnByName`, `created_by_name`,
// ...) whose value is EXACTLY the email of a member of the caller's own org
// reads as that member's name. Email only if they never set a name.
//
// It never touches any other field and never any other address: a donor's
// email is not a staff email, and a field that is not a "by" field is left as
// it is. A response with no such value costs nothing (no query).

const BY_KEY = /(?:^|_)by(?:_name)?$|By(?:Name)?$|^(?:actor|actorName|actor_name|who|whoName|user_name|userName)$/;
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DEPTH = 8;

function collect(v, out, depth) {
  if (!v || typeof v !== "object" || depth > MAX_DEPTH) return;
  if (Array.isArray(v)) { for (const x of v) collect(x, out, depth + 1); return; }
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (typeof x === "string") { if (BY_KEY.test(k) && EMAILISH.test(x)) out.add(x.toLowerCase()); }
    else if (x && typeof x === "object") collect(x, out, depth + 1);
  }
}
function rewrite(v, names, depth) {
  if (!v || typeof v !== "object" || depth > MAX_DEPTH) return v;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = rewrite(v[i], names, depth + 1); return v; }
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (typeof x === "string") { if (BY_KEY.test(k) && names.has(x.toLowerCase())) v[k] = names.get(x.toLowerCase()); }
    else if (x && typeof x === "object") rewrite(x, names, depth + 1);
  }
  return v;
}

function staffNames({ query }) {
  return (req, res, next) => {
    const send = res.json.bind(res);
    res.json = function (body) {
      const orgId = req.user && req.user.orgId;
      const found = new Set();
      if (orgId && body && typeof body === "object") collect(body, found, 0);
      if (!found.size) return send(body);
      query(`SELECT LOWER(email) AS email, name FROM users WHERE org_id=? AND LOWER(email) = ANY(?) AND COALESCE(TRIM(name),'') <> ''`, [orgId, [...found]])
        .then(rows => {
          const names = new Map(rows.map(r => [r.email, String(r.name).trim()]));
          send(names.size ? rewrite(body, names, 0) : body);
        })
        .catch(() => send(body));
      return res;
    };
    next();
  };
}

module.exports = { staffNames, BY_KEY };
