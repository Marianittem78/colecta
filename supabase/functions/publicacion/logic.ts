// Lógica pura de la función «publicacion» (sin Deno ni red), para poder probarla con Node.
// Al compartir desde la app de Instagram o de Facebook llega solo la dirección; esto arma, a partir
// de lo que esas páginas devuelven sin sesión, el autor y el texto de la publicación.

export type Publicacion = { url: string; author: string; text: string };
export type Pedido = { net: "instagram" | "facebook"; fetch: string; url: string };

const MAX_TEXTO = 2000;

// Qué página se abre para cada enlace. Solo direcciones de publicaciones de esas dos redes, rearmadas
// desde cero (nunca se abre lo que llegó tal cual), para no ser un proxy abierto.
export function pedido(u: unknown): Pedido | null {
  if (typeof u !== "string" || u.length > 500) return null;
  let x: URL;
  try { x = new URL(u); } catch { return null; }
  if (x.protocol !== "https:") return null;
  const h = x.hostname.toLowerCase().replace(/^(www|m|web|mobile)\./, ""), p = x.pathname;
  if (h === "instagram.com") {
    // La página de inserción oficial trae el texto completo y el autor; la común no los trae sin sesión
    const m = p.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]{5,64})\/?/);
    if (!m) return null;
    const tipo = m[1] === "reels" ? "reel" : m[1];
    const base = `https://www.instagram.com/${tipo}/${m[2]}/`;
    return { net: "instagram", fetch: base + "embed/captioned/", url: base };
  }
  if (h === "facebook.com") {
    const q = x.searchParams;
    const n = (k: string) => { const v = q.get(k); return v && /^\d{1,25}$/.test(v) ? v : null; };
    let ruta: string | null = null;
    const share = p.match(/^\/share\/(?:([a-z])\/)?([\w-]{3,64})\/?$/i);
    if (share) ruta = `/share/${share[1] ? share[1] + "/" : ""}${share[2]}/`;
    else if (/^\/reel\/\d{1,25}\/?$/.test(p) || /^\/[\w.-]{1,80}\/(posts|videos)\/[\w.%-]{1,300}\/?$/.test(p)) ruta = p;
    else if (/^\/watch\/?$/.test(p) && n("v")) ruta = `/watch/?v=${n("v")}`;
    else if (/^\/(story|permalink)\.php$/.test(p) && n("story_fbid") && n("id")) ruta = `${p}?story_fbid=${n("story_fbid")}&id=${n("id")}`;
    if (!ruta) return null;
    const d = "https://www.facebook.com" + ruta;
    return { net: "facebook", fetch: d, url: d };
  }
  if (h === "fb.watch") {
    const m = p.match(/^\/([\w-]{3,40})\/?$/);
    return m ? { net: "facebook", fetch: `https://fb.watch/${m[1]}/`, url: `https://fb.watch/${m[1]}/` } : null;
  }
  return null;
}

function entidades(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function meta(html: string, prop: string): string {
  const tag = html.match(new RegExp(`<meta\\s[^>]*(?:property|name)="${prop}"[^>]*>`, "i"))?.[0] ?? "";
  const v = tag.match(/\scontent="([^"]*)"/i)?.[1];
  return v === undefined ? "" : entidades(v).trim();
}

function limpiar(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXTO);
}

// Instagram, página /embed/captioned/: <div class="Caption"><a class="CaptionUsername" …>usuario</a>texto…
// <div class="CaptionComments">. Sin texto (o publicación +18 / de cuenta limitada) no hay Caption.
export function leerInstagram(base: string, html: string): Publicacion | null {
  const user = (html.match(/class="CaptionUsername"[^>]*>([\w.]{1,30})</) ?? html.match(/class="UsernameText"[^>]*>([\w.]{1,30})</))?.[1] ?? "";
  const cap = html.match(/<div class="Caption">([\s\S]*?)(?:<div class="CaptionComments"|<\/div>)/)?.[1] ?? "";
  const text = limpiar(entidades(
    cap.replace(/^\s*<a class="CaptionUsername"[\s\S]*?<\/a>/, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  ));
  if (!user && !text) return null;
  return { url: base, author: user ? "@" + user : "", text };
}

// Dirección final de Facebook sin lo que agrega al redirigir (?rdid=…&share_url=…), salvo los
// parámetros que identifican la publicación
function fbLimpia(u: string): string | null {
  let x: URL;
  try { x = new URL(u); } catch { return null; }
  if (x.protocol !== "https:" || !/^(www\.|m\.|web\.)?facebook\.com$/i.test(x.hostname)) return null;
  if (/^\/(share|login|checkpoint)(\/|\.php|$)/.test(x.pathname)) return null;
  const q = new URLSearchParams();
  for (const k of ["v", "story_fbid", "id", "fbid"]) { const v = x.searchParams.get(k); if (v && /^\d{1,25}$/.test(v)) q.set(k, v); }
  return "https://www.facebook.com" + x.pathname + (q.size ? "?" + q : "");
}

function palabras(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// «a | b | Facebook» → ["a", "b"], sin las cifras que Facebook antepone en los reels
// («86 mil reproducciones · 717 reacciones», «357 reacciones · 104 veces compartido»)
const CIFRAS = /^[\d.,\s]*(mil|k|m|mill\.?)?\s*(reproducciones|reacciones|views|reactions|comentarios|comments|veces compartido|shares)\b/i;
function partes(s: string): string[] {
  return s.replace(/\s*\|\s*Facebook\s*$/i, "").split(" | ").map((x) => x.trim()).filter((x, k) => x && !(k === 0 && CIFRAS.test(x)) && !/^facebook$/i.test(x));
}

// Facebook, sin sesión. Publicación de una página o persona: og:title es el autor; <title> es
// «primera línea… - Autor | Facebook»; og:url lleva el comienzo del texto como palabras con guiones.
// Reel: og:title es «cifras | texto | Autor» (o «cifras | Autor on Reels»). Grupo: <title> es
// «Grupo | texto» y og:title, el texto. og:description, si viene, es el texto (a veces recortado).
export function leerFacebook(original: string, urlFinal: string, html: string): Publicacion | null {
  const ogTitle = meta(html, "og:title");
  // Sin og: es la página de ingreso o de error, no la publicación
  if (!ogTitle && !meta(html, "og:description")) return null;
  const titulo = entidades(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const og = partes(ogTitle), tt = partes(titulo);
  let grupo = false;
  try { grupo = /^\/groups\//.test(new URL(urlFinal).pathname); } catch { /* no es una dirección */ }
  let author: string, desdeTitulo: string, inicio = "";
  if (grupo) {
    // De un grupo se toma el nombre del grupo como autor
    author = tt[0] ?? "";
    desdeTitulo = og.filter((x) => palabras(x) !== palabras(author)).join("\n");
    if (!desdeTitulo) inicio = tt.slice(1).join("\n");
  } else {
    author = og.length >= 2 ? og[og.length - 1] : og[0] ?? "";
    desdeTitulo = og.length >= 2 ? og.slice(0, -1).join("\n") : "";
    inicio = tt.join(" | ");
    const sep = inicio.lastIndexOf(" - ");
    if (sep > 0) {
      const fin = inicio.slice(sep + 3).trim();
      if (!author || palabras(author) === palabras(fin)) { author = fin; inicio = inicio.slice(0, sep).trim(); }
    }
  }
  author = author.replace(/\s+(on|en) Reels$/i, "").trim();
  if (palabras(inicio) === palabras(author)) inicio = "";
  inicio = (desdeTitulo || inicio).replace(/(\.\.\.|…)$/, "").trim();
  // El comienzo del texto que está en la dirección suele ser más largo que el título
  const ogUrl = meta(html, "og:url");
  let slug = "";
  try { slug = decodeURIComponent(new URL(ogUrl).pathname.match(/\/posts\/([^/]+)\/\d+\/?$/)?.[1] ?? "").replace(/-/g, " ").trim(); } catch { /* sin og:url */ }
  const resto = slug && palabras(slug).startsWith(palabras(inicio)) && slug.length > inicio.length ? slug : inicio;
  let desc = meta(html, "og:description");
  if (palabras(desc) === palabras(author) || /^facebook$/i.test(desc)) desc = "";
  // og:description a veces viene más recortado que el texto del título
  const text = limpiar(palabras(resto).length > palabras(desc).length + 20 ? resto : desc || resto);
  if (/^facebook$/i.test(author)) author = "";
  if (!author && !text) return null;
  const url = fbLimpia(urlFinal) ?? original;
  return { url, author: author.slice(0, 200), text };
}
