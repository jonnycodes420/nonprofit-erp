// lib/atlasThread.js · ATLAS-3. TELL ME MORE CONTINUES THE CONVERSATION.
//
// "Tell me more" used to clear the dialog: the answer went, and the next ask
// knew nothing about the one before. Now the answers so far stay on screen,
// and the next ask carries the last one's id (followsId), so "remind me to
// call her" after "tell me about Marlowe" is about Marlowe. Pure functions,
// so the suite reads the same code the dialog runs.
export const THREAD_MAX = 6;

// The answer she just read joins the thread; nothing already in it is lost.
export function continueThread(thread, request) {
  const prior = Array.isArray(thread) ? thread : [];
  if (!request || !request.id || prior.some(r => r && r.id === request.id)) return prior;
  return [...prior, request].slice(-THREAD_MAX);
}
export const followsIdOf = thread => (Array.isArray(thread) && thread.length ? thread[thread.length - 1].id : null);

// What the next ask sends: her words, and which request it follows.
export function askBody(text, { source = "typed", donorId, thread, progressKey } = {}) {
  const followsId = followsIdOf(thread);
  return { text, source, ...(donorId ? { donorId } : {}), ...(followsId ? { followsId } : {}), ...(progressKey ? { progressKey } : {}) };
}
export const newProgressKey = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
