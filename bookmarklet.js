(async (force) => {
  /* Colecta — marcador para Instagram, YouTube y Facebook.
     Recuerda (en este navegador) qué enlaces de cada colección ya copiaste,
     y en la próxima lectura solo trae los nuevos. */
  document.querySelectorAll("#colecta-panel").forEach((n) => n.remove());
  const box = document.createElement("div");
  box.id = "colecta-panel";
  box.style.cssText = "position:fixed;box-sizing:border-box;z-index:2147483647;right:16px;bottom:16px;width:340px;max-width:calc(100vw - 32px);padding:16px;border-radius:12px;background:#1f1c18;color:#f6f3ee;font:14px/1.45 system-ui;box-shadow:0 8px 30px rgba(0,0,0,.35)";
  document.body.appendChild(box);
  // Sin innerHTML: YouTube exige Trusted Types
  const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
  const btnCss = "margin-top:10px;margin-right:8px;padding:8px 12px;border:0;border-radius:8px;font-weight:700;cursor:pointer;";
  const say = (msg, extra) => {
    const close = el("button", "position:absolute;top:8px;right:10px;border:0;background:none;color:#f6f3ee;font-size:20px;line-height:1;cursor:pointer;opacity:.7", "×");
    close.title = "Cerrar"; close.onclick = () => box.remove();
    box.replaceChildren(close, el("b", "font:700 15px system-ui", "Colecta"), el("div", "margin-top:6px;padding-right:16px", msg));
    if (extra) box.appendChild(extra);
  };
  // Dirección de Colecta (la completa la app al armar el marcador)
  const COLECTA = "__COLECTA_URL__";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const host = location.hostname;

  // Memoria de enlaces ya copiados, por colección, en este sitio
  const KEY = (net, id) => "colecta:known:" + net + ":" + id;
  const loadKnown = (net, id) => { try { return new Set(JSON.parse(localStorage.getItem(KEY(net, id)) || "[]")); } catch { return new Set(); } };
  const saveKnown = (net, id, urls) => { try { const s = loadKnown(net, id); urls.forEach((u) => s.add(u)); localStorage.setItem(KEY(net, id), JSON.stringify([...s])); } catch {} };

  function noneNew(sources) {
    const wrap = el("div");
    const again = el("button", btnCss + "background:#e07a4b;color:#fff", "Traer todo igual");
    again.onclick = () => run(true);
    const close = el("button", btnCss + "background:#3a3530;color:#f6f3ee", "Cerrar");
    close.onclick = () => box.remove();
    wrap.append(again, close);
    const names = sources.map((s) => "«" + s.name + "»").join(", ");
    say("No hay enlaces nuevos en " + names + ". Ya los importaste antes.", wrap);
  }

  function finish(net, out, sources) {
    if (!out.length) return noneNew(sources);
    const payload = JSON.stringify({ colecta: 2, source: net, exportedAt: new Date().toISOString(), sources: sources.map((s) => ({ net, id: s.id, name: s.name, count: out.filter((i) => i.sourceId === s.id).length })), items: out });
    const blob = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const remember = () => sources.forEach((s) => saveKnown(net, s.id, [...s.known, ...out.filter((i) => i.sourceId === s.id).map((i) => i.url)]));
    const wrap = el("div", "margin-top:4px");
    const btn = el("button", btnCss + "background:#3a3530;color:#f6f3ee", "Copiar para Colecta");
    const a = el("a", "color:#f6f3ee;margin-left:4px", "Descargar archivo");
    a.href = blob; a.download = "colecta-" + net + ".json";
    a.onclick = () => { remember(); setTimeout(() => box.remove(), 500); };
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(payload);
        remember();
        say("Copiado. Pegalo en Colecta → Importar y elegí a qué colección agregarlo.");
        setTimeout(() => { box.remove(); URL.revokeObjectURL(blob); }, 1500);
      } catch { btn.textContent = "No se pudo copiar, usá Descargar"; }
    };
    if (/^https:\/\//.test(COLECTA)) {
      // Abre Colecta y le pasa el paquete directamente; Colecta confirma cuando lo recibe
      const go = el("button", btnCss + "background:#e07a4b;color:#fff", "Abrir en Colecta");
      go.onclick = () => {
        try { navigator.clipboard.writeText(payload).catch(() => {}); } catch {}
        const origin = new URL(COLECTA).origin;
        const w = window.open(COLECTA + "#recibir", "_blank");
        if (!w) { go.textContent = "Permití ventanas emergentes"; return; }
        let sent = false;
        const onMsg = (e) => {
          if (e.origin !== origin || e.source !== w || !e.data) return;
          if (e.data.type === "colecta:ready" && !sent) { sent = true; w.postMessage({ type: "colecta:payload", payload }, origin); }
          if (e.data.type === "colecta:received") {
            window.removeEventListener("message", onMsg); remember();
            say("Listo: Colecta recibió " + out.length + " enlaces. Seguí en la pestaña de Colecta.");
            setTimeout(() => { box.remove(); URL.revokeObjectURL(blob); }, 4000);
          }
        };
        window.addEventListener("message", onMsg);
        say("Abriendo Colecta… Si no se abre, usá «Copiar para Colecta».", wrap);
      };
      wrap.append(go);
    }
    wrap.append(btn, a, el("div", "margin-top:8px;opacity:.75", /^https:\/\//.test(COLECTA) ? "«Abrir en Colecta» importa directo. También podés copiar y pegarlo en Colecta → Importar." : "Después, en Colecta → Importar, pegalo."));
    const known = sources.reduce((n, s) => n + s.skipped, 0);
    say(out.length + " enlaces nuevos" + (known ? " (" + known + " ya importados, omitidos)" : "") + " en " + sources.map((s) => "«" + s.name + "»").join(", ") + ".", wrap);
  }

  /* ================= Instagram ================= */
  async function instagram(force) {
    const H = { "X-IG-App-ID": "936619743392459", "X-Requested-With": "XMLHttpRequest" };
    const get = async (u) => { const r = await fetch(u, { headers: H, credentials: "include" }); if (!r.ok) throw new Error("Instagram respondió " + r.status); return r.json(); };
    say("Buscando la colección…");
    const cols = [];
    try {
      let max = "";
      do {
        const j = await get("/api/v1/collections/list/?collection_types=%5B%22MEDIA%22%5D" + (max ? "&max_id=" + encodeURIComponent(max) : ""));
        cols.push(...(j.items || []));
        max = j.more_available ? j.next_max_id : "";
      } while (max);
    } catch (e) { /* seguimos con la URL */ }
    const m = location.pathname.match(/\/saved\/([^/]+)\/(\d+)/);
    const targets = m
      ? [{ id: m[2], name: (cols.find((c) => String(c.collection_id) === m[2]) || {}).collection_name || decodeURIComponent(m[1]) }]
      : cols.map((c) => ({ id: String(c.collection_id), name: c.collection_name }));
    if (!targets.length) { say("No encontré colecciones. Abrí una colección guardada y volvé a intentar."); return; }
    const out = [];
    for (const [ti, t] of targets.entries()) {
      t.known = force ? new Set() : loadKnown("instagram", t.id);
      t.skipped = 0;
      say((t.known.size ? "Comprobando enlaces nuevos en «" : "Leyendo «") + t.name + "» (" + (ti + 1) + "/" + targets.length + ")…");
      let max = "", reachedKnown = false;
      do {
        const j = await get("/api/v1/feed/collection/" + t.id + "/posts/" + (max ? "?max_id=" + encodeURIComponent(max) : ""));
        for (const it of j.items || []) {
          const md = it.media || it;
          if (!md || !md.code) continue;
          const url = "https://www.instagram.com/" + (md.product_type === "clips" ? "reel" : "p") + "/" + md.code + "/";
          if (t.known.has(url)) { t.skipped++; reachedKnown = true; continue; }
          const cap = (md.caption && md.caption.text) || "";
          const img = (md.image_versions2 || (md.carousel_media && md.carousel_media[0] && md.carousel_media[0].image_versions2) || {}).candidates || [];
          out.push({
            net: "instagram", sourceId: t.id, collection: t.name, url,
            title: cap.split("\n")[0].replace(/#[^\s#]+/g, "").trim().slice(0, 140),
            author: md.user && md.user.username ? "@" + md.user.username : "",
            text: cap, thumb: img.length ? img[img.length - 1].url : "",
            savedAt: md.taken_at ? md.taken_at * 1000 : null,
          });
        }
        // Lo más reciente viene primero: al llegar a enlaces conocidos, lo demás ya está importado
        if (reachedKnown) break;
        say("Leyendo «" + t.name + "»… " + out.length + " nuevos");
        max = j.more_available ? j.next_max_id : "";
        await sleep(500);
      } while (max);
    }
    finish("instagram", out, targets);
  }

  /* ================= YouTube ================= */
  async function youtube(force) {
    const cfg = (k) => (window.ytcfg && window.ytcfg.get ? window.ytcfg.get(k) : undefined);
    const context = cfg("INNERTUBE_CONTEXT");
    const key = cfg("INNERTUBE_API_KEY");
    if (!context) throw new Error("no encontré la configuración de YouTube; recargá la página");
    async function authHeader() {
      const c = document.cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/);
      if (!c) return {};
      const ts = Math.floor(Date.now() / 1000);
      const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + c[1] + " " + location.origin));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return { Authorization: "SAPISIDHASH " + ts + "_" + hex, "X-Origin": location.origin, "X-Goog-AuthUser": String(cfg("SESSION_INDEX") || 0) };
    }
    async function api(path, body) {
      const r = await fetch("/youtubei/v1/" + path + "?prettyPrint=false" + (key ? "&key=" + key : ""), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ context, ...body }),
      });
      if (!r.ok) throw new Error("YouTube respondió " + r.status);
      return r.json();
    }
    const walk = (node, fn) => { if (!node || typeof node !== "object") return; fn(node); for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, fn); };
    const txt = (t) => (t ? t.simpleText || (t.runs || []).map((r) => r.text).join("") || t.content || "" : "");
    function parseVideos(data, acc) {
      let token = null;
      walk(data, (n) => {
        const v = n.playlistVideoRenderer;
        if (v && v.videoId) acc.push({ id: v.videoId, title: txt(v.title), author: txt(v.shortBylineText) });
        const lk = n.lockupViewModel;
        if (lk && lk.contentId && lk.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
          const md = lk.metadata && lk.metadata.lockupMetadataViewModel;
          acc.push({ id: lk.contentId, title: md ? txt(md.title) : "", author: "" });
        }
        if (n.continuationCommand && n.continuationCommand.token) token = n.continuationCommand.token;
      });
      return token;
    }
    function playlistTitle(data, fallback) {
      let t = "";
      walk(data, (n) => {
        if (t) return;
        if (n.playlistMetadataRenderer) t = n.playlistMetadataRenderer.title;
        else if (n.playlistHeaderRenderer) t = txt(n.playlistHeaderRenderer.title);
        else if (n.pageHeaderViewModel && n.pageHeaderViewModel.title) t = txt(n.pageHeaderViewModel.title.dynamicTextViewModel && n.pageHeaderViewModel.title.dynamicTextViewModel.text);
      });
      return t || fallback;
    }
    const u = new URL(location.href);
    let lists = [];
    if (u.searchParams.get("list")) lists = [u.searchParams.get("list")];
    else {
      const ids = new Set();
      document.querySelectorAll('a[href*="list="]').forEach((a) => { try { const id = new URL(a.href).searchParams.get("list"); if (id && !/^RD/.test(id)) ids.add(id); } catch {} });
      lists = [...ids];
    }
    if (!lists.length) { say("Abrí una lista de reproducción (youtube.com/playlist?list=…) o la página «Tú → Listas de reproducción» y volvé a tocar el marcador."); return; }

    const out = [], sources = [];
    for (const [li, list] of lists.entries()) {
      const known = force ? new Set() : loadKnown("youtube", list);
      say((known.size ? "Comprobando videos nuevos" : "Leyendo la lista") + " (" + (li + 1) + "/" + lists.length + ")…");
      // 1) Lista rápida de IDs (100 por pedido)
      const vids = [];
      let data = await api("browse", { browseId: "VL" + list });
      const name = playlistTitle(data, list === "WL" ? "Ver más tarde" : list === "LL" ? "Videos que me gustan" : list);
      let token = parseVideos(data, vids);
      while (token) {
        say("Comprobando «" + name + "»… " + vids.length + " videos revisados");
        data = await api("browse", { continuation: token });
        const before = vids.length;
        token = parseVideos(data, vids);
        if (vids.length === before) break;
        await sleep(300);
      }
      const seen = new Set();
      const uniq = vids.filter((v) => !seen.has(v.id) && seen.add(v.id));
      const fresh = uniq.filter((v) => !known.has("https://www.youtube.com/watch?v=" + v.id));
      sources.push({ id: list, name, known, skipped: uniq.length - fresh.length });
      if (!fresh.length) continue;
      // 2) Detalles solo de los nuevos
      let done = 0;
      const queue = fresh.slice();
      async function worker() {
        while (queue.length) {
          const v = queue.shift();
          v.text = ""; v.tags = [];
          try {
            const nx = await api("next", { videoId: v.id });
            let desc = "", owner = "";
            walk(nx, (n) => {
              if (!desc && n.expandableVideoDescriptionBodyRenderer && n.expandableVideoDescriptionBodyRenderer.attributedDescriptionBodyText) desc = n.expandableVideoDescriptionBodyRenderer.attributedDescriptionBodyText.content || "";
              if (!desc && n.videoSecondaryInfoRenderer && n.videoSecondaryInfoRenderer.attributedDescription) desc = n.videoSecondaryInfoRenderer.attributedDescription.content || "";
              if (!owner && n.videoOwnerRenderer) owner = txt(n.videoOwnerRenderer.title);
              if (!v.title && n.videoPrimaryInfoRenderer) v.title = txt(n.videoPrimaryInfoRenderer.title);
            });
            v.text = desc; v.author = v.author || owner;
          } catch {}
          try {
            const p = await api("player", { videoId: v.id });
            const d = p.videoDetails || {};
            v.title = v.title || d.title || "";
            v.author = v.author || d.author || "";
            v.text = v.text || d.shortDescription || "";
            v.tags = (d.keywords || []).slice(0, 8).map((k) => "#" + k.toLowerCase().replace(/\s+/g, ""));
            const mf = p.microformat && p.microformat.playerMicroformatRenderer;
            v.date = (mf && (mf.publishDate || mf.uploadDate)) || "";
          } catch {}
          done++;
          if (done % 5 === 0 || done === fresh.length) say("«" + name + "»: " + fresh.length + " nuevos, leyendo detalles " + done + "/" + fresh.length);
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);
      fresh.forEach((v) => out.push({
        net: "youtube", sourceId: list, collection: name, videoId: v.id,
        url: "https://www.youtube.com/watch?v=" + v.id,
        title: v.title, author: v.author, text: v.text || "",
        hashtags: [...new Set([...((v.text || "").toLowerCase().match(/#[\p{L}\p{N}_]{2,}/gu) || []), ...(v.tags || [])])],
        thumb: "https://i.ytimg.com/vi/" + v.id + "/mqdefault.jpg",
        enriched: true, savedAt: v.date ? Date.parse(v.date) || null : null,
      }));
    }
    finish("youtube", out, sources);
  }

  /* ================= Facebook ================= */
  async function facebook(force) {
    if (!/^\/saved/.test(location.pathname)) { say("Abrí facebook.com/saved y entrá a una colección, después volvé a tocar el marcador."); return; }
    const main = document.querySelector('[role="main"]') || document.body;
    const params = new URL(location.href).searchParams;
    const listId = params.get("list_id") || "all";
    let name = "";
    const active = params.get("list_id") && document.querySelector('a[href*="list_id=' + params.get("list_id") + '"]');
    if (active) name = active.innerText.split("\n")[0].trim();
    if (!name) { const h = main.querySelector("h1, h2"); name = h ? h.innerText.trim() : ""; }
    if (!name || /^(guardado|saved|elementos guardados|todo)$/i.test(name)) name = params.get("list_id") ? name || "Colección de Facebook" : "Guardados de Facebook";
    const known = force ? new Set() : loadKnown("facebook", listId);
    const src = { id: listId, name, known, skipped: 0 };

    const found = new Map(), seenKnown = new Set(), unavailable = new Set();
    const UNAVAILABLE = /(contenido|publicaci[oó]n|enlace|video|elemento)[^\n]{0,40}no (est[aá] )?disponible|no est[aá] disponible|(content|post|link|video|item)[^\n]{0,40}(isn['’]t|is not|not|no longer) available|this content isn['’]t available|unavailable/i;
    const clean = (href) => {
      try {
        const u = new URL(href, location.origin);
        if (/^l\.facebook\.com$/.test(u.hostname) && u.searchParams.get("u")) return u.searchParams.get("u");
        [...u.searchParams.keys()].filter((k) => /^(__cft__|__tn__|fbclid|ref|mibextid|rdid|share_url|eid|paipv|hc_ref|notif_id|notif_t|comment_id|refsrc|_rdr|idorvanity)/.test(k)).forEach((k) => u.searchParams.delete(k));
        u.hash = "";
        return u.toString();
      } catch { return null; }
    };
    // Enlaces de navegación de Facebook que no son elementos guardados
    const nav = /facebook\.com\/(saved|bookmarks|settings|help|policies|privacy|notifications|messages|friends|watch\/?$|marketplace\/?$|groups\/?$|gaming\/?$|events\/?$|hashtag\/|search\/|ads\/|pages\/?$|me\/?$|home\.php|\?)/i;
    // Tarjeta del elemento: el contenedor más grande que no incluye enlaces de otro elemento
    let itemAnchors = new Map();
    const cardOf = (a, url) => {
      let c = a;
      for (let i = 0; i < 12 && c.parentElement && c.parentElement !== main; i++) {
        const up = c.parentElement;
        let other = false;
        for (const x of up.querySelectorAll("a[href]")) { const u2 = itemAnchors.get(x); if (u2 && u2 !== url) { other = true; break; } }
        if (other) break;
        c = up;
      }
      return c;
    };
    const isAuthorLink = (a) => {
      let p = a.parentElement;
      const t = (a.innerText || "").trim();
      for (let i = 0; i < 3 && p && t; i++, p = p.parentElement) {
        const all = p.innerText || "";
        const before = all.slice(0, all.indexOf(t));
        if (/(guardad[oa]s? (de|desde)|saved from|de la publicaci[oó]n de)\s*$/i.test(before.trim() + " ") || /(guardad[oa]s? (de|desde)|saved from)\s*$/i.test(before.trim())) return true;
      }
      return false;
    };
    function collect() {
      // 1) Enlaces candidatos (sin navegación ni enlaces al autor)
      itemAnchors = new Map();
      main.querySelectorAll("a[href]").forEach((a) => {
        const url = clean(a.href);
        if (!url || !/^https?:/.test(url) || nav.test(url) || /facebook\.com\/?$/.test(url)) return;
        if (isAuthorLink(a)) return;
        itemAnchors.set(a, url);
      });
      // 2) Cada enlace con su tarjeta
      itemAnchors.forEach((url, a) => {
        const card = cardOf(a, url);
        const text = (card.innerText || "").slice(0, 800);
        if (UNAVAILABLE.test(text)) { unavailable.add(url); return; }
        if (known.has(url)) { seenKnown.add(url); return; }
        const label = (a.getAttribute("aria-label") || a.innerText || "").trim();
        const hasImg = !!a.querySelector("img, image, svg image");
        if (label.length < 3 && !hasImg && !found.has(url)) return;
        const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
        const prev = found.get(url);
        const title = (label.length > 3 ? label : (prev && prev.title) || lines[0] || "").slice(0, 160);
        const author = (lines.find((l) => /^(guardad[oa]s? (de|desde)|saved from)/i.test(l)) || "").replace(/^(guardad[oa]s? de la publicaci[oó]n de|guardad[oa]s? (de|desde)|saved from)\s*/i, "").slice(0, 80);
        const img = card.querySelector("img[src]");
        if (!prev || title.length > (prev.title || "").length) {
          found.set(url, { net: "facebook", sourceId: listId, collection: name, url, title, author: author || (prev && prev.author) || "", text, thumb: img ? img.src : (prev && prev.thumb) || "", savedAt: null });
        }
      });
    }
    // Hace que Facebook cargue más elementos: lleva el último a la vista y desplaza todo lo desplazable
    function scrollMore() {
      const anchors = main.querySelectorAll("a[href]");
      const last = anchors[anchors.length - 1];
      if (last) last.scrollIntoView({ block: "end" });
      const se = document.scrollingElement || document.documentElement;
      se.scrollTop = se.scrollHeight;
      window.scrollTo(0, se.scrollHeight);
      let p = last && last.parentElement;
      while (p && p !== document.body) {
        if (p.scrollHeight > p.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) p.scrollTop = p.scrollHeight;
        p = p.parentElement;
      }
      main.querySelectorAll('[role="button"], button').forEach((b) => { if (/^(ver m[aá]s|see more|mostrar m[aá]s|show more|cargar m[aá]s|load more)$/i.test((b.innerText || "").trim())) b.click(); });
    }
    const busy = () => !!main.querySelector('[role="progressbar"], [aria-busy="true"], [data-visualcompletion="loading-state"]');

    say((known.size ? "Comprobando enlaces nuevos en «" : "Leyendo «") + name + "»… (Colecta desplaza la página sola, no hace falta que la toques)");
    await sleep(800);
    let lastTotal = -1, stable = 0;
    const startY = window.scrollY;
    for (let i = 0; i < 600; i++) {
      collect();
      const total = found.size + seenKnown.size + unavailable.size;
      say("Leyendo «" + name + "»… " + found.size + " nuevos" + (seenKnown.size ? ", " + seenKnown.size + " ya importados" : "") + (unavailable.size ? ", " + unavailable.size + " no disponibles" : "") + ". Colecta desplaza la página sola.");
      // Lo más reciente aparece arriba: tras varios ya importados, lo que sigue también lo está
      if (!force && seenKnown.size >= 3) break;
      if (total === lastTotal && !busy()) stable++; else stable = 0;
      if (stable >= 6) break;
      lastTotal = total;
      scrollMore();
      await sleep(stable ? 1500 : 1000);
    }
    collect();
    window.scrollTo(0, startY);
    src.skipped = seenKnown.size;
    if (!found.size && !seenKnown.size) { say(unavailable.size ? "Los " + unavailable.size + " elementos de esta colección no están disponibles en Facebook, así que no hay nada para importar." : "No encontré enlaces en esta página. Asegurate de estar dentro de una colección de facebook.com/saved."); return; }
    const out = [...found.values()];
    finish("facebook", out, [src]);
    if (unavailable.size) { const note = el("div", "margin-top:8px;opacity:.75", unavailable.size + " elementos no disponibles en Facebook se omitieron."); box.appendChild(note); }
  }

  async function run(force) {
    try {
      if (/(^|\.)instagram\.com$/.test(host)) await instagram(force);
      else if (/(^|\.)youtube\.com$/.test(host)) await youtube(force);
      else if (/(^|\.)facebook\.com$/.test(host)) await facebook(force);
      else say("Abrí una colección de Instagram, una lista de YouTube o una colección de facebook.com/saved, y volvé a tocar el marcador.");
    } catch (err) {
      say("No pude leer la colección: " + err.message + ". Verificá que tengas la sesión iniciada.");
    }
  }
  await run(!!force);
})();
