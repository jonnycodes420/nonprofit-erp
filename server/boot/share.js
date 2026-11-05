// SPLIT-2: the names server.js's statements share, now that they live in server/boot/.
// In one file every top-level name was one binding. Here each module keeps its own copy of
// the names it reads (register), and share() refreshes every copy: after each statement that
// declares a name, and after each later write to one (a lazy import landing, a status a
// sweep recomputes). So any read, in any module, sees what it saw in the one file.
const ctx = Object.create(null);
const binds = [];
function register(bind) { binds.push(bind); bind(ctx); }
function share(names) {
  Object.assign(ctx, names);
  for (const bind of binds) bind(ctx);
}
module.exports = { ctx, register, share };
