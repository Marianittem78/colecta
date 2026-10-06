/* Colecta — capa de datos con Supabase (auth email+contraseña, tablas items y settings con RLS) */
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
    onAuth(cb) { sb.auth.onAuthStateChange((_e, session) => cb(session?.user || null)); },
    // captchaToken: token de Cloudflare Turnstile (Supabase lo exige si la protección anti-bots está activa)
    async signIn(email, password, captchaToken) {
      const { error } = await sb.auth.signInWithPassword({ email, password, options: { captchaToken } });
      if (error) throw error;
    },
    async signUp(email, password, captchaToken) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split("#")[0], captchaToken } });
      if (error) throw error;
      return { needsConfirm: !data.session };
    },
    async resendConfirm(email, captchaToken) {
      const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: location.href.split("#")[0], captchaToken } });
      if (error) throw error;
    },
    async signOut() { await sb.auth.signOut(); },

    async loadItems() {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("items").select("*").order("created_at").range(from, from + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) break;
      }
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
