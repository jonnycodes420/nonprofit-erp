// shared/emailMerge.js · BUILDER-3 item 2. TWO PEOPLE ON ONE EMAIL, AND NOTHING LOST.
//
// Pure: no DB, no network, no clock. The server merges a save that started from an older
// version (routes/emailTemplates.js saveTemplate), and the browser merges what someone else
// saved into what is on its screen, and into each step of its own undo, the same way: so Undo
// takes back only your own changes (client/src/components/email-builder/useEmailBuilder.js).
//
// Every block carries an `id`. A block saved before ids existed gets a place id from where it
// stands ("p0", "p1", …): everyone who opened that version gives it the same id, and the
// next save keeps it. A new block gets a fresh id (newBlockId).
//
// The merge is three-way, block by block: base (the version both started from), theirs (what
// is saved now) and mine (what this person has). A block one side changed and the other did
// not takes the change. A block both changed takes `prefer` (mine, unless the other person
// holds that block: lockedByOthers), and is named in `conflicts`. A block one side removed is
// gone, unless the other side changed it. The order is the side that moved blocks; the
// blocks only the other side added go in after the block they followed there. The footer
// stays last.

const ID = /^[A-Za-z0-9_-]{1,40}$/;

export function newBlockId() {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "b";
  for (let i = 0; i < 11; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

// Every block with an id; a missing or repeated one is given one (a place id when missing,
// a fresh one when repeated). Returns a new list; the blocks themselves are copied shallowly.
export function withIds(blocks) {
  const seen = new Set();
  return (Array.isArray(blocks) ? blocks : []).map((b, i) => {
    let id = b && typeof b.id === "string" && ID.test(b.id) ? b.id : "p" + i;
    if (seen.has(id)) id = newBlockId();
    seen.add(id);
    return { ...b, id };
  });
}

// The same JSON whatever order its keys were written in. The editor's own key (_k) is not
// part of a block.
export function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).filter(k => k !== "_k" && v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
const same = (a, b) => stable(a) === stable(b);

// The ids whose block differs between two versions (changed, added or removed).
export function changedIds(from, to) {
  const A = new Map(withIds(from).map(b => [b.id, b])), B = new Map(withIds(to).map(b => [b.id, b]));
  const out = new Set();
  for (const [id, b] of B) if (!A.has(id) || !same(A.get(id), b)) out.add(id);
  for (const id of A.keys()) if (!B.has(id)) out.add(id);
  return out;
}

// Did the blocks both lists hold change their order against base?
function moved(base, list) {
  const inList = new Set(list.map(b => b.id));
  const a = base.map(b => b.id).filter(id => inList.has(id));
  const inBase = new Set(a);
  const c = list.map(b => b.id).filter(id => inBase.has(id));
  return a.join(" ") !== c.join(" ");
}

export function mergeBlocks({ base, theirs, mine, prefer = "mine", lockedByOthers = null }) {
  const B = withIds(base), T = withIds(theirs), M = withIds(mine);
  const bm = new Map(B.map(b => [b.id, b])), tm = new Map(T.map(b => [b.id, b])), mm = new Map(M.map(b => [b.id, b]));
  const locked = lockedByOthers instanceof Set ? lockedByOthers : new Set(lockedByOthers || []);
  const keep = new Map();
  const conflicts = [], held = [];
  for (const id of new Set([...bm.keys(), ...tm.keys(), ...mm.keys()])) {
    const b = bm.get(id), t = tm.get(id), m = mm.get(id);
    if (!b) { keep.set(id, m || t); continue; }                       // added on one side
    const mc = m ? !same(m, b) : true, tc = t ? !same(t, b) : true;   // a removal is a change
    if (m && t) {
      if (mc && tc && !same(m, t)) {
        const mineWins = prefer === "mine" && !locked.has(id);
        if (locked.has(id)) held.push(id);
        conflicts.push(id);
        keep.set(id, mineWins ? m : t);
      } else keep.set(id, mc ? m : t);
      if (mc && !tc && locked.has(id)) { held.push(id); keep.set(id, t); }
    } else if (m && !t) { if (mc) keep.set(id, m); }                 // they removed it: gone unless I changed it
    else if (!m && t) { if (tc) keep.set(id, t); }                   // I removed it: gone unless they changed it
  }
  // The order: the side that moved blocks (mine when both did); the other side's own new
  // blocks go in after the block they followed on that side.
  const mineFirst = moved(B, M) || !moved(B, T);
  const primary = mineFirst ? M : T, other = mineFirst ? T : M;
  const order = primary.map(b => b.id).filter(id => keep.has(id));
  for (let i = 0; i < other.length; i++) {
    const id = other[i].id;
    if (!keep.has(id) || order.includes(id)) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const k = order.indexOf(other[j].id); if (k >= 0) { at = k + 1; break; } }
    order.splice(at, 0, id);
  }
  // Anything kept that neither list placed (a block I changed that they removed): after its base neighbour.
  for (const id of keep.keys()) if (!order.includes(id)) {
    const bi = B.findIndex(b => b.id === id);
    let at = order.length;
    for (let j = bi - 1; j >= 0; j--) { const k = order.indexOf(B[j].id); if (k >= 0) { at = k + 1; break; } }
    order.splice(at, 0, id);
  }
  let blocks = order.map(id => keep.get(id));
  const foot = blocks.filter(b => b.type === "footer");
  if (foot.length) blocks = [...blocks.filter(b => b.type !== "footer"), ...foot];
  return { blocks, conflicts, held };
}

// The email's own settings, field by field, the same way.
export function mergeMeta({ base, theirs, mine, keys = ["name", "subject", "preheader"] }) {
  const out = {};
  for (const k of keys) {
    const b = base ? base[k] : undefined, t = theirs ? theirs[k] : undefined, m = mine ? mine[k] : undefined;
    out[k] = m !== b ? m : t;
  }
  return out;
}
