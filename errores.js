/* Colecta — registro de errores con Sentry (plan gratuito).
   Solo envía el error y en qué parte del código ocurrió. Nada de cuentas, correos ni
   contenido: sin datos personales, sin migas de pan (breadcrumbs) y la dirección sin
   lo que va después de «?» o «#» (ahí llegan los enlaces y textos compartidos). */
(function () {
  if (!window.Sentry || location.hostname !== "marianittem78.github.io") return;
  const limpiar = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return ""; } };
  Sentry.init({
    dsn: "https://517a263beb45e7c11d4d16fde0723d71@o4512501943107584.ingest.de.sentry.io/4512501986820176",
    environment: "produccion",
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    beforeSend(ev) {
      if (ev.request) ev.request = { url: limpiar(ev.request.url || location.href) };
      delete ev.user;
      return ev;
    },
  });
})();
