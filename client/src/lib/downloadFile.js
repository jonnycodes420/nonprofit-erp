// FIX-20 Part 0: a private file (a conversation attachment, a grant document)
// is fetched WITH the session and saved from the bytes. A bare link would carry
// no session, and the server now refuses any file request without one, so a
// copied link opened in another browser is a 404.
import { API, getToken } from "../api";

export async function downloadFile(path, fileName) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(res.status === 404 ? "That file is no longer available. Reload the page and try again." : "That file did not download.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = fileName || "file";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
