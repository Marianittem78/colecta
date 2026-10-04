/* Colecta — lógica de la app */
(function () {
  const P = window.Parsers;
  const LS = { items: "colecta.items", keys: "colecta.keys", syn: "colecta.synonyms", theme: "colecta.theme" };
  const NETS = { facebook: "Facebook", instagram: "Instagram", youtube: "YouTube" };

  const mem = {}; // almacenamiento en memoria (la vista previa no permite almacenamiento del navegador)
  const store = { get: (k) => (k in mem ? mem[k] : null), set: (k, v) => { mem[k] = v; } };
  let items = [];
  let synonymsText = "";
  let sourceMap = {}; // "red:idColección" → colección de Colecta elegida
  let currentUser = null;
  let state = { view: "import", selected: null, filter: "all", query: "", netFilter: "all", tagFilter: null };

  function load(k, d) { try { return JSON.parse(store.get(k)) ?? d; } catch { return d; } }
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Seguridad y límites ---------- */
  const LIMITS = { items: 5000, body: 2000, title: 500, author: 200, url: 2048, coll: 100, tags: 60, tag: 100, paste: 10 * 1024 * 1024, file: 1024 * 1024 * 1024, entry: 60 * 1024 * 1024 };
  const BM_SHA256 = "52bb95768ad902f1b7b5be9192eb2e529955c452acc308aecb81bc8e78a47505";
  const BM_VERSION = "3.1";
  function safeUrl(u) {
    const raw = String(u ?? "").trim();
    if (!raw || raw.length > LIMITS.url) return null;
    try { const x = new URL(raw); return x.protocol === "https:" || x.protocol === "http:" ? raw : null; } catch { return null; }
  }
  const clip = (v, n) => { const t = String(v ?? ""); return t.length > n ? t.slice(0, n) : t; };
  const okVideoId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{11}$/.test(v);
  // Recorta el texto al límite, conservando antes los hashtags del texto completo
  function fitText(i) {
    const full = String(i.text ?? "");
    let tags = (Array.isArray(i.hashtags) ? i.hashtags : []).map((t) => String(t));
    if (full.length > LIMITS.body) { tags = [...tags, ...P.extractHashtags(full)]; i.text = full.slice(0, LIMITS.body); i.truncated = true; }
    i.hashtags = [...new Set(tags.filter((t) => t && t.length <= LIMITS.tag))].slice(0, LIMITS.tags);
    return i;
  }
  // Normaliza un elemento importado: solo campos conocidos, enlaces http(s) y largos acotados
  function sanitizeItem(i, net, collection) {
    if (!i || typeof i !== "object") return null;
    const url = safeUrl(i.url);
    if (!url || !NETS[net]) return null;
    const coll = clip(String(collection ?? "").trim(), LIMITS.coll);
    if (!coll) return null;
    const t = typeof i.savedAt === "number" ? i.savedAt : Date.parse(i.savedAt);
    return fitText({
      net, collection: coll, url,
      videoId: okVideoId(i.videoId) ? i.videoId : undefined,
      title: clip(i.title, LIMITS.title), author: clip(i.author, LIMITS.author),
      text: String(i.text ?? ""), hashtags: i.hashtags, truncated: !!i.truncated,
      thumb: safeUrl(i.thumb) || undefined,
      savedAt: Number.isFinite(t) ? t : null,
      enriched: !!i.enriched,
    });
  }
  // Mensajes claros, sin exponer detalles técnicos del servidor
  function friendlyErr(err) {
    const m = String((err && (err.message || err.details)) || "");
    console.error(err);
    if (/colecta_limit/i.test(m)) return `Llegaste al máximo de ${LIMITS.items} elementos por cuenta.`;
    if (/violates check constraint|invalid input/i.test(m)) return "Algunos datos no pasaron la validación y no se guardaron.";
    if (/failed to fetch|network|load failed/i.test(m)) return "No hay conexión con el servidor. Revisá tu internet y probá de nuevo.";
    if (/jwt|not authenticated|session/i.test(m)) return "Tu sesión venció. Volvé a ingresar.";
    return "No se pudo completar la operación. Probá de nuevo en unos minutos.";
  }
  const realCount = () => items.filter((i) => !i.demo).length;
  function log(msg, el = $("#log")) { el.textContent += msg + "\n"; el.scrollTop = el.scrollHeight; }

  /* ---------- Tema ---------- */
  const root = document.documentElement;
  root.dataset.theme = store.get(LS.theme) || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $("#themeToggle").onclick = () => { root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark"; store.set(LS.theme, root.dataset.theme); };

  /* ---------- Navegación ---------- */
  function show(view) {
    state.view = view;
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
    if (view === "groups") renderGroups();
  }
  $$(".tab").forEach((t) => (t.onclick = () => { if (t.dataset.view === "groups") { state.selected = null; state.tagFilter = null; } show(t.dataset.view); }));
  $("#goGroups").onclick = () => { state.selected = null; show("groups"); };

  /* ---------- Importación ---------- */
  function detectNet(path, hint) {
    const p = path.toLowerCase();
    if (/\.csv$/.test(p)) return "youtube";
    if (/instagram|saved_saved|saved_posts|saved_collections/.test(p)) return "instagram";
    if (/saved_items|collections\.json|your_saved_items/.test(p)) return "facebook";
    return hint;
  }
  function relevant(path, net) {
    const p = path.toLowerCase();
    if (net === "youtube") return /\.csv$/.test(p) && !/subscriptions|suscripciones|comments|comentarios|channel|canal/.test(p);
    if (net === "instagram") return /\.json$/.test(p) && /saved/.test(p);
    if (net === "facebook") return /\.json$/.test(p) && /saved|collection/.test(p);
    return false;
  }

  async function readInputFiles(fileList, hint) {
    const entries = [];
    for (const f of fileList) {
      if (f.size > LIMITS.file) { log(`✗ ${f.name}: el archivo es demasiado grande.`); continue; }
      if (/\.zip$/i.test(f.name)) {
        log(`Abriendo ${f.name}…`);
        const zip = await JSZip.loadAsync(f);
        for (const [path, zf] of Object.entries(zip.files)) {
          if (zf.dir) continue;
          const net = detectNet(path, hint);
          if (!relevant(path, net)) continue;
          if ((zf._data && zf._data.uncompressedSize) > LIMITS.entry) { log(`✗ ${path}: demasiado grande, se omitió.`); continue; }
          entries.push({ path, net, text: await zf.async("string") });
        }
      } else {
        const path = f.webkitRelativePath || f.name;
        entries.push({ path, net: detectNet(path, hint), text: await f.text() });
      }
    }
    return entries;
  }

  async function ingest(entries) {
    const found = [], packages = [];
    const ytFiles = entries.filter((e) => e.net === "youtube");
    const idxFile = ytFiles.find((e) => /(playlists|listas de reproducci[oó]n)\.csv$/i.test(e.path));
    const ytIndex = idxFile ? P.parseYouTubePlaylistsIndex(idxFile.text) : {};
    for (const e of entries) {
      try {
        let got = [];
        if (e.net === "youtube") { if (e !== idxFile) got = P.parseYouTubePlaylist(e.text, e.path, ytIndex); }
        else {
          const json = JSON.parse(e.text);
          if (json && json.colecta && Array.isArray(json.items)) { packages.push(json); continue; }
          else got = e.net === "instagram" ? P.parseInstagram(json, e.path) : P.parseFacebook(json, e.path);
        }
        if (got.length) log(`✓ ${NETS[e.net]} · ${e.path.split("/").slice(-2).join("/")} → ${got.length} enlaces`);
        found.push(...got);
      } catch (err) { console.error(err); log(`✗ ${e.path}: no tiene un formato que Colecta pueda leer.`); }
    }
    if (found.length) await importPackage({ colecta: 2, items: found.map((i) => ({ ...i, sourceId: "export:" + i.net + ":" + i.collection })) });
    for (const pkg of packages) await importPackage(pkg);
  }

  /* ---------- Paquetes del marcador: preguntar a qué colección van ---------- */
  function sourcesOf(pkg) {
    if (Array.isArray(pkg.sources) && pkg.sources.length) return pkg.sources;
    // Formato anterior: agrupar por el nombre de colección de origen
    const m = new Map();
    pkg.items.forEach((i) => { const id = i.sourceId || i.collection; if (!m.has(id)) m.set(id, { net: i.net || pkg.source, id, name: i.collection, count: 0 }); m.get(id).count++; });
    return [...m.values()];
  }
  function collectionNames() { return buildGroups().map((g) => g.name).sort((a, b) => a.localeCompare(b, "es")); }

  function askTargets(pkg) {
    return new Promise((resolve) => {
      const srcs = sourcesOf(pkg);
      const names = collectionNames();
      const modal = $("#pickModal"), body = $("#pickBody");
      const existingUrls = new Set(items.map((i) => i.url));
      body.innerHTML = srcs.map((s, idx) => {
        const its = pkg.items.filter((i) => (i.sourceId || i.collection) === s.id);
        const fresh = its.filter((i) => !existingUrls.has(i.url)).length;
        const mapped = sourceMap[s.net + ":" + s.id];
        const same = names.find((n) => P.normalizeName(n) === P.normalizeName(s.name));
        const def = mapped && names.includes(mapped) ? mapped : same || "__new__";
        return `<div class="pick" data-idx="${idx}">
          <div class="pick-head"><b>«${esc(s.name)}»</b><span class="muted">${fresh} ${fresh === 1 ? "enlace nuevo" : "enlaces nuevos"}${its.length - fresh ? ` · ${its.length - fresh} ya estaban` : ""}</span></div>
          <label class="field"><span>Agregar a</span>
            <select class="input pick-sel">
              <option value="__new__" ${def === "__new__" ? "selected" : ""}>+ Nueva colección…</option>
              ${names.map((n) => `<option value="${esc(n)}" ${def === n ? "selected" : ""}>${esc(n)}</option>`).join("")}
            </select></label>
          <label class="field pick-new" ${def === "__new__" ? "" : "hidden"}><span>Nombre de la nueva colección</span>
            <input class="input pick-name" maxlength="100" value="${esc(clip(s.name, LIMITS.coll))}" /></label>
        </div>`;
      }).join("");
      $$(".pick", body).forEach((row) => {
        const sel = $(".pick-sel", row), nw = $(".pick-new", row);
        sel.onchange = () => { nw.hidden = sel.value !== "__new__"; if (!nw.hidden) $(".pick-name", row).focus(); };
      });
      modal.hidden = false;
      const done = (val) => { modal.hidden = true; $("#pickOk").onclick = $("#pickCancel").onclick = null; resolve(val); };
      $("#pickCancel").onclick = () => done(null);
      $("#pickOk").onclick = () => {
        const out = [];
        for (const row of $$(".pick", body)) {
          const s = srcs[+row.dataset.idx];
          const sel = $(".pick-sel", row).value;
          const name = sel === "__new__" ? $(".pick-name", row).value.trim() : sel;
          if (!name) { $(".pick-name", row).focus(); return; }
          out.push({ src: s, target: name });
        }
        done(out);
      };
    });
  }

  async function importPackage(pkg) {
    const choices = await askTargets(pkg);
    if (!choices) return log("Importación cancelada.");
    const existingUrls = new Set(items.map((i) => i.url));
    let total = 0, skipped = 0, invalid = 0, overLimit = 0;
    let room = Math.max(0, LIMITS.items - realCount());
    const toAdd = [];
    for (const { src, target } of choices) {
      pkg.items.filter((i) => i && (i.sourceId || i.collection) === src.id).forEach((i) => {
        const clean = sanitizeItem(i, i.net || src.net || pkg.source, target);
        if (!clean) { invalid++; return; }
        if (existingUrls.has(clean.url)) { skipped++; return; }
        if (room <= 0) { overLimit++; return; }
        existingUrls.add(clean.url);
        toAdd.push(clean); room--;
        total++;
      });
      sourceMap[clip(src.net + ":" + src.id, 300)] = clip(target, LIMITS.coll);
    }
    if (invalid) log(`✗ ${invalid} ${invalid === 1 ? "elemento descartado" : "elementos descartados"} por tener un enlace no válido.`);
    if (overLimit) log(`✗ ${overLimit} ${overLimit === 1 ? "enlace quedó" : "enlaces quedaron"} afuera: llegaste al máximo de ${LIMITS.items} elementos.`);
    if (toAdd.length) await merge(toAdd);
    log(`✓ ${total} ${total === 1 ? "enlace agregado" : "enlaces agregados"}${skipped ? ` (${skipped} ya estaban en Colecta)` : ""} → ${[...new Set(choices.map((c) => "«" + c.target + "»"))].join(", ")}`);
    DB.saveSettings({ source_map: sourceMap }).catch(() => {});
    const perTarget = new Map();
    toAdd.forEach((i) => perTarget.set(i.collection, (perTarget.get(i.collection) || 0) + 1));
    choices.forEach((c) => { if (!perTarget.has(c.target)) perTarget.set(c.target, 0); });
    const lines = [...perTarget].map(([c, n]) => `<li><span class="toast-dot" style="--glow:${colorFor(c)}"></span><span><b>${n}</b> ${n === 1 ? "enlace nuevo" : "enlaces nuevos"} en <b>«${esc(c)}»</b></span></li>`).join("");
    const first = choices[0].target;
    toast(`<p class="toast-title">${total ? "Importación completa" : "No había enlaces nuevos"}</p><ul class="toast-list">${lines}</ul>${skipped ? `<p class="toast-note">${skipped === 1 ? "1 ya estaba en Colecta y no se repitió." : skipped + " ya estaban en Colecta y no se repitieron."}</p>` : ""}${overLimit ? `<p class="toast-note warn-note">Llegaste al máximo de ${LIMITS.items} elementos por cuenta: ${overLimit} ${overLimit === 1 ? "enlace quedó" : "enlaces quedaron"} afuera. Eliminá colecciones que ya no uses para hacer lugar.</p>` : ""}${invalid ? `<p class="toast-note">${invalid} ${invalid === 1 ? "elemento tenía" : "elementos tenían"} un enlace no válido y se descartaron.</p>` : ""}`,
      { action: "Ver colección", onAction: () => { state.query = ""; $("#search").value = ""; state.selected = P.normalizeName(first); show("groups"); }, ms: 9000, kind: overLimit ? "warn" : total ? "ok" : "warn" });
    state.selected = P.normalizeName(choices[0].target);
  }

  async function merge(newItems) {
    const byKey = new Map(items.map((i) => [i.net + "|" + i.url + "|" + i.collection, i]));
    const added = [];
    for (const it of newItems) {
      const k = it.net + "|" + it.url + "|" + it.collection;
      if (!byKey.has(k)) { const n = { hashtags: [], ...it }; byKey.set(k, n); added.push(n); }
      else {
        const old = byKey.get(k);
        if (it.text && it.text !== old.text) { Object.assign(old, { title: it.title || old.title, author: it.author || old.author, text: it.text, thumb: it.thumb || old.thumb, hashtags: it.hashtags && it.hashtags.length ? it.hashtags : old.hashtags, enriched: it.enriched || old.enriched }); added.push(old); }
      }
    }
    // Si un enlace está en alguna colección, quitamos su duplicado "Sin colección"
    const all = [...byKey.values()];
    const inColl = new Set(all.filter((i) => i.collection !== P.UNCAT).map((i) => i.net + "|" + i.url));
    const removed = all.filter((i) => i.collection === P.UNCAT && inColl.has(i.net + "|" + i.url));
    items = all.filter((i) => !removed.includes(i));
    updateStatus();
    log(`Total en Colecta: ${items.length} enlaces.`);
    // Guardar en Supabase (los datos de ejemplo quedan solo en esta sesión)
    const toSave = added.filter((i) => !i.demo && !removed.includes(i));
    const toDelete = removed.filter((i) => i.id).map((i) => i.id);
    if (!toSave.length && !toDelete.length) return;
    setSync("Guardando…");
    try {
      if (toDelete.length) await DB.deleteItems(toDelete);
      if (toSave.length) {
        const saved = await DB.upsertItems(toSave);
        const idx = new Map(saved.map((r) => [r.net + "|" + r.url + "|" + r.collection, r.id]));
        toSave.forEach((i) => (i.id = idx.get(i.net + "|" + i.url + "|" + i.collection)));
      }
      setSync("Guardado");
      
    } catch (err) { setSync("Error al guardar", true); log("✗ " + friendlyErr(err)); }
  }

  async function persist(list) {
    const real = list.filter((i) => !i.demo);
    if (!real.length) return;
    setSync("Guardando…");
    try { await DB.upsertItems(real); setSync("Guardado"); }
    catch (err) { setSync("Error al guardar", true); log("✗ " + friendlyErr(err), $("#enrichLog")); }
  }

  function setSync(txt, bad) { const el = $("#syncState"); if (!el) return; el.textContent = txt; el.classList.toggle("bad", !!bad); }

  function updateStatus() {
    for (const n of Object.keys(NETS)) {
      const list = items.filter((i) => i.net === n);
      const colls = new Set(list.map((i) => i.collection));
      const el = $("#st-" + n);
      el.textContent = list.length ? `${list.length.toLocaleString("es-AR")} enlaces · ${colls.size} ${colls.size === 1 ? "colección" : "colecciones"}` : "Sin datos";
      el.classList.toggle("ok", !!list.length);
    }
    $("#groupCount").textContent = buildGroups().length;
  }

  $$(".drop input").forEach((inp) => {
    inp.onchange = async () => { await ingest(await readInputFiles(inp.files, inp.dataset.net)); inp.value = ""; };
    const lab = inp.parentElement;
    ["dragenter", "dragover"].forEach((ev) => lab.addEventListener(ev, (e) => { e.preventDefault(); lab.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => lab.addEventListener(ev, () => lab.classList.remove("over")));
    lab.addEventListener("drop", async (e) => { e.preventDefault(); await ingest(await readInputFiles(e.dataTransfer.files, inp.dataset.net)); });
  });

  let clearArmed = null;
  $("#clearBtn").onclick = async () => {
    const b = $("#clearBtn");
    if (!clearArmed) { b.textContent = "¿Seguro? Tocá de nuevo"; clearArmed = setTimeout(() => { clearArmed = null; b.textContent = "Borrar todo"; }, 3000); return; }
    clearTimeout(clearArmed); clearArmed = null; b.textContent = "Borrar todo";
    try { setSync("Borrando…"); await DB.deleteAll(); setSync("Guardado"); } catch (err) { setSync("Error", true); return log("✗ " + friendlyErr(err)); }
    items = []; updateStatus(); $("#log").textContent = ""; state.selected = null; log("Se borraron todos tus enlaces.");
  };

  /* ---------- Agrupación ---------- */
  function synonymMap() {
    const map = {};
    synonymsText.split("\n").forEach((line) => {
      const [canon, rest] = line.split("=");
      if (!canon || !rest) return;
      const c = P.normalizeName(canon);
      rest.split(",").forEach((v) => { const n = P.normalizeName(v); if (n) map[n] = c; });
      map[c] = c;
    });
    return map;
  }

  function tagsOf(i) {
    const own = new Set([...(i.hashtags || []), ...P.extractHashtags(i.title + " " + i.text)]);
    return [...own];
  }

  function buildGroups() {
    const syn = {};
    const groups = new Map();
    for (const it of items) {
      const n = P.normalizeName(it.collection);
      const key = syn[n] || n || "sin coleccion";
      if (!groups.has(key)) groups.set(key, { key, names: {}, items: [], nets: { facebook: 0, instagram: 0, youtube: 0 } });
      const g = groups.get(key);
      g.names[it.collection] = (g.names[it.collection] || 0) + 1;
      g.items.push(it); g.nets[it.net]++;
    }
    return [...groups.values()].map((g) => {
      g.name = Object.entries(g.names).sort((a, b) => b[1] - a[1])[0][0];
      g.netCount = Object.values(g.nets).filter(Boolean).length;
      const tf = {};
      g.items.forEach((i) => tagsOf(i).forEach((t) => (tf[t] = (tf[t] || 0) + 1)));
      g.tags = Object.entries(tf).sort((a, b) => b[1] - a[1]);
      return g;
    }).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  // ---- Buscador: título, autor, texto de la publicación / descripción del video y hashtags
  const fold = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const terms = (q) => fold(q).split(/\s+/).filter(Boolean);
  const haystack = (i) => fold([i.title, i.author, i.text, tagsOf(i).join(" "), i.collection].join(" \n "));
  const matches = (i, ts) => { const h = haystack(i); return ts.every((t) => h.includes(t)); };
  function snippet(text, ts) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    const f = fold(raw);
    let pos = -1;
    for (const t of ts) { const k = f.indexOf(t); if (k >= 0 && (pos < 0 || k < pos)) pos = k; }
    if (pos < 0) return "";
    const a = Math.max(0, pos - 70), b = Math.min(raw.length, pos + 150);
    return (a ? "…" : "") + raw.slice(a, b) + (b < raw.length ? "…" : "");
  }
  function highlight(text, ts) {
    const raw = String(text || "");
    if (!ts.length || !raw) return esc(raw);
    const f = fold(raw); // misma longitud que raw para caracteres latinos comunes
    if (f.length !== raw.length) return esc(raw);
    const marks = new Array(raw.length).fill(false);
    ts.forEach((t) => { let k = f.indexOf(t); while (k >= 0) { for (let j = k; j < k + t.length; j++) marks[j] = true; k = f.indexOf(t, k + t.length); } });
    let out = "", open = false;
    for (let j = 0; j < raw.length; j++) {
      if (marks[j] && !open) { out += "<mark>"; open = true; }
      if (!marks[j] && open) { out += "</mark>"; open = false; }
      out += esc(raw[j]);
    }
    return out + (open ? "</mark>" : "");
  }

  /* ---------- Íconos y colores de las colecciones ---------- */
  const ICONS = {
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
    camera: '<path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5Z"/><circle cx="12" cy="13" r="3.5"/>',
    play: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 9 5 3-5 3Z"/>',
    utensils: '<path d="M4 3v7a3 3 0 0 0 6 0V3"/><path d="M7 3v18"/><path d="M17 3c-2 2-3 4.5-3 8h3v10"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/>',
    palette: '<path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3A1.6 1.6 0 0 1 12 22Z"/><circle cx="7.5" cy="10.5" r="1.2"/><circle cx="12" cy="7" r="1.2"/><circle cx="16.5" cy="10.5" r="1.2"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2Z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7Z"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
    cap: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
    home: '<path d="M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
    shirt: '<path d="M20.4 6.5 16 3a4 4 0 0 1-8 0L3.6 6.5a1 1 0 0 0-.3 1.3L5 11h2v10h10V11h2l1.7-3.2a1 1 0 0 0-.3-1.3Z"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20Z"/>',
    gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
    dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
    bookmark: '<path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>',
  };
  const ICON_RULES = [
    [/market|mkt|venta|negocio|emprend|marca|brand|publicid|anunci/, "megaphone"],
    [/rrss|redes|social|community|instagram|tiktok|influ/, "share"],
    [/foto|camara|photo|imagen|retrat/, "camera"],
    [/video|youtube|cine|pelic|film|serie|reel/, "play"],
    [/receta|cocin|comida|food|chef|gastro|postre|bebida/, "utensils"],
    [/music|musica|cancion|guitar|piano|playlist/, "music"],
    [/viaj|travel|turis|vacacion|destino/, "plane"],
    [/disen|design|arte|art\b|ilustr|dibuj|tipograf|ux|ui\b/, "palette"],
    [/program|codigo|code|dev|software|web|tech|tecno|\bia\b|\bai\b|python|java/, "code"],
    [/fitness|gym|ejercic|entren|yoga|deporte|running/, "dumbbell"],
    [/salud|health|bienestar|medic|psico|amor/, "heart"],
    [/libro|lectur|story|escrit|book|novela|poesia|literat/, "book"],
    [/finanz|dinero|invers|econom|money|bolsa|cripto|ahorro/, "chart"],
    [/monitor|metric|kpi|rendim/, "gauge"],
    [/explor|investig|busca|research/, "search"],
    [/mundo|global|internac|idioma|ingles|geograf|analisis|jerarq/, "globe"],
    [/educa|curso|aprend|tutorial|clase|estudi|escuela|univers/, "cap"],
    [/casa|hogar|deco|jardin|mueble|interior/, "home"],
    [/moda|ropa|estilo|outfit|fashion/, "shirt"],
    [/humor|meme|chiste|risa|gracios/, "smile"],
    [/idea|tip|inspir|creativ|truco|hack/, "bulb"],
  ];
  // Íconos propios (PNG con el nombre incluido). Clave: nombre sin tildes, espacios ni signos.
  const CUSTOM_ICONS = {
    "3d": { src: "icons/3d.png", glow: "#5c96c8" },
    animacion: { src: "icons/animacion.png", glow: "#f8a070" },
    audiolibros: { src: "icons/audiolibros.png", glow: "#6498c8" },
  };
  const iconKey = (name) => fold(name).replace(/[^a-z0-9]/g, "");
  const customIcon = (name) => CUSTOM_ICONS[iconKey(name)] || null;
  const TILE_COLORS = ["#60a5fa", "#fb923c", "#4ade80", "#2dd4bf", "#a78bfa", "#f472b6", "#facc15", "#38bdf8", "#f87171", "#c084fc", "#a3e635", "#fdba74"];
  function iconFor(name) {
    const n = fold(name);
    const r = ICON_RULES.find(([re]) => re.test(n));
    return ICONS[r ? r[1] : "bookmark"];
  }
  function colorFor(name) {
    const ci = customIcon(name);
    if (ci) return ci.glow;
    const idx = buildGroups().findIndex((g) => g.key === P.normalizeName(name));
    if (idx >= 0) return TILE_COLORS[idx % TILE_COLORS.length];
    let h = 0; for (const ch of fold(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return TILE_COLORS[h % TILE_COLORS.length];
  }
  const svgIcon = (name, cls = "tile-icon") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconFor(name)}</svg>`;

  /* ---------- Avisos (toasts) ---------- */
  function toast(html, { action, onAction, ms = 7000, kind = "ok" } = {}) {
    const box = $("#toasts");
    const t = document.createElement("div");
    t.className = "toast " + kind;
    t.setAttribute("role", "status");
    t.innerHTML = `<button class="toast-x" type="button" aria-label="Cerrar">×</button><div class="toast-body">${html}${action ? `<div class="toast-actions"><button class="btn sm primary" type="button" data-act>${esc(action)}</button></div>` : ""}</div>`;
    while (box.children.length >= 3) box.firstElementChild.remove();
    const close = () => { t.classList.add("out"); setTimeout(() => t.remove(), 250); };
    $(".toast-x", t).onclick = close;
    if (action) $("[data-act]", t).onclick = () => { close(); onAction && onAction(); };
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add("in"));
    let timer = setTimeout(close, ms);
    t.onmouseenter = () => clearTimeout(timer);
    t.onmouseleave = () => (timer = setTimeout(close, 3000));
  }

  /* ---------- Diálogo de operaciones ---------- */
  function dialog({ title, body, ok = "Aceptar", danger = false, onOpen }) {
    return new Promise((resolve) => {
      const m = $("#opModal");
      $("#opTitle").textContent = title;
      $("#opBody").innerHTML = body;
      const okB = $("#opOk");
      okB.textContent = ok;
      okB.classList.toggle("danger-fill", danger);
      m.hidden = false;
      onOpen && onOpen($("#opBody"));
      const done = (v) => { m.hidden = true; okB.onclick = $("#opCancel").onclick = null; m.onkeydown = null; resolve(v); };
      $("#opCancel").onclick = () => done(null);
      okB.onclick = () => done($("#opBody"));
      m.onkeydown = (e) => { if (e.key === "Escape") done(null); if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); done($("#opBody")); } };
    });
  }

  /* ---------- Exportar ---------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const slug = (n) => fold(n).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "coleccion";
  const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r|%]/.test(s)) s = "'" + s; return /[",\n\r;']/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function exportItems(list, name, fmt) {
    const rows = list.map((i) => ({ coleccion: i.collection, red: i.net, url: i.url, titulo: i.title || "", autor: i.author || "", hashtags: tagsOf(i).join(" "), texto: i.text || "", guardado: i.savedAt || "" }));
    if (fmt === "json") download(`colecta-${slug(name)}.json`, JSON.stringify(rows, null, 2), "application/json");
    else if (fmt === "html") {
      const by = new Map(); rows.forEach((r) => { if (!by.has(r.coleccion)) by.set(r.coleccion, []); by.get(r.coleccion).push(r); });
      const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Colecta</TITLE>\n<H1>Colecta</H1>\n<DL><p>\n` +
        [...by].map(([c, rs]) => `  <DT><H3>${esc(c)}</H3>\n  <DL><p>\n` + rs.filter((r) => safeUrl(r.url)).map((r) => `    <DT><A HREF="${esc(r.url)}">${esc(r.titulo || r.url)}</A>`).join("\n") + `\n  </DL><p>`).join("\n") + `\n</DL><p>\n`;
      download(`colecta-${slug(name)}.html`, html, "text/html");
    } else {
      const head = Object.keys(rows[0] || { coleccion: "", red: "", url: "", titulo: "", autor: "", hashtags: "", texto: "", guardado: "" });
      download(`colecta-${slug(name)}.csv`, "\ufeff" + [head.join(","), ...rows.map((r) => head.map((h) => csvCell(r[h])).join(","))].join("\n"), "text/csv");
    }
    toast(`Exportaste <b>${list.length}</b> ${list.length === 1 ? "enlace" : "enlaces"} de <b>«${esc(name)}»</b> en ${fmt.toUpperCase()}.`);
  }
  async function askExport(list, name) {
    const r = await dialog({
      title: `Exportar «${name}»`,
      body: `<p class="muted">${list.length} ${list.length === 1 ? "enlace" : "enlaces"}. Elegí el formato:</p>
        <div class="fmt-opts">
          <label class="fmt"><input type="radio" name="fmt" value="csv" checked><span><b>CSV</b><small>Para Excel o Google Sheets</small></span></label>
          <label class="fmt"><input type="radio" name="fmt" value="json"><span><b>JSON</b><small>Con todos los datos, para reimportar o programar</small></span></label>
          <label class="fmt"><input type="radio" name="fmt" value="html"><span><b>Marcadores HTML</b><small>Para importar en Chrome, Firefox o Safari</small></span></label>
        </div>`,
      ok: "Exportar",
    });
    if (!r) return;
    exportItems(list, name, $("input[name=fmt]:checked", r).value);
  }
  $("#exportAllBtn").onclick = () => items.length ? askExport(items, "todas las colecciones") : toast("Todavía no hay enlaces para exportar.", { kind: "warn" });

  /* ---------- Operaciones con colecciones ---------- */
  async function askRename(g) {
    const r = await dialog({
      title: "Renombrar colección",
      body: `<label class="field"><span>Nuevo nombre</span><input class="input" id="opName" maxlength="100" value="${esc(g.name)}" /></label><p class="muted small">Si usás el nombre de otra colección, se unen en una sola.</p>`,
      ok: "Guardar",
      onOpen: (b) => setTimeout(() => $("#opName", b).select(), 30),
    });
    if (!r) return;
    await renameCollection(g, clip($("#opName", r).value.trim(), LIMITS.coll));
  }
  async function askDelete(g) {
    const r = await dialog({
      title: `Eliminar «${g.name}»`,
      body: `<p>Se van a borrar los <b>${g.items.length}</b> enlaces de esta colección de tu cuenta de Colecta. Tus guardados en Instagram, Facebook y YouTube no se tocan.</p>`,
      ok: "Eliminar", danger: true,
    });
    if (r) await deleteCollection(g);
  }
  function openMenu(btn, g) {
    closeMenu();
    const m = document.createElement("div");
    m.className = "tile-menu"; m.setAttribute("role", "menu");
    m.innerHTML = `<button role="menuitem" data-op="open">Abrir</button><button role="menuitem" data-op="rename">Renombrar</button><button role="menuitem" data-op="export">Exportar</button><button role="menuitem" data-op="delete" class="danger">Eliminar</button>`;
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.top = window.scrollY + r.bottom + 4 + "px";
    m.style.left = Math.max(8, Math.min(window.scrollX + r.right - 170, window.innerWidth - 178)) + "px";
    m.onclick = (e) => {
      const op = e.target.dataset.op; if (!op) return;
      closeMenu();
      if (op === "open") { state.selected = g.key; state.tagFilter = null; renderGroups(); }
      if (op === "rename") askRename(g);
      if (op === "export") askExport(g.items, g.name);
      if (op === "delete") askDelete(g);
    };
    setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  }
  function closeMenu() { $$(".tile-menu").forEach((m) => m.remove()); }

  function tileHtml(g, idx, count, active) {
    const ci = customIcon(g.name);
    const face = ci
      ? `<img class="tile-img" src="${esc(ci.src)}" alt="" draggable="false" />`
      : `${svgIcon(g.name)}<span class="tile-name">${esc(g.name)}</span>`;
    return `<li class="tile-wrap">
      <button class="tile key ${ci ? "has-img" : ""} ${active ? "active" : ""}" data-key="${esc(g.key)}" style="--glow:${colorFor(g.name)}" aria-label="${esc(g.name)}, ${count} enlaces">
        <span class="key-cap">
          <span class="tile-num">${idx + 1}</span>
          ${face}
          <span class="tile-count">${count} ${count === 1 ? "enlace" : "enlaces"}</span>
        </span>
      </button>
      <button class="tile-more" data-key="${esc(g.key)}" type="button" aria-label="Opciones de ${esc(g.name)}" title="Renombrar, exportar o eliminar">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>
    </li>`;
  }

  function renderGroups() {
    const ts = terms(state.query);
    const all = buildGroups();
    $("#groupCount").textContent = all.length;
    $("#collSummary").textContent = all.length ? `${all.length} ${all.length === 1 ? "colección" : "colecciones"} · ${items.length} ${items.length === 1 ? "enlace" : "enlaces"}` : "";
    const ul = $("#groupList"), d = $("#detail");
    const bind = () => {
      $$(".tile", ul).forEach((b) => (b.onclick = () => { state.selected = state.selected === b.dataset.key && ts.length ? null : b.dataset.key; state.tagFilter = null; renderGroups(); if (!ts.length) window.scrollTo({ top: 0, behavior: "smooth" }); }));
      $$(".tile-more", ul).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openMenu(b, all.find((g) => g.key === b.dataset.key)); }));
    };
    if (ts.length) {
      const hits = items.filter((i) => matches(i, ts));
      const per = new Map();
      hits.forEach((i) => { const k = P.normalizeName(i.collection); per.set(k, (per.get(k) || 0) + 1); });
      if (state.selected && !per.has(state.selected)) state.selected = null;
      ul.hidden = false; ul.classList.add("compact");
      ul.innerHTML = all.map((g, idx) => per.has(g.key) ? tileHtml(g, idx, per.get(g.key), state.selected === g.key) : "").join("");
      bind();
      d.hidden = false;
      renderResults(hits.filter((i) => !state.selected || P.normalizeName(i.collection) === state.selected), ts, all);
      return;
    }
    ul.classList.remove("compact");
    const g = state.selected && all.find((x) => x.key === state.selected);
    if (g) { ul.hidden = true; d.hidden = false; renderDetail(g, all.indexOf(g)); return; }
    state.selected = null;
    d.hidden = true; ul.hidden = false;
    ul.innerHTML = all.length ? all.map((g, idx) => tileHtml(g, idx, g.items.length, false)).join("")
      : `<li class="tiles-empty"><p>Todavía no tenés colecciones.</p><button class="btn primary" type="button" id="emptyImport">Importar la primera</button></li>`;
    const ei = $("#emptyImport"); if (ei) ei.onclick = () => show("import");
    bind();
  }

  function renderResults(list, ts, all) {
    const d = $("#detail");
    const scope = state.selected ? (all.find((g) => g.key === state.selected) || {}).name : null;
    const nameOf = (i) => (all.find((g) => g.key === P.normalizeName(i.collection)) || {}).name || i.collection;
    d.innerHTML = `
      <header class="dhead"><div>
        <h1>${list.length} ${list.length === 1 ? "resultado" : "resultados"}</h1>
        <p class="muted">para «${esc(state.query.trim())}»${scope ? " en " + esc(scope) + " · tocá la colección de nuevo para ver todas" : " en todas tus colecciones"}</p>
      </div>
      <div class="coll-actions"><button class="btn sm ghost" id="clearSearch" type="button">Limpiar búsqueda</button></div></header>
      <ul class="items">
        ${list.slice(0, 300).map((i) => {
          const tags = tagsOf(i);
          const snip = snippet(i.text, ts);
          return `<li class="item">
            ${i.thumb ? `<img class="thumb" src="${esc(safeUrl(i.thumb) || "")}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
            <div class="ibody">
              <a href="${esc(safeUrl(i.url) || "#")}" target="_blank" rel="noopener noreferrer" class="ititle">${highlight(i.title || shortUrl(i.url), ts)}</a>
              <div class="imeta"><span class="coll-chip" style="--glow:${colorFor(nameOf(i))}">${esc(nameOf(i))}</span>${i.author ? " · " + highlight(i.author, ts) : ""}</div>
              ${snip ? `<p class="isnip">${highlight(snip, ts)}</p>` : ""}${moreLink(i)}
              <div class="itags">${tags.map((t) => `<span class="tag sm">${highlight(t, ts)}</span>`).join("")}</div>
            </div>
          </li>`; }).join("") || `<li class="muted pad">No encontré publicaciones con ese texto. Probá con otra palabra o un #hashtag.</li>`}
      </ul>
      ${list.length > 300 ? `<p class="muted pad">Se muestran los primeros 300. Agregá otra palabra para afinar.</p>` : ""}`;
    $("#clearSearch").onclick = () => { $("#search").value = ""; state.query = ""; state.selected = null; renderGroups(); };
  }

  function renderDetail(g, idx) {
    const d = $("#detail");
    let list = g.items;
    if (state.tagFilter) list = list.filter((i) => tagsOf(i).includes(state.tagFilter));
    d.innerHTML = `
      <button class="back" id="backBtn" type="button">← Todas las colecciones</button>
      <header class="dhead banner key-banner" style="--glow:${colorFor(g.name)}">
        <div class="banner-id">
          ${customIcon(g.name) ? `<img class="banner-img" src="${esc(customIcon(g.name).src)}" alt="" />` : svgIcon(g.name, "banner-icon")}
          <div>
            <h1>${esc(g.name)}</h1>
            <p>${g.items.length} ${g.items.length === 1 ? "enlace" : "enlaces"}</p>
          </div>
        </div>
        <div class="coll-actions">
          <button class="btn sm on-color" id="renameBtn" type="button">Renombrar</button>
          <button class="btn sm on-color" id="exportBtn" type="button">Exportar</button>
          <button class="btn sm on-color" id="deleteBtn" type="button">Eliminar</button>
        </div>
      </header>
      <div class="tagcloud">
        <span class="label">De qué trata</span>
        ${g.tags.length ? g.tags.slice(0, 30).map(([t, c]) => `<button class="tag ${state.tagFilter === t ? "active" : ""}" data-tag="${esc(t)}">${esc(t)} <small>${c}</small></button>`).join("")
          : `<span class="muted">Aún no hay hashtags en esta colección.</span>`}
      </div>
      <ul class="items">
        ${list.map((i) => {
          const tags = tagsOf(i);
          const kw = tags.length ? [] : P.keywords(i.title + " " + i.text, 4);
          return `<li class="item">
            ${i.thumb ? `<img class="thumb" src="${esc(safeUrl(i.thumb) || "")}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
            <div class="ibody">
              <a href="${esc(safeUrl(i.url) || "#")}" target="_blank" rel="noopener noreferrer" class="ititle">${esc(i.title || shortUrl(i.url))}</a>
              <div class="imeta">${[i.author ? esc(i.author) : "", i.savedAt ? new Date(i.savedAt).toLocaleDateString("es-AR") : ""].filter(Boolean).join(" · ")}</div>
              <div class="itags">${tags.map((t) => `<span class="tag sm">${esc(t)}</span>`).join("")}${kw.map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>
              ${moreLink(i)}
            </div>
          </li>`; }).join("") || `<li class="muted pad">No hay enlaces con este filtro.</li>`}
      </ul>`;
    $("#backBtn").onclick = () => { state.selected = null; state.tagFilter = null; renderGroups(); };
    $("#renameBtn").onclick = () => askRename(g);
    $("#exportBtn").onclick = () => askExport(g.items, g.name);
    $("#deleteBtn").onclick = () => askDelete(g);
    $$(".tagcloud .tag", d).forEach((b) => (b.onclick = () => { state.tagFilter = state.tagFilter === b.dataset.tag ? null : b.dataset.tag; renderDetail(g, idx); }));
  }
  async function renameCollection(g, name) {
    if (!name || name === g.name) return;
    const target = buildGroups().find((x) => P.normalizeName(x.name) === P.normalizeName(name) && x.key !== g.key);
    const finalName = target ? target.name : name;
    const already = new Set(target ? target.items.map((i) => i.url) : []);
    const dups = g.items.filter((i) => already.has(i.url));
    const moving = g.items.filter((i) => !already.has(i.url));
    setSync("Guardando…");
    try {
      if (dups.length) await DB.deleteItems(dups.filter((i) => i.id).map((i) => i.id));
      await DB.renameItems(moving.filter((i) => i.id).map((i) => i.id), finalName);
      items = items.filter((i) => !dups.includes(i));
      moving.forEach((i) => (i.collection = finalName));
      Object.keys(sourceMap).forEach((k) => { if (P.normalizeName(sourceMap[k]) === g.key) sourceMap[k] = finalName; });
      DB.saveSettings({ source_map: sourceMap }).catch(() => {});
      setSync("Guardado");
      if (state.selected) state.selected = P.normalizeName(finalName);
      updateStatus(); renderGroups();
      toast(target ? `<b>«${esc(g.name)}»</b> se unió con <b>«${esc(finalName)}»</b>: ${moving.length} ${moving.length === 1 ? "enlace movido" : "enlaces movidos"}${dups.length ? `, ${dups.length} repetidos quitados` : ""}.`
        : `Renombraste <b>«${esc(g.name)}»</b> a <b>«${esc(finalName)}»</b>.`);
    } catch (err) { setSync("Error al guardar", true); toast("No pude renombrar: " + esc(friendlyErr(err)), { kind: "bad" }); }
  }
  async function deleteCollection(g) {
    setSync("Borrando…");
    try {
      await DB.deleteItems(g.items.filter((i) => i.id).map((i) => i.id));
      items = items.filter((i) => !g.items.includes(i));
      Object.keys(sourceMap).forEach((k) => { if (P.normalizeName(sourceMap[k]) === g.key) delete sourceMap[k]; });
      DB.saveSettings({ source_map: sourceMap }).catch(() => {});
      setSync("Guardado");
      state.selected = null; updateStatus(); renderGroups();
      toast(`Eliminaste <b>«${esc(g.name)}»</b> y sus ${g.items.length} ${g.items.length === 1 ? "enlace" : "enlaces"}.`);
    } catch (err) { setSync("Error al borrar", true); toast("No pude eliminar: " + esc(friendlyErr(err)), { kind: "bad" }); }
  }
  function alertMsg(m) { log("✗ " + m); }

  // Enlace a la publicación original cuando el texto se recortó por el límite
  function moreLink(i) {
    const u = safeUrl(i.url);
    return i.truncated && u ? `<a class="more-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Ver más…</a>` : "";
  }
  document.addEventListener("error", (e) => { const t = e.target; if (t && t.tagName === "IMG" && t.classList.contains("thumb")) t.remove(); }, true);
  function shortUrl(u) { try { const x = new URL(u); return x.hostname.replace("www.", "") + x.pathname.slice(0, 40); } catch { return u; } }

  const setPh = () => ($("#search").placeholder = matchMedia("(max-width: 640px)").matches ? "Buscar en tus guardados" : "Buscar en publicaciones, videos y #hashtags");
  setPh(); matchMedia("(max-width: 640px)").addEventListener("change", setPh);
  let searchT = null;
  $("#search").oninput = (e) => { clearTimeout(searchT); searchT = setTimeout(() => { const was = !!terms(state.query).length; state.query = e.target.value; if (was !== !!terms(state.query).length) state.selected = null; renderGroups(); }, 150); };

  /* ---------- Ajustes / enriquecimiento ---------- */
  $("#saveKeys").onclick = () => { DB.saveSettings({ yt_key: $("#ytKey").value.trim(), meta_token: $("#metaToken").value.trim() }).then(() => log("Claves guardadas en tu cuenta.", $("#enrichLog")), (e) => log("✗ " + e.message, $("#enrichLog"))); };

  $("#enrichBtn").onclick = async () => {
    const el = $("#enrichLog"); el.textContent = "";
    const yt = $("#ytKey").value.trim(), meta = $("#metaToken").value.trim();
    if (!yt && !meta) return log("Cargá al menos una clave.", el);
    if (yt) await enrichYouTube(yt, el);
    if (meta) await enrichMeta(meta, el);
    updateStatus(); await persist(items.filter((i) => i.enriched)); log("Listo. Cambios guardados en Supabase.", el);
  };

  async function enrichYouTube(key, el) {
    const todo = items.filter((i) => i.net === "youtube" && !i.enriched);
    const ids = [...new Set(todo.map((i) => i.videoId).filter(okVideoId))];
    log(`YouTube: ${ids.length} videos por enriquecer…`, el);
    for (let k = 0; k < ids.length; k += 50) {
      const batch = ids.slice(k, k + 50);
      try {
        const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(batch.join(","))}&key=${encodeURIComponent(key)}`);
        const j = await r.json();
        if (j.error) { console.error(j.error); log("✗ YouTube rechazó la consulta. Revisá que la clave sea válida y tenga habilitada la API de YouTube.", el); return; }
        const byId = Object.fromEntries((j.items || []).map((v) => [v.id, v.snippet]));
        todo.filter((i) => batch.includes(i.videoId)).forEach((i) => {
          const s = byId[i.videoId];
          i.enriched = true;
          if (!s) { i.title = i.title || "(video no disponible)"; return; }
          i.title = clip(s.title, LIMITS.title); i.author = clip(s.channelTitle, LIMITS.author); i.text = s.description || "";
          i.thumb = safeUrl(s.thumbnails?.medium?.url || s.thumbnails?.default?.url) || undefined;
          const fromTags = (s.tags || []).slice(0, 8).map((t) => "#" + t.toLowerCase().replace(/\s+/g, ""));
          i.hashtags = [...new Set([...P.extractHashtags(s.title + " " + s.description), ...fromTags])];
          fitText(i);
        });
        log(`  ✓ ${Math.min(k + 50, ids.length)}/${ids.length}`, el);
      } catch (err) { log("✗ " + friendlyErr(err), el); return; }
    }
  }

  async function enrichMeta(token, el) {
    const todo = items.filter((i) => (i.net === "instagram" || (i.net === "facebook" && /facebook\.com\/.+\/(posts|videos)|fb\.watch/.test(i.url))) && !i.enriched);
    log(`Meta: ${todo.length} publicaciones por enriquecer…`, el);
    let ok = 0;
    for (const i of todo) {
      const ep = i.net === "instagram" ? "instagram_oembed" : /videos|fb\.watch/.test(i.url) ? "oembed_video" : "oembed_post";
      try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${ep}?url=${encodeURIComponent(i.url)}&omitscript=true&access_token=${encodeURIComponent(token)}`);
        const j = await r.json();
        if (j.error) { if (/token|OAuth|permission/i.test(j.error.message)) { console.error(j.error); log("✗ Meta rechazó el token. Revisá que sea válido y tenga permiso de oEmbed.", el); return; } continue; }
        const txt = new DOMParser().parseFromString(j.html || "", "text/html").body.textContent || "";
        i.text = txt.trim(); i.author = clip(j.author_name || i.author, LIMITS.author); i.title = clip(i.title || (j.title || ""), LIMITS.title);
        i.hashtags = P.extractHashtags(i.text); fitText(i); i.enriched = true; ok++;
      } catch { /* sigue */ }
      await new Promise((res) => setTimeout(res, 150));
    }
    log(`  ✓ ${ok}/${todo.length} publicaciones leídas`, el);
  }

  /* ---------- Exportar ---------- */
  function download(name, content, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click();
  }
  $("#exportJson").onclick = () => download("colecta.json", JSON.stringify(buildGroups().map((g) => ({ coleccion: g.name, redes: g.nets, hashtags: g.tags.slice(0, 20).map(([t]) => t), enlaces: g.items.map((i) => ({ red: i.net, url: i.url, titulo: i.title, autor: i.author, hashtags: tagsOf(i) })) })), null, 2), "application/json");
  $("#exportCsv").onclick = () => {
    const rows = [["coleccion", "red", "url", "titulo", "autor", "hashtags"]];
    buildGroups().forEach((g) => g.items.forEach((i) => rows.push([g.name, i.net, i.url, i.title, i.author, tagsOf(i).join(" ")])));
    download("colecta.csv", "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv");
  };

  /* ---------- Demo ---------- */
  window.DEMO_ITEMS = () => {
    const d = (net, collection, url, title, author, tags) => ({ net, collection, url, title, author, text: "", hashtags: tags, savedAt: Date.now() - Math.random() * 9e9, enriched: true, demo: true });
    return [
      d("instagram", "Marketing", "https://www.instagram.com/p/demo1/", "5 ganchos para tus reels", "@growthlatam", ["#marketingdigital", "#reels", "#copywriting"]),
      d("instagram", "Marketing", "https://www.instagram.com/p/demo2/", "Cómo armar un embudo simple", "@emprendeya", ["#embudodeventas", "#marketingdigital", "#emprendedores"]),
      d("facebook", "Marketing", "https://www.facebook.com/demo/posts/1", "Guía de anuncios en Meta 2026", "Agencia Norte", ["#metaads", "#publicidad", "#marketingdigital"]),
      d("youtube", "Marketing", "https://www.youtube.com/watch?v=demoVideo01", "Estrategia de contenidos desde cero", "Canal Marketing Pro", ["#contenido", "#marketingdigital", "#estrategia"]),
      d("youtube", "marketing digital", "https://www.youtube.com/watch?v=demoVideo02", "SEO en 20 minutos", "Aprendé SEO", ["#seo", "#marketingdigital"]),
      d("instagram", "Recetas", "https://www.instagram.com/p/demo3/", "Pan de masa madre", "@cocinaencasa", ["#masamadre", "#panificados", "#recetas"]),
      d("youtube", "Recetas", "https://www.youtube.com/watch?v=demoVideo03", "Empanadas puntanas", "Sabores de San Luis", ["#empanadas", "#cocinaargentina", "#recetas"]),
      d("facebook", "Recetas", "https://www.facebook.com/demo/posts/2", "Locro en olla", "Cocina Criolla", ["#locro", "#cocinaargentina"]),
      d("instagram", "Diseño", "https://www.instagram.com/p/demo4/", "Paletas de color 2026", "@designdaily", ["#diseñografico", "#color", "#branding"]),
      d("youtube", "Diseño UX", "https://www.youtube.com/watch?v=demoVideo04", "Figma: auto layout avanzado", "UX Lab", ["#figma", "#uxdesign"]),
      d("youtube", "Programación", "https://www.youtube.com/watch?v=demoVideo05", "Supabase + React en 1 hora", "Dev Sur", ["#supabase", "#react", "#javascript"]),
      d("facebook", "Programación", "https://www.facebook.com/demo/posts/3", "Novedades de TypeScript", "Comunidad JS AR", ["#typescript", "#javascript"]),
    ];
  };

  /* ---------- Importar desde enlace de Instagram ---------- */
  fetch("bookmarklet.js", { cache: "no-store" }).then((r) => r.text()).then(async (code) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== BM_SHA256) { $("#bmVer").textContent = "El código del marcador no coincide con la versión verificada. No lo instales y avisá al administrador."; $("#bmVer").classList.add("bad"); return; }
    // Dirección estable de Colecta para «Abrir en Colecta» (la vista previa usa direcciones temporales)
    const stable = location.protocol === "https:" && !/\/sites\/proxy\//.test(location.pathname);
    const appUrl = stable ? (location.origin + location.pathname).replace(/index\.html$/, "") : "";
    const finalCode = code.replace("__COLECTA_URL__", JSON.stringify(appUrl).slice(1, -1));
    $("#bmLink").href = "javascript:" + encodeURIComponent(finalCode);
    $("#bmCode").value = "javascript:" + encodeURIComponent(finalCode);
    $("#bmVer").textContent = `Versión ${BM_VERSION} · huella ${hex.slice(0, 12)}`;
  }).catch(() => {});
  $("#bmLink").onclick = (e) => { e.preventDefault(); log("Arrastrá el botón a tu barra de marcadores; no se usa desde acá."); };
  $("#igOpen").onclick = () => {
    const u = $("#igUrl").value.trim();
    let okLink = false;
    try {
      const x = new URL(u);
      const h = x.hostname.toLowerCase(), path = x.pathname;
      okLink = x.protocol === "https:" && (
        (/^(www\.)?instagram\.com$/.test(h) && /^\/[^/]+\/saved(\/|$)/.test(path)) ||
        (/^(www\.|m\.)?youtube\.com$/.test(h) && /^\/(playlist|feed)(\/|$)/.test(path)) ||
        (/^(www\.|m\.|web\.)?facebook\.com$/.test(h) && /^\/saved(\/|$)/.test(path)));
    } catch { okLink = false; }
    if (!okLink) { $("#igHint").textContent = "Pegá un enlace de una colección de Instagram, una lista de YouTube o facebook.com/saved."; return; }
    $("#igHint").textContent = "Se abrió la colección. Tocá el marcador «Enviar a Colecta» en esa pestaña.";
    window.open(u, "_blank", "noopener");
  };
  $("#bmCopy").onclick = async () => {
    const det = $(".phone-help"); if (det && matchMedia("(max-width: 640px)").matches) det.open = true;
    try { await navigator.clipboard.writeText($("#bmCode").value); $("#bmCopy").textContent = "Código copiado"; setTimeout(() => ($("#bmCopy").textContent = "Copiar código del marcador"), 2500); }
    catch { if (det) det.open = true; $("#bmCode").select(); }
  };
  $("#pasteImport").onclick = async () => {
    const t = $("#pasteBox").value.trim();
    if (!t) return log("Pegá primero lo que copiaste con el marcador.");
    if (t.length > LIMITS.paste) return log("✗ Lo pegado es demasiado grande. Importá la colección en partes.");
    let j;
    try { j = JSON.parse(t); if (!j.colecta || !Array.isArray(j.items)) throw new Error("no es un paquete de Colecta"); }
    catch (err) { console.error(err); return log("✗ No pude leer lo pegado: no es un paquete de Colecta válido."); }
    if (j.items.length > LIMITS.items * 2) return log("✗ El paquete tiene demasiados elementos.");
    $("#pasteBox").value = "";
    await importPackage(j);
  };


  /* ---------- Redes de importación ---------- */
  const NET_HELP = {
    instagram: { color: "#e4558f", text: "En Instagram: tu perfil → ☰ → Guardado. Entrá a una colección, o quedate en «Todas las publicaciones» para traer todas.", url: "https://www.instagram.com/" },
    facebook: { color: "#4d8df5", text: "En Facebook: entrá a facebook.com/saved y abrí una colección. El marcador desplaza la página solo hasta leer todo.", url: "https://www.facebook.com/saved/" },
    youtube: { color: "#f2484c", text: "En YouTube: abrí una lista (también «Ver más tarde») o «Tú → Listas de reproducción» para traer todas las visibles.", url: "https://www.youtube.com/feed/playlists" },
  };
  $$(".net-key").forEach((b) => (b.onclick = () => {
    const net = b.dataset.net, h = NET_HELP[net];
    $$(".net-key").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    $("#impPanel").style.setProperty("--glow", h.color);
    $("#netHelp").textContent = h.text;
    $("#igUrl").value = h.url;
    $("#igHint").textContent = "";
  }));

  /* ---------- Recibir paquetes: desde el marcador, el portapapeles o el menú Compartir ---------- */
  let pendingPkg = null;
  function parsePkg(t) {
    if (typeof t !== "string" || !t.trim() || t.length > LIMITS.paste) return null;
    try { const j = JSON.parse(t); return j && j.colecta && Array.isArray(j.items) && j.items.length <= LIMITS.items * 2 ? j : null; } catch { return null; }
  }
  function receive(pkg, how) {
    if (!currentUser) {
      pendingPkg = pkg;
      const m = $("#authMsg"); m.textContent = `Ingresá para terminar de importar ${pkg.items.length} ${pkg.items.length === 1 ? "enlace" : "enlaces"}${how ? " " + how : ""}.`; m.classList.add("ok");
      return;
    }
    show("import");
    importPackage(pkg);
  }
  async function runPending() { if (pendingPkg) { const p = pendingPkg; pendingPkg = null; show("import"); await importPackage(p); } if (pendingShare) { const s = pendingShare; pendingShare = null; await handleShare(s); } }

  // 1) «Abrir en Colecta» desde el marcador
  if (location.hash === "#recibir") {
    history.replaceState(null, "", location.pathname + location.search);
    const opener = window.opener;
    if (opener) {
      let got = false, tries = 0;
      window.addEventListener("message", (e) => {
        if (got || e.source !== opener || !/^https:\/\/(www\.|m\.|web\.)?(instagram|facebook|youtube)\.com$/.test(e.origin)) return;
        if (!e.data || e.data.type !== "colecta:payload") return;
        const pkg = parsePkg(e.data.payload);
        if (!pkg) return;
        got = true;
        try { opener.postMessage({ type: "colecta:received" }, e.origin); } catch {}
        receive(pkg, "desde " + (NETS[pkg.source] || "la red social"));
      });
      const ping = setInterval(() => { if (got || ++tries > 40) return clearInterval(ping); try { opener.postMessage({ type: "colecta:ready" }, "*"); } catch { clearInterval(ping); } }, 300);
    } else {
      setTimeout(() => toast(`<p class="toast-title">Pegá lo copiado</p><p>No pude recibir los enlaces automáticamente. Tocá «Pegar del portapapeles» en Importar.</p>`, { kind: "warn", ms: 9000, action: "Ir a Importar", onAction: () => { show("import"); const d = $(".paste-alt"); if (d) d.open = true; } }), 800);
    }
  }
  // 2) Portapapeles
  $("#clipImport").onclick = async () => {
    let t = "";
    try { t = await navigator.clipboard.readText(); } catch { return log("✗ El navegador no dejó leer el portapapeles. Pegalo en el cuadro de arriba."); }
    const pkg = parsePkg(t.trim());
    if (!pkg) return log("✗ Lo que hay en el portapapeles no es un paquete de Colecta. Volvé a tocar «Copiar para Colecta» en la red social.");
    receive(pkg);
  };

  // 3) Menú Compartir (Android, con Colecta instalada)
  let pendingShare = null;
  const shareQ = new URLSearchParams(location.search);
  if (shareQ.has("url") || shareQ.has("text") || shareQ.has("title")) {
    const sh = { title: clip(shareQ.get("title"), 500), text: clip(shareQ.get("text"), 5000), url: clip(shareQ.get("url"), LIMITS.url) };
    history.replaceState(null, "", location.pathname);
    pendingShare = sh;
    setTimeout(() => { if (!currentUser) { const m = $("#authMsg"); m.textContent = "Ingresá para guardar lo que compartiste."; m.classList.add("ok"); } }, 0);
  }
  function classifyShared(u) {
    let x; try { x = new URL(u); } catch { return null; }
    if (x.protocol !== "https:") return null;
    const h = x.hostname.toLowerCase().replace(/^(www|m|web|mobile)\./, ""), p = x.pathname;
    if (h === "instagram.com") {
      if (/^\/[^/]+\/saved(\/|$)/.test(p)) return { net: "instagram", kind: "collection" };
      if (/^\/(p|reel|reels|tv)\/[^/]+/.test(p)) return { net: "instagram", kind: "post", url: "https://www.instagram.com" + p.replace(/^\/reels\//, "/reel/").match(/^\/[^/]+\/[^/]+\/?/)[0] };
    }
    if (h === "facebook.com" || h === "fb.watch") {
      if (/^\/saved(\/|$)/.test(p)) return { net: "facebook", kind: "collection" };
      return { net: "facebook", kind: "post", url: x.href };
    }
    if (h === "youtube.com" || h === "youtu.be" || h === "music.youtube.com") {
      const list = x.searchParams.get("list");
      const v = h === "youtu.be" ? p.slice(1, 12) : (x.searchParams.get("v") || (p.match(/^\/(shorts|live)\/([A-Za-z0-9_-]{11})/) || [])[2]);
      if (v && okVideoId(v)) return { net: "youtube", kind: "video", videoId: v, url: "https://www.youtube.com/watch?v=" + v };
      if (list && /^[A-Za-z0-9_-]{2,64}$/.test(list)) return { net: "youtube", kind: "playlist", list, url: "https://www.youtube.com/playlist?list=" + list };
      if (/^\/feed\//.test(p)) return { net: "youtube", kind: "collection" };
    }
    return null;
  }
  async function ytPlaylist(list, key) {
    const meta = await (await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(list)}&key=${encodeURIComponent(key)}`)).json();
    if (meta.error) throw new Error("youtube:" + (meta.error.message || ""));
    const name = clip(meta.items?.[0]?.snippet?.title || "Lista de YouTube", LIMITS.coll);
    const out = []; let page = "";
    do {
      const j = await (await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(list)}&key=${encodeURIComponent(key)}${page ? "&pageToken=" + encodeURIComponent(page) : ""}`)).json();
      if (j.error) throw new Error("youtube:" + (j.error.message || ""));
      (j.items || []).forEach((it) => {
        const s = it.snippet || {}, v = s.resourceId?.videoId;
        if (!okVideoId(v) || /^(Private|Deleted) video$/.test(s.title || "")) return;
        out.push({ net: "youtube", sourceId: "yt:" + list, collection: name, url: "https://www.youtube.com/watch?v=" + v, videoId: v, title: s.title, author: s.videoOwnerChannelTitle || "", text: s.description || "", thumb: s.thumbnails?.medium?.url, hashtags: P.extractHashtags((s.title || "") + " " + (s.description || "")), savedAt: Date.parse(s.publishedAt) || null, enriched: true });
      });
      page = j.nextPageToken || "";
    } while (page && out.length < LIMITS.items);
    return { name, out };
  }
  async function handleShare(sh) {
    const found = (sh.url && safeUrl(sh.url)) || ((sh.text || "").match(/https?:\/\/[^\s<>"']+/) || [])[0] || "";
    const c = classifyShared(found);
    show("import");
    if (!c) return toast(`<p class="toast-title">No pude usar ese enlace</p><p>Colecta acepta publicaciones, reels y videos de Instagram, Facebook y YouTube, y listas de YouTube.</p>`, { kind: "warn", ms: 9000 });
    if (c.kind === "collection") {
      $$(".net-key").find((b) => b.dataset.net === c.net)?.click();
      return toast(`<p class="toast-title">Para traer una colección entera</p><p>Abrila en el navegador y tocá el marcador «Enviar a Colecta» (los pasos están en Importar). Compartir solo trae publicaciones sueltas.</p>`, { kind: "warn", ms: 12000 });
    }
    if (c.kind === "playlist") {
      const key = $("#ytKey").value.trim();
      if (!key) return toast(`<p class="toast-title">Falta la clave de YouTube</p><p>Para traer una lista entera al compartirla, cargá tu clave de la API de YouTube en Ajustes, o usá el marcador.</p>`, { kind: "warn", ms: 12000, action: "Ir a Ajustes", onAction: () => show("settings") });
      setSync("Leyendo la lista…");
      try {
        const { name, out } = await ytPlaylist(c.list, key);
        setSync("Guardado");
        if (!out.length) return toast(`<p class="toast-title">La lista está vacía o es privada</p>`, { kind: "warn" });
        return importPackage({ colecta: 2, source: "youtube", sources: [{ net: "youtube", id: "yt:" + c.list, name, count: out.length }], items: out });
      } catch (err) { setSync("Error", true); console.error(err); return toast(`<p class="toast-title">YouTube no devolvió la lista</p><p>Si es privada o «Ver más tarde», usá el marcador. Si no, revisá la clave en Ajustes.</p>`, { kind: "bad", ms: 10000 }); }
    }
    // Publicación o video suelto
    const item = { net: c.net, sourceId: "share:" + c.net, collection: "Compartidos", url: c.url, videoId: c.videoId, title: "", author: "", text: "", hashtags: [], savedAt: Date.now() };
    const extra = String(sh.text || "").replace(found, "").trim();
    if (extra) { item.text = extra; item.hashtags = P.extractHashtags(extra); }
    if (sh.title && !/^(instagram|facebook|youtube)$/i.test(sh.title.trim())) item.title = sh.title.trim();
    if (c.net === "youtube") {
      try {
        const j = await (await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(c.url))).json();
        item.title = j.title || item.title; item.author = j.author_name || ""; item.thumb = j.thumbnail_url; item.hashtags = [...new Set([...item.hashtags, ...P.extractHashtags(j.title || "")])];
      } catch { /* sin datos extra */ }
    }
    await importPackage({ colecta: 2, source: c.net, sources: [{ net: c.net, id: "share:" + c.net, name: "Compartidos", count: 1 }], items: [item] });
  }

  // Instalable como app (necesario para aparecer en el menú Compartir)
  if ("serviceWorker" in navigator && location.protocol === "https:" && !/\/sites\/proxy\//.test(location.pathname)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  /* ---------- Sesión ---------- */
  let authMode = "login";
  function setAuthMode(m) {
    authMode = m;
    $("#authTitle").textContent = m === "login" ? "Ingresá a Colecta" : "Creá tu cuenta";
    $("#authSubmit").textContent = m === "login" ? "Ingresar" : "Crear cuenta";
    $("#authSwitch").innerHTML = m === "login" ? '¿No tenés cuenta? <button type="button" id="toSignup">Registrate</button>' : '¿Ya tenés cuenta? <button type="button" id="toLogin">Ingresá</button>';
    $("#authPass").autocomplete = m === "login" ? "current-password" : "new-password";
    $("#authMsg").textContent = "";
    ($("#toSignup") || $("#toLogin")).onclick = () => setAuthMode(m === "login" ? "signup" : "login");
  }
  setAuthMode("login");
  $("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#authEmail").value.trim(), pass = $("#authPass").value, msg = $("#authMsg"), btn = $("#authSubmit");
    msg.className = "auth-msg"; btn.disabled = true;
    try {
      if (authMode === "login") await DB.signIn(email, pass);
      else {
        if (pass.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
        const r = await DB.signUp(email, pass);
        if (r.needsConfirm) { msg.textContent = "Te enviamos un email de confirmación. Abrilo y después ingresá acá. Si no llega en unos minutos, revisá la carpeta de spam."; msg.classList.add("ok"); setAuthMode("login"); $("#authMsg").textContent = "Revisá tu correo (también spam) para confirmar la cuenta y luego ingresá."; $("#authMsg").classList.add("ok"); }
      }
    } catch (err) {
      const m = err.message || "";
      const notConfirmed = /not confirmed/i.test(m);
      const t = /invalid login/i.test(m) ? "Email o contraseña incorrectos."
        : notConfirmed ? "Tenés que confirmar tu email antes de ingresar."
        : /already registered/i.test(m) ? "Ese email ya tiene cuenta. Ingresá."
        : /rate limit|too many|429/i.test(m) ? "Se alcanzó el límite de correos por hora del servidor. Probá de nuevo en un rato."
        : /sending|smtp|confirmation email/i.test(m) ? "No se pudo enviar el correo de confirmación. Probá de nuevo en unos minutos."
        : /not authorized/i.test(m) ? "El servidor de correo todavía no puede enviar a esta dirección. Avisale al administrador de Colecta."
        : /password should|weak|at least/i.test(m) ? "La contraseña no cumple los requisitos de seguridad."
        : /invalid email|valid email|email address .* invalid/i.test(m) ? "Ese email no es válido."
        : friendlyErr(err);
      msg.textContent = t; msg.classList.add("bad");
      if (notConfirmed) {
        const email = $("#authEmail").value.trim();
        const b = document.createElement("button");
        b.type = "button"; b.className = "linkbtn"; b.textContent = " Reenviar el correo de confirmación";
        b.onclick = async () => {
          b.disabled = true;
          try { await DB.resendConfirm(email); msg.textContent = "Te reenviamos el correo a " + email + ". Revisá también la carpeta de spam."; msg.classList.remove("bad"); msg.classList.add("ok"); }
          catch (e2) { msg.textContent = /rate limit|too many|429|security purposes/i.test(e2.message) ? "Esperá un minuto antes de pedir otro correo." : friendlyErr(e2); }
        };
        msg.appendChild(b);
      }
    } finally { btn.disabled = false; }
  };
  $("#logoutBtn").onclick = () => DB.signOut();

  async function onLogin(user) {
    currentUser = user;
    document.body.classList.add("authed");
    $("#userEmail").textContent = user.email;
    setSync("Cargando…");
    try {
      const retry = async (fn) => { for (let a = 0; ; a++) { try { return await fn(); } catch (e) { if (a >= 3) throw e; await new Promise((r) => setTimeout(r, 800 * (a + 1))); } } };
      const rows = await retry(() => DB.loadItems());
      const st = await retry(() => DB.loadSettings());
      items = rows;
      synonymsText = st.synonyms || "";
      sourceMap = st.source_map || {};
      $("#ytKey").value = st.yt_key || ""; $("#metaToken").value = st.meta_token || "";
      setSync("Guardado");
      $("#log").textContent = "";
      log(items.length ? `Tenés ${items.length} enlaces guardados en tu cuenta.` : "Tu cuenta está vacía. Importá tu primera colección desde un enlace.");
    } catch (err) { setSync("Error al cargar", true); log("✗ " + friendlyErr(err)); }
    updateStatus();
    state.selected = null; state.tagFilter = null;
    show("groups");
    runPending();
  }
  function onLogout() {
    currentUser = null; items = []; synonymsText = ""; sourceMap = {}; state.selected = null;
    document.body.classList.remove("authed");
    ["#ytKey", "#metaToken", "#authPass"].forEach((s) => ($(s).value = ""));
    $("#log").textContent = ""; updateStatus();
  }
  DB.onAuth((user) => {
    if (user && user.id !== currentUser?.id) { currentUser = user; setTimeout(() => onLogin(user), 0); }
    else if (!user && currentUser) onLogout();
  });
  updateStatus();
})();
