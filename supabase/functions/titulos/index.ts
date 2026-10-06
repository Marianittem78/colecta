// Colecta — función «titulos»: escribe con Claude un título corto y representativo para cada enlace.
// La llama la app con la sesión de la persona: el cliente de Supabase respeta RLS, así que solo
// puede leer y modificar sus propios enlaces. La clave de Anthropic vive en los secretos de la función.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { corsHeaders } from "npm:@supabase/supabase-js@2.117.2/cors";
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { armarPedido, CUPO_DIARIO, type Fila, idsValidos, leerTitulos, MODEL, SCHEMA, SYSTEM } from "./logic.ts";

const ORIGENES = new Set(["https://marianittem78.github.io", "http://localhost:8080", "http://127.0.0.1:8080"]);
const URL_SB = Deno.env.get("SUPABASE_URL")!;
// Claves nuevas (JSON con nombre «default»); si no están, las de formato anterior
function clave(nuevas: string, legado: string): string {
  try { return JSON.parse(Deno.env.get(nuevas) ?? "{}").default || Deno.env.get(legado) || ""; } catch { return Deno.env.get(legado) || ""; }
}
const PUBLICA = clave("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const SECRETA = clave("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const sinSesion = { persistSession: false, autoRefreshToken: false };

Deno.serve(async (req) => {
  const origen = req.headers.get("Origin") ?? "";
  const h = {
    ...corsHeaders,
    "Access-Control-Allow-Origin": ORIGENES.has(origen) ? origen : "https://marianittem78.github.io",
    "Access-Control-Expose-Headers": "Retry-After",
    Vary: "Origin",
  };
  const responder = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...h, "Content-Type": "application/json", ...extra } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return responder({ error: "metodo" }, 405);

  if (!URL_SB || !PUBLICA || !SECRETA) { console.error("faltan claves de Supabase"); return responder({ error: "config" }, 500); }
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return responder({ error: "sin_clave" }, 503);

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(URL_SB, PUBLICA, { global: { headers: { Authorization: auth } }, auth: sinSesion });
  const { data: u, error: eu } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (eu || !u?.user) return responder({ error: "sesion" }, 401);

  let cuerpo: unknown = null;
  try { cuerpo = await req.json(); } catch { /* sin cuerpo */ }
  const ids = idsValidos((cuerpo as { ids?: unknown } | null)?.ids);
  if (!ids.length) return responder({ titulos: [] });

  // Solo los enlaces de esta persona que todavía no tienen título
  const { data: filas, error: ef } = await sb.from("items")
    .select("id, net, collection, url, title, author, body, hashtags").in("id", ids).is("short_title", null);
  if (ef) { console.error("items", ef.message); return responder({ error: "base" }, 500); }
  if (!filas?.length) return responder({ titulos: [] });

  // Cupo diario por persona: lo lleva la base y desde la app no se puede leer ni tocar
  const admin = createClient(URL_SB, SECRETA, { auth: sinSesion });
  const cupo = (n: number) => admin.rpc("take_title_quota", { uid: u.user.id, n, cap: CUPO_DIARIO });
  const { data: hayCupo, error: ec } = await cupo(filas.length);
  if (ec) { console.error("cupo", ec.message); return responder({ error: "base" }, 500); }
  if (!hayCupo) return responder({ error: "cupo" }, 429);
  const devolver = () => cupo(-filas.length);

  const claude = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  const r = await claude.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    // Si el modelo declina por política, la API reintenta sola con el modelo de respaldo recomendado
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: armarPedido(filas as Fila[]) }],
  }).catch((fallo: unknown) => ({ fallo }));
  if ("fallo" in r) {
    const e = r.fallo;
    await devolver();
    if (e instanceof Anthropic.RateLimitError) return responder({ error: "ocupado" }, 429, { "Retry-After": e.headers?.get("retry-after") ?? "20" });
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.error("anthropic clave", e.status);
      return responder({ error: "sin_clave" }, 503);
    }
    if (e instanceof Anthropic.APIError) { console.error("anthropic", e.status, e.message); return responder({ error: "ia" }, 502); }
    console.error("anthropic conexion", String(e));
    return responder({ error: "ia" }, 502);
  }

  if (r.stop_reason === "refusal") return responder({ titulos: [], rechazo: true });
  const texto = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const titulos = leerTitulos(texto, filas as Fila[]);

  // Se guarda con la sesión de la persona (RLS) y sin pisar un título que haya aparecido mientras tanto
  const guardados = await Promise.all(titulos.map(async (t) => {
    const { error } = await sb.from("items").update({ short_title: t.titulo }).eq("id", t.id).is("short_title", null);
    if (error) console.error("guardar", error.message);
    return error ? null : t;
  }));
  return responder({ titulos: guardados.filter(Boolean) });
});
