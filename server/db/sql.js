// REDTEAM-2 · SQL TEXT COMES ONLY FROM THE SOURCE CODE.
//
// A statement or a piece of one (a WHERE clause, a member list) is a `Sql`
// value, and there are only three ways to make one:
//
//   sql`... ${value} ...`        the text is the template's own literal parts,
//                                which only the source code can write (a tagged
//                                template's strings array is frozen and carries
//                                .raw; request data can't make one). Every
//                                ${value} becomes a bound parameter, unless it
//                                is itself a Sql, which is spliced in with its
//                                own parameters.
//   sql.id(name, allowed)        an identifier (a table or column), only when
//                                it is one of a fixed list given in the code;
//                                anything else throws.
//   sql.join(parts, sep)         Sql pieces joined by a Sql separator.
//   sql.pick(key, table)         one entry of a table the code wrote ({ key: text }),
//                                chosen by key; a key not in it throws. The
//                                request chooses which, never what the text says.
//   sql.ident(name)              a name read from Postgres's own catalog, double-
//                                quoted as quote_ident does, so it is only a name.
//
// There is no door that takes arbitrary text as SQL. query/run/queryTx/runTx/querySetwise accept a Sql
// (server/db/query.js, server/shared/pools.js) as well as the older
// (text, params) pair, so a module moves over one statement at a time.
//
// A literal part may still hold `?` placeholders whose values come from a
// params array beside it (the older builders' shape): sql`stage = ?` with the
// value pushed onto params. A Sql may carry bound values or rely on outside
// params, never both, so the placeholders can't be miscounted.

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

class Sql {
  constructor(text, values) { this.text = text; this.values = values; Object.freeze(this); }
  // Kept so a Sql still reads correctly where older code puts it inside a plain
  // string, but only when it has no bound values (they would be lost).
  toString() {
    if (this.values.length) throw new Error("[sql] a Sql with bound values was used as plain text; pass it to query() or splice it into sql``");
    return this.text;
  }
}

function sql(strings, ...vals) {
  if (!Array.isArray(strings) || !Object.isFrozen(strings) || !Array.isArray(strings.raw)) {
    throw new TypeError("[sql] sql is a template tag: write sql`...`, never sql(text)");
  }
  let text = strings[0];
  const values = [];
  vals.forEach((v, i) => {
    if (v instanceof Sql) { text += v.text; values.push(...v.values); }
    else { text += "?"; values.push(v); }
    text += strings[i + 1];
  });
  return new Sql(text, values);
}

const EMPTY = new Sql("", []);

sql.id = function id(name, allowed) {
  const list = allowed instanceof Set ? allowed : new Set(Array.isArray(allowed) ? allowed : Object.values(allowed || {}));
  const n = String(name);
  if (!list.has(n) || !IDENT.test(n)) throw new Error(`[sql] ${JSON.stringify(n).slice(0, 60)} is not one of the allowed names`);
  return new Sql(/[A-Z]/.test(n) ? `"${n}"` : n, []);   // a camelCase alias is quoted, as Postgres would fold it
};

// A name read from Postgres's own catalog (pg_class, pg_trigger), quoted the
// way quote_ident quotes it: whatever it holds, it can only ever be a name.
sql.ident = function ident(name) {
  const n = String(name);
  if (!n || n.includes("\0")) throw new Error("[sql] an identifier can't be empty or hold a NUL");
  return new Sql('"' + n.replace(/"/g, '""') + '"', []);
};

sql.pick = function pick(key, table) {
  const k = String(key);
  if (!table || !Object.prototype.hasOwnProperty.call(table, k)) throw new Error(`[sql] ${JSON.stringify(k).slice(0, 60)} is not one of the choices`);
  const v = table[k];
  if (v instanceof Sql) return v;
  if (typeof v !== "string") throw new TypeError("[sql] a pick table holds text or Sql");
  return new Sql(v, []);
};

sql.join = function join(parts, sep = sql`, `) {
  if (!(sep instanceof Sql)) throw new TypeError("[sql] join's separator is a Sql: sql` AND `");
  const list = parts.filter(p => p != null && p !== false);
  for (const p of list) if (!(p instanceof Sql)) throw new TypeError("[sql] join takes Sql pieces only");
  if (!list.length) return EMPTY;
  return new Sql(list.map(p => p.text).join(sep.text), list.flatMap((p, i) => i ? [...sep.values, ...p.values] : p.values));
};

sql.empty = EMPTY;
sql.isSql = (x) => x instanceof Sql;

// (statement, params) for a db helper: a Sql brings its own values; an older
// caller's text and params pass through untouched.
function toQuery(text, params) {
  if (!(text instanceof Sql)) return [text, params];
  if (text.values.length && params && params.length) throw new Error("[sql] a Sql with bound values takes no params array beside it");
  return [text.text, text.values.length ? text.values : (params || [])];
}

module.exports = { sql, Sql, toQuery };
