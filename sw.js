/* Colecta — service worker mínimo: habilita instalar la app y recibir enlaces compartidos.
   No guarda nada en caché: siempre se usa la última versión publicada. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  // No intervenir en descargas (por ejemplo, el APK): solo páginas de la app
  const p = new URL(e.request.url).pathname;
  if (!/(\/|\.html)$/.test(p)) return;
  e.respondWith(fetch(e.request).catch(() => new Response("<meta charset=utf-8><p style='font:16px system-ui;padding:24px'>Colecta necesita conexión a internet.</p>", { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
