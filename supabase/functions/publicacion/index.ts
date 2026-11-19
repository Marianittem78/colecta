// Colecta — función «publicacion»: al compartir desde la app de Instagram o de Facebook llega solo la
// dirección, sin texto ni autor, y la IA de títulos termina escribiendo algo genérico. Esta función abre
// la publicación (sin cuenta ni datos de la persona) y devuelve el autor y el texto que esas páginas dan
// sin sesión. Instagram: su página de inserción oficial (/embed/captioned/). Facebook: la publicación,
// siguiendo el enlace corto /share/… si hace falta. Solo atiende a personas con sesión y solo abre
// direcciones de publicaciones de esas dos redes, para no ser un proxy abierto.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { corsHeaders } from "npm:@supabase/supabase-js@2.117.2/cors";
import { leerFacebook, leerInstagram, pedido } from "./logic.ts";

const ORIGENES = new Set(["https://marianittem78.github.io", "http://localhost:8080", "http://127.0.0.1:8080"]);
const URL_SB = Deno.env.get("SUPABASE_URL")!;
function clave(nuevas: string, legado: string): string {
  try { return JSON.parse(Deno.env.get(nuevas) ?? "{}").default || Deno.env.get(legado) || ""; } catch { return Deno.env.get(legado) || ""; }
}
const PUBLICA = clave("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const AGENTE = "Mozilla/5.0 (compatible; Colecta/1.0; +https://marianittem78.github.io/colecta/)";
const MAX_PAGINA = 3_000_000;
const HOSTS_FINALES = /^(www\.|m\.|web\.)?(instagram\.com|facebook\.com)$/i;

Deno.serve(async (req) => {
  const origen = req.headers.get("Origin") ?? "";
  const h = { ...corsHeaders, "Access-Control-Allow-Origin": ORIGENES.has(origen) ? origen : "https://marianittem78.github.io", Vary: "Origin" };
  const responder = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...h, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return responder({ error: "metodo" }, 405);
  if (!URL_SB || !PUBLICA) { console.error("faltan claves de Supabase"); return responder({ error: "config" }, 500); }

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(URL_SB, PUBLICA, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: eu } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (eu || !u?.user) return responder({ error: "sesion" }, 401);

  let cuerpo: unknown = null;
  try { cuerpo = await req.json(); } catch { /* sin cuerpo */ }
  const p = pedido((cuerpo as { url?: unknown } | null)?.url);
  if (!p) return responder({ error: "enlace" }, 400);

  let r: Response;
  try {
    r = await fetch(p.fetch, {
      headers: { "User-Agent": AGENTE, "Accept-Language": "es", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error(p.net, "conexion", String(e));
    return responder({ error: "red" }, 502);
  }
  let final = "";
  try { final = new URL(r.url).hostname; } catch { /* queda vacío */ }
  if (!r.ok || !HOSTS_FINALES.test(final)) { console.error(p.net, r.status, final); return responder({ error: "red" }, 502); }
  const html = (await r.text()).slice(0, MAX_PAGINA);
  const pub = p.net === "instagram" ? leerInstagram(p.url, html) : leerFacebook(p.url, r.url, html);
  return pub ? responder(pub) : responder({ error: "no_encontrada" }, 404);
});
