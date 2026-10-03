// CONTENT-1 · what the prerender build gives a marketing page that asks who is
// signed in: nobody. pricing.jsx imports useAuth from main.jsx, and main.jsx
// mounts the whole app on import, so vite.prerender.config.js points that one
// import here instead. In the browser the real main.jsx is used.
export const useAuth = () => ({ auth: null, login() {}, logout() {}, refreshOrg: async () => null });
