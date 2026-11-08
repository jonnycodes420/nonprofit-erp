// server/donors/ownerName.js · INTEGRITY-1 (W-1107-Donors-11). ONE OWNER FIELD.
//
// The owner of a person is donors.assigned_to, a user id. The Owner filter
// and the portfolio bar read that id (and the user's name from `users`), but
// the Owner column printed donors.assigned_to_name, a copy of the name taken
// when she was assigned. A user renamed since ("Admin User" → "Mike") left
// the copy behind, so Owner = Mike returned a row whose Owner said Admin
// User. Now every face names the owner from the users row the id points at;
// the stored copy is only a fallback for an id with no user left.
"use strict";

// SQL: the owner's name for a donors row (alias `t`), live from users.
const OWNER_NAME_SQL = (t = "donors") =>
  `COALESCE((SELECT u.name FROM users u WHERE u.id = ${t}.assigned_to), ${t}.assigned_to_name)`;

// Rows read with assigned_to / assigned_to_name: rewrite the name from users, in one query.
async function withLiveOwnerNames(query, rows) {
  const ids = [...new Set(rows.map(r => r.assigned_to).filter(Boolean))];
  if (!ids.length) return rows;
  const names = new Map((await query("SELECT id, name FROM users WHERE id = ANY(?)", [ids])).map(u => [u.id, u.name]));
  for (const r of rows) if (r.assigned_to && names.get(r.assigned_to)) r.assigned_to_name = names.get(r.assigned_to);
  return rows;
}

module.exports = { OWNER_NAME_SQL, withLiveOwnerNames };
