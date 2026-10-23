/*
 * Cross-origin isolation service worker.
 * Static hosts such as GitHub Pages cannot send COOP/COEP headers, but the
 * Python runtime needs SharedArrayBuffer (blocking sleep, synchronous GPIO
 * reads, Stop). This worker re-serves same-origin responses with
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 * Approach based on the well-known coi-serviceworker technique (MIT).
 */
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 0) return res;
          const headers = new Headers(res.headers);
          headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');
          headers.set('Cross-Origin-Resource-Policy', 'same-origin');
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
        })
        .catch((e) => {
          console.error(e);
          return Response.error();
        }),
    );
  });
} else {
  (() => {
    // Reload once the worker is active, so the next navigation is served with
    // the isolation headers. Waiting for `ready` (instead of reloading on
    // `updatefound`) avoids a race where the reloaded page is not yet
    // controlled and stays non-isolated. The counter stops reload loops.
    const KEY = 'coiReloads';
    if (window.crossOriginIsolated) {
      sessionStorage.removeItem(KEY);
      return;
    }
    if (!window.isSecureContext || !navigator.serviceWorker) {
      console.warn('[coi] cannot enable cross-origin isolation (needs HTTPS and service workers)');
      return;
    }
    const reloads = Number(sessionStorage.getItem(KEY) || 0);
    navigator.serviceWorker
      .register(document.currentScript.src)
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (window.crossOriginIsolated || reloads >= 2) return;
        sessionStorage.setItem(KEY, String(reloads + 1));
        window.location.reload();
      })
      .catch((e) => console.warn('[coi] service worker registration failed', e));
  })();
}
