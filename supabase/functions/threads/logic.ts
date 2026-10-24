// Lógica pura de la función «threads» (sin Deno ni red), para poder probarla con Node.

export type Publicacion = { url: string; author: string; text: string };

// Enlace corto que arma la app de Threads al compartir: https://www.threads.com/share/<código>/
export function codigoShare(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 300) return null;
  let x: URL;
  try { x = new URL(u); } catch { return null; }
  if (x.protocol !== "https:" || !/^(www\.)?threads\.(com|net)$/i.test(x.hostname)) return null;
  const m = x.pathname.match(/^\/share\/([\w-]{3,64})\/?$/);
  return m ? m[1] : null;
}

function entidades(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function meta(html: string, prop: string): string {
  const tag = html.match(new RegExp(`<meta\\s[^>]*(?:property|name)="${prop}"[^>]*>`, "i"))?.[0] ?? "";
  const v = tag.match(/\scontent="([^"]*)"/i)?.[1];
  return v === undefined ? "" : entidades(v);
}

function post(u: string): { user: string; code: string } | null {
  let p = "";
  try { p = decodeURIComponent(new URL(u).pathname); } catch { return null; }
  const m = p.match(/^\/@([\w.]+)\/post\/([\w-]+)/);
  return m ? { user: m[1], code: m[2] } : null;
}

// La publicación a la que llevó el enlace corto: por la dirección final o, si no, por og:url
export function leerPublicacion(urlFinal: string, html: string): Publicacion | null {
  const p = post(urlFinal) ?? post(meta(html, "og:url"));
  if (!p) return null;
  const text = meta(html, "og:description").replace(/\r\n?/g, "\n").trim().slice(0, 2000);
  return { url: `https://www.threads.com/@${p.user}/post/${p.code}`, author: "@" + p.user, text };
}
