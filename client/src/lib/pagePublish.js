// lib/pagePublish.js · POLISH-8. A LIVE GIVING PAGE CAN BE TAKEN DOWN.
//
// Fundraising's page card offered only Remove, so Year-end 2026 was left live.
// Live → Unpublish puts it back to Draft (status 'draft'): its link then says
// "This page isn't taking gifts right now" (server/org/publicPages.js) and no
// gift can be made through it. Draft → Publish puts it back. Remove still asks
// first (RemoveMenu's confirm). Each change offers Undo.
import { apiFetch } from "../api";
import { offerUndo } from "../components/EditHistory";

const setStatus = (p, status) => apiFetch(`/giving-pages/${p.id}`, { method: "PUT", body: JSON.stringify({ status }) });

export const isDraftPage = p => !!p && p.status === "draft";

// The items above Remove in the card's More menu.
// FLOWS-8 (W-1112-Fundraising-35): Publish on a page that can't take gifts
// (Stripe not connected) says so first, and goes ahead only on a yes.
export function publishItems(p, onChanged, { takesGifts = true } = {}) {
  if (!p || p.page_kind === "volunteer") return [];
  const flip = async (to, word) => {
    if (to === "active" && takesGifts === false) {
      const { askConfirm } = await import("../components/ConfirmDialog");
      const yes = await askConfirm({ title: "This page can't take gifts yet",
        body: "Connect Stripe to take gifts on this page. Until then its address shows donors a polite \"Not open yet\" page. Publish it anyway, so it is ready the moment Stripe is connected?",
        yes: "Publish anyway" });
      if (!yes) return;
    }
    await setStatus(p, to);
    onChanged && onChanged();
    offerUndo({ message: `${word} ${p.title}.`, undoAction: async () => { const r = await setStatus(p, p.status); onChanged && onChanged(); return r; } }, word);
  };
  return isDraftPage(p)
    ? [{ label: "Publish", testid: "page-publish", onClick: () => flip("active", "Published") }]
    : [{ label: "Unpublish", testid: "page-unpublish", onClick: () => flip("draft", "Unpublished") }];
}
