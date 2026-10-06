/* Colecta — parsers tolerantes para exportaciones de Meta (FB/IG) y Google Takeout (YouTube) */
(function () {
  const UNCAT = "Sin colección";

  // Meta exporta UTF-8 escapado como latin1 ("MarketÃ­ng") → lo arreglamos
  function fixText(s) {
    if (typeof s !== "string") return s;
    try { return decodeURIComponent(escape(s)); } catch { return s; }
  }

  const HASHTAG_RE = /#[\p{L}\p{N}_]{2,}/gu;
  function extractHashtags(text) {
    if (!text) return [];
    const m = String(text).match(HASHTAG_RE) || [];
    return [...new Set(m.map((h) => h.toLowerCase()))];
  }

  const STOP = new Set(("de la el en y a los las del un una para con por que se su al lo como mas más o es tu te mi sus the and of to in for on with how what your you is are this that from at by an be it as or our we my".split(" ")));
  function keywords(text, max = 6) {
    if (!text) return [];
    const words = String(text).toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/#[\p{L}\p{N}_]+/gu, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));
    const freq = Object.create(null); // sin prototipo: la palabra «constructor» no rompe el conteo
    words.forEach((w) => (freq[w] = (freq[w] || 0) + 1));
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
  }

  function normalizeName(s) {
    return String(s || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .toLowerCase().replace(/\s+/g, " ").trim();
  }

  function uid(net, url) { return net + ":" + url; }

  // Convierte string_map_data / label_values en una lista uniforme de campos
  function fieldsOf(entry) {
    const out = [];
    if (entry && entry.string_map_data) {
      for (const [label, v] of Object.entries(entry.string_map_data)) {
        out.push({ label: fixText(label), value: fixText(v?.value ?? ""), href: v?.href, ts: v?.timestamp });
      }
    }
    if (entry && Array.isArray(entry.label_values)) {
      for (const lv of entry.label_values) {
        out.push({ label: fixText(lv.label || ""), value: fixText(lv.value ?? ""), href: lv.href, ts: lv.timestamp_value || lv.timestamp });
        if (Array.isArray(lv.dict)) lv.dict.forEach((d) => out.push(...fieldsOf(d)));
      }
    }
    return out;
  }

  /* ---------------- Instagram ---------------- */
  function parseInstagram(json, fileName) {
    const items = [];
    const key = Object.keys(json || {}).find((k) => Array.isArray(json[k]));
    const arr = key ? json[key] : Array.isArray(json) ? json : [];
    const isCollections = /collection/i.test(fileName) || /collections/i.test(key || "");
    let current = isCollections ? null : UNCAT;

    for (const entry of arr) {
      const f = fieldsOf(entry);
      const withHref = f.find((x) => x.href && /instagram\.com/.test(x.href));
      const title = fixText(entry.title || "");
      if (!withHref) {
        // Cabecera de colección: {"title":"Collection","string_map_data":{"Name":{"value":"Marketing"}}}
        const name = f.find((x) => /^(name|nombre)$/i.test(x.label))?.value;
        if (name && (isCollections || /collection|colecci/i.test(title))) current = name;
        continue;
      }
      const author = (title && !/collection|colecci/i.test(title)) ? title : (withHref.value || "");
      const ts = f.find((x) => x.ts)?.ts;
      items.push({
        net: "instagram",
        collection: current || UNCAT,
        url: withHref.href,
        title: "",
        author,
        text: "",
        savedAt: ts ? ts * 1000 : null,
      });
    }
    return items;
  }

  /* ---------------- Facebook ---------------- */
  const FB_COLL_RES = [
    /to (?:his|her|their|your) ["“]?(.+?)["”]? collection/i,
    /to (?:the )?collection[:\s]+["“]?(.+?)["”]?\.?$/i,
    /(?:a|en) (?:su|la|tu) colecci[oó]n[:\s]+["“]?(.+?)["”]?\.?$/i,
    /colecci[oó]n ["“](.+?)["”]/i,
  ];
  function collFromTitle(t) {
    for (const re of FB_COLL_RES) { const m = t.match(re); if (m) return m[1].trim(); }
    return null;
  }
  function collectUrls(node, acc = []) {
    if (!node || typeof node !== "object") return acc;
    if (Array.isArray(node)) { node.forEach((n) => collectUrls(n, acc)); return acc; }
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && /^https?:\/\//.test(v) && /^(url|href|uri|source)$/i.test(k)) acc.push({ url: v, name: fixText(node.name || node.title || node.value || "") });
      else if (typeof v === "object") collectUrls(v, acc);
    }
    return acc;
  }
  function parseFacebook(json, fileName) {
    const items = [];
    const key = Object.keys(json || {}).find((k) => Array.isArray(json[k]));
    const arr = key ? json[key] : Array.isArray(json) ? json : [];
    for (const entry of arr) {
      const title = fixText(entry.title || "");
      const f = fieldsOf(entry);
      let coll = collFromTitle(title)
        || f.find((x) => /^(collection|colecci[oó]n|collection name|nombre de la colecci[oó]n)$/i.test(x.label))?.value
        || (entry.name && /collection/i.test(fileName) ? fixText(entry.name) : null);
      const urls = collectUrls(entry.attachments || entry).concat(f.filter((x) => x.href).map((x) => ({ url: x.href, name: x.value })));
      const seen = new Set();
      for (const u of urls) {
        if (seen.has(u.url) || /facebook\.com\/(saved|collections?)\b/.test(u.url)) continue;
        seen.add(u.url);
        const text = fixText(entry.data?.map?.((d) => d.post || d.text || "").join(" ") || "");
        items.push({
          net: "facebook",
          collection: coll || UNCAT,
          url: u.url,
          title: u.name && u.name !== u.url ? u.name : "",
          author: "",
          text,
          savedAt: entry.timestamp ? entry.timestamp * 1000 : null,
        });
      }
    }
    return items;
  }

  /* ---------------- YouTube (Takeout CSV) ---------------- */
  function parseCsv(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim()));
  }

  function parseYouTubePlaylistsIndex(text) {
    const rows = parseCsv(text); const map = Object.create(null);
    const h = rows[0] || [];
    const idIdx = h.findIndex((x) => /playlist id|id de la lista|id de lista/i.test(x));
    const tIdx = h.findIndex((x) => /title|t[ií]tulo/i.test(x) && !/video/i.test(x));
    if (idIdx < 0) return map;
    rows.slice(1).forEach((r) => { if (r[idIdx]) map[r[idIdx]] = r[tIdx] || r[idIdx]; });
    return map;
  }

  function parseYouTubePlaylist(text, fileName, playlistIndex) {
    const rows = parseCsv(text);
    let base = fileName.split("/").pop().replace(/\.csv$/i, "").replace(/[-_ ](videos|v[ií]deos)$/i, "").trim();
    // Formato antiguo: cabecera con Playlist Id/Title en las primeras líneas
    const oldHeader = rows.findIndex((r) => /^playlist id$/i.test(r[0] || ""));
    if (oldHeader >= 0 && rows[oldHeader + 1]) {
      const tIdx = rows[oldHeader].findIndex((x) => /^title$/i.test(x));
      if (tIdx >= 0 && rows[oldHeader + 1][tIdx]) base = rows[oldHeader + 1][tIdx];
    }
    if (playlistIndex && playlistIndex[base]) base = playlistIndex[base];
    const items = [];
    for (const r of rows) {
      const id = r[0];
      if (!/^[\w-]{11}$/.test(id || "")) continue;
      const ts = Date.parse((r[1] || "").replace(" UTC", "Z").replace(" ", "T"));
      items.push({
        net: "youtube",
        collection: base || UNCAT,
        url: "https://www.youtube.com/watch?v=" + id,
        videoId: id,
        title: "", author: "", text: "",
        savedAt: isNaN(ts) ? null : ts,
      });
    }
    return items;
  }

  /* ---------- Título rápido con reglas: se muestra hasta que llega el de la IA ---------- */
  const COLA = new Set("de del la el los las un una y o en a al con para por que su sus tu mi the and of to in for on with a an or".split(" "));
  const letras = (w) => (w.match(/\p{L}/gu) || []).length;
  function cleanTitle(s) {
    let t = String(s || "").normalize("NFKC")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\s(Publicaci[oó]n|Enlace|Reels?|Video|Foto|Evento)\s•\s.*$/i, " ") // pie de las tarjetas de Facebook
      .replace(/^\s*\d{1,2}:\d{2}(:\d{2})?\s+/, "") // duración de los videos
      .replace(/[#@][\p{L}\p{N}_.]+/gu, " ")
      .replace(/[\u{FE0F}\u{200D}]/gu, "")
      .replace(/[\p{Extended_Pictographic}\u{2600}-\u{27BF}\u{0950}]+/gu, " · ") // los emojis suelen cerrar una frase
      .replace(/\s*[|•·]+(\s*[|•·]+)*\s*/g, ". ")
      .replace(/^[.\s]+/, "")
      .replace(/\s+/g, " ").trim();
    // Primera frase con al menos dos palabras
    const partes = t.split(/(?<=[.!?…:])\s+|\s[-–]\s|\s?—/).map((x) => x.trim());
    // Si no hay frase de dos palabras, sirve una sola palabra con sentido («Locro»)
    let f = partes.find((x) => x.split(" ").filter((w) => letras(w)).length >= 2) || partes.find((x) => letras(x) >= 3) || "";
    if (!f) return "";
    // Mayúsculas: frase gritada → todo en minúscula; Title Case → minúscula salvo palabras con mayúsculas internas (DaVinci)
    const ls = f.match(/\p{L}/gu) || [];
    const words = f.split(" ");
    if (ls.filter((c) => c !== c.toLowerCase()).length / ls.length > 0.6) f = f.toLowerCase();
    else {
      const largas = words.slice(1).filter((w) => letras(w) >= 4); // la primera palabra siempre va con mayúscula: no cuenta
      const titleCase = largas.length >= 2 && largas.filter((w) => /^\P{L}*\p{Lu}/u.test(w)).length / largas.length >= 0.6;
      const caps = words.map((w) => letras(w) > 0 && w === w.toUpperCase());
      f = words.map((w, k) => {
        // palabra gritada: larga, o corta pero junto a otras en mayúsculas (las siglas sueltas como SEO quedan)
        if (caps[k] && (letras(w) >= 4 || caps[k - 1] || caps[k + 1])) return w.toLowerCase();
        if (titleCase && !/\p{Ll}\p{Lu}/u.test(w)) return w.toLowerCase();
        return w;
      }).join(" ");
    }
    if (f.length > 70) f = f.slice(0, 70).replace(/\s+\S*$/, "");
    const pregunta = /^¿/.test(f);
    f = f.replace(pregunta ? /[\s,;:.!¡(\[-]+$/u : /[\s,;:.!¡?¿(\[-]+$/u, "").replace(/^¡+/u, "");
    let ws = f.split(" ");
    while (ws.length > 2 && COLA.has(ws[ws.length - 1].toLowerCase())) ws.pop();
    f = ws.join(" ");
    if (pregunta && !/\?$/.test(f)) f += "?";
    if (!/\p{L}/u.test(f)) return "";
    // Mayúscula inicial solo si la frase empieza con letra (después de ¿ ¡ « o comillas), no en «99,9% de…»
    const k = f.match(/^[¿¡«"“'([]*/)[0].length;
    return /\p{L}/u.test(f[k] || "") ? f.slice(0, k) + f[k].toLocaleUpperCase("es") + f.slice(k + 1) : f;
  }
  function quickTitle(i) {
    const t = cleanTitle(i.title) || cleanTitle(i.text);
    if (t) return t;
    if (i.net === "facebook") {
      try { const h = new URL(i.url).hostname.replace(/^www\./, ""); if (!/(^|\.)(facebook\.com|fb\.watch)$/.test(h)) return "Enlace de " + h; } catch { /* sin enlace */ }
      return "Publicación de Facebook";
    }
    return i.net === "youtube" ? "Video de YouTube" : "Publicación de Instagram";
  }

  window.Parsers = {
    UNCAT, fixText, extractHashtags, keywords, normalizeName, uid, parseCsv, quickTitle,
    parseInstagram, parseFacebook, parseYouTubePlaylist, parseYouTubePlaylistsIndex,
  };
})();
