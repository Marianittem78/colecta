/* Colecta — capa de datos con Supabase (auth email+contraseña o Google, tablas items y settings con RLS) */
(function () {
  const SUPABASE_URL = "https://rlbxanqztphlwqivahzx.supabase.co";
  const SUPABASE_KEY = "sb_publishable_vGH1wqw-NJZZ6LAmpauqvQ_J4Ti9TY_";

  // Sesión en memoria: la vista previa no permite almacenamiento del navegador
  const mem = {};
  const memoryStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = v; },
    removeItem: (k) => { delete mem[k]; },
  };

  // En la app publicada la sesión queda guardada en el dispositivo; en la vista previa, solo en memoria
  const published = location.protocol === "https:" && /\.github\.io$/.test(location.hostname);
  let storage = memoryStorage;
  if (published) { try { const ls = window["local" + "Storage"]; ls.setItem("colecta:t", "1"); ls.removeItem("colecta:t"); storage = ls; } catch { storage = memoryStorage; } }

  // Lo que trae la dirección al volver de un enlace de Supabase (recuperar contraseña, enlace vencido, Google cancelado).
  // Se lee antes de crear el cliente, que procesa y limpia la sesión del enlace; los errores se sacan de la barra acá.
  const urlParams = new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
  const fromUrl = { recovery: urlParams.get("type") === "recovery", error: urlParams.get("error_code") || urlParams.get("error") || "" };
  if (fromUrl.error) {
    const clean = new URLSearchParams(location.search);
    ["error", "error_code", "error_description"].forEach((k) => clean.delete(k));
    history.replaceState(history.state, "", location.pathname + (clean.toString() ? "?" + clean : ""));
  }
  // A dónde vuelve la persona desde el correo o desde Google (conserva ?url= de Compartir)
  const here = () => location.href.split("#")[0];

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { storage, storageKey: "colecta-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const toRow = (i, userId) => ({
    ...(i.id ? { id: i.id } : {}),
    user_id: userId,
    net: i.net,
    collection: i.collection,
    url: i.url,
    video_id: i.videoId || null,
    title: i.title || "",
    author: i.author || "",
    body: i.text || "",
    hashtags: i.hashtags || [],
    thumb: i.thumb || null,
    saved_at: i.savedAt ? new Date(i.savedAt).toISOString() : null,
    enriched: !!i.enriched,
    truncated: !!i.truncated,
  });
  const fromRow = (r) => ({
    id: r.id, net: r.net, collection: r.collection, url: r.url, videoId: r.video_id || undefined,
    title: r.title || "", author: r.author || "", text: r.body || "", hashtags: r.hashtags || [],
    thumb: r.thumb || undefined, savedAt: r.saved_at ? Date.parse(r.saved_at) : null, enriched: r.enriched, truncated: !!r.truncated,
    addedAt: r.created_at ? Date.parse(r.created_at) : null,
    shortTitle: r.short_title || "", // título escrito por la IA (lo guarda la función «titulos»; toRow no lo toca)
  });

  async function userId() {
    const { data } = await sb.auth.getUser();
    return data.user?.id;
  }

  window.DB = {
    client: sb,
    fromUrl,
    onAuth(cb) { sb.auth.onAuthStateChange((event, session) => cb(session?.user || null, event)); },
    // captchaToken: token de Cloudflare Turnstile (Supabase lo exige si la protección anti-bots está activa)
    async signIn(email, password, captchaToken) {
      const { error } = await sb.auth.signInWithPassword({ email, password, options: { captchaToken } });
      if (error) throw error;
    },
    async signUp(email, password, captchaToken) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: here(), captchaToken } });
      if (error) throw error;
      // Si el email ya tiene una cuenta confirmada, Supabase responde como si fuera nueva pero NO manda ningún correo
      // (para no revelar qué emails están registrados). La señal es que el usuario vuelve sin identidades.
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new Error("User already registered");
      return { needsConfirm: !data.session };
    },
    async resendConfirm(email, captchaToken) {
      const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: here(), captchaToken } });
      if (error) throw error;
    },
    // Manda el correo con el enlace para elegir una contraseña nueva (si el email no tiene cuenta, no manda nada y no avisa)
    async resetPassword(email, captchaToken) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname, captchaToken });
      if (error) throw error;
    },
    async setPassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
    },
    // Va a Google y vuelve con la sesión en la dirección (la toma detectSessionInUrl). Si el email ya tenía cuenta,
    // Supabase le suma Google a esa misma cuenta.
    async signInWithGoogle() {
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: here(), queryParams: { prompt: "select_account" } } });
      if (error) throw error;
    },
    // Proveedores habilitados en Supabase: el botón de Google aparece solo cuando Google está activo
    async providers() {
      const r = await fetch(SUPABASE_URL + "/auth/v1/settings", { headers: { apikey: SUPABASE_KEY } });
      if (!r.ok) throw new Error("auth_settings " + r.status);
      return (await r.json()).external || {};
    },
    async signOut() { await sb.auth.signOut(); },

    // Se trae de a 1000 con un orden total (fecha + id): muchos enlaces comparten la misma fecha (se guardan
    // en lotes) y, ordenando solo por fecha, cada página podía repetir unos y saltear otros.
    // Además se descartan repetidos y se compara con el total de la base: si no coincide, la carga falla.
    async loadItems() {
      const all = [], seen = new Set();
      let total = null;
      for (let from = 0; ; from += 1000) {
        const { data, error, count } = await sb.from("items").select("*", from ? undefined : { count: "exact" })
          .order("created_at").order("id").range(from, from + 999);
        if (error) throw error;
        if (typeof count === "number") total = count;
        for (const r of data) if (!seen.has(r.id)) { seen.add(r.id); all.push(r); }
        if (data.length < 1000) break;
      }
      if (total !== null && all.length !== total) throw new Error("colecta_carga_incompleta: " + all.length + " de " + total);
      return all.map(fromRow);
    },
    // Inserta o actualiza; devuelve las filas con su id
    async upsertItems(list) {
      const uid = await userId();
      const out = [];
      for (let k = 0; k < list.length; k += 500) {
        const rows = list.slice(k, k + 500).map((i) => toRow(i, uid));
        const { data, error } = await sb.from("items").upsert(rows, { onConflict: "user_id,net,url,collection" }).select();
        if (error) throw error;
        out.push(...data.map(fromRow));
      }
      return out;
    },
    async deleteItems(ids) {
      for (let k = 0; k < ids.length; k += 200) {
        const { error } = await sb.from("items").delete().in("id", ids.slice(k, k + 200));
        if (error) throw error;
      }
    },
    async renameItems(ids, name) {
      for (let k = 0; k < ids.length; k += 200) {
        const { error } = await sb.from("items").update({ collection: name }).in("id", ids.slice(k, k + 200));
        if (error) throw error;
      }
    },
    // Pide a la función «titulos» los títulos de hasta 20 enlaces. Devuelve { titulos } o { error, espera }
    async makeTitles(ids) {
      const { data, error } = await sb.functions.invoke("titulos", { body: { ids } });
      if (!error) return { titulos: Array.isArray(data?.titulos) ? data.titulos : [] };
      const res = error.context;
      if (!res || typeof res.status !== "number") return { error: "red" };
      let code = "http";
      try { code = (await res.clone().json()).error || code; } catch { /* sin cuerpo JSON */ }
      return { error: code, espera: Number(res.headers.get("Retry-After")) || 0 };
    },
    // Pide a la función «threads» la publicación a la que lleva un enlace corto de Threads.
    // Devuelve { url, author, text } o null si no se pudo
    async resolveThreads(url) {
      try {
        const { data, error } = await sb.functions.invoke("threads", { body: { url } });
        return !error && data && typeof data.url === "string" ? data : null;
      } catch { return null; }
    },
    // Borra el título de la IA para que se vuelva a escribir (cuando cambió el contenido)
    async resetTitles(ids) {
      for (let k = 0; k < ids.length; k += 200) {
        const { error } = await sb.from("items").update({ short_title: null }).in("id", ids.slice(k, k + 200));
        if (error) throw error;
      }
    },
    async deleteAll() {
      const uid = await userId();
      const { error } = await sb.from("items").delete().eq("user_id", uid);
      if (error) throw error;
    },
    async loadSettings() {
      const { data, error } = await sb.from("settings").select("*").maybeSingle();
      if (error) throw error;
      return data || { synonyms: "", yt_key: "", meta_token: "", source_map: {} };
    },
    async saveSettings(patch) {
      const uid = await userId();
      const { error } = await sb.from("settings").upsert({ user_id: uid, ...patch, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
  };
})();
