// Colecta — función «threads»: la app de Threads comparte un enlace corto (threads.com/share/<código>/)
// que solo lleva a la publicación cuando lo abre un servidor (desde el navegador lo impide CORS).
// Esta función lo abre, sin cuenta ni datos de la persona, y devuelve la dirección completa de la
// publicación, el autor y el texto. Solo atiende a personas con sesión, para no ser un proxy abierto.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { corsHeaders } from "npm:@supabase/supabase-js@2.117.2/cors";
import { codigoShare, leerPublicacion } from "./logic.ts";

const ORIGENES = new Set(["https://marianittem78.github.io", "http://localhost:8080", "http://127.0.0.1:8080"]);
const URL_SB = Deno.env.get("SUPABASE_URL")!;
function clave(nuevas: string, legado: string): string {
  try { return JSON.parse(Deno.env.get(nuevas) ?? "{}").default || Deno.env.get(legado) || ""; } catch { return Deno.env.get(legado) || ""; }
}
const PUBLICA = clave("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const AGENTE = "Mozilla/5.0 (compatible; Colecta/1.0; +https://marianittem78.github.io/colecta/)";
const MAX_PAGINA = 2_000_000;

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
  const codigo = codigoShare((cuerpo as { url?: unknown } | null)?.url);
  if (!codigo) return responder({ error: "enlace" }, 400);

  let r: Response;
  try {
    r = await fetch(`https://www.threads.com/share/${codigo}/`, {
      headers: { "User-Agent": AGENTE, "Accept-Language": "es" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("threads conexion", String(e));
    return responder({ error: "threads" }, 502);
  }
  if (!r.ok) { console.error("threads", r.status); return responder({ error: "threads" }, 502); }
  const html = (await r.text()).slice(0, MAX_PAGINA);
  const p = leerPublicacion(r.url, html);
  return p ? responder(p) : responder({ error: "no_encontrada" }, 404);
});
