// Colecta — función «titulos»: escribe con IA un título corto y representativo para cada enlace.
// La llama la app con la sesión de la persona: el cliente de Supabase respeta RLS, así que solo
// puede leer y modificar sus propios enlaces. Las claves viven en los secretos de la función:
// con GEMINI_API_KEY usa Gemini; si no, Claude con ANTHROPIC_API_KEY.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { corsHeaders } from "npm:@supabase/supabase-js@2.117.2/cors";
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import {
  armarPedido, CUPO_DIARIO, esperaGemini, type Fila, GEMINI_MODEL, idsValidos, leerGemini, leerTitulos, MODEL, pedidoGemini, SCHEMA, SYSTEM,
} from "./logic.ts";

const ORIGENES = new Set(["https://marianittem78.github.io", "http://localhost:8080", "http://127.0.0.1:8080"]);
const URL_SB = Deno.env.get("SUPABASE_URL")!;
// Claves nuevas (JSON con nombre «default»); si no están, las de formato anterior
function clave(nuevas: string, legado: string): string {
  try { return JSON.parse(Deno.env.get(nuevas) ?? "{}").default || Deno.env.get(legado) || ""; } catch { return Deno.env.get(legado) || ""; }
}
const PUBLICA = clave("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const SECRETA = clave("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const sinSesion = { persistSession: false, autoRefreshToken: false };

// Lo que devuelve cada proveedor: el texto JSON con los títulos, un rechazo, o un error para la app
type Resultado = { texto: string; rechazo?: boolean } | { error: string; status: number; espera?: string };

async function conGemini(apiKey: string, filas: Fila[]): Promise<Resultado> {
  let r: Response;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(pedidoGemini(filas)),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    console.error("gemini conexion", String(e));
    return { error: "ia", status: 502 };
  }
  const cuerpo = await r.json().catch(() => null);
  if (r.status === 429) return { error: "ocupado", status: 429, espera: esperaGemini(cuerpo) };
  if (!r.ok) {
    const msg = String(cuerpo?.error?.message ?? "").slice(0, 300);
    console.error("gemini", r.status, cuerpo?.error?.status ?? "", msg);
    if (r.status === 401 || r.status === 403 || /API key/i.test(msg)) return { error: "sin_clave", status: 503 };
    return { error: "ia", status: 502 };
  }
  return leerGemini(cuerpo);
}

async function conClaude(apiKey: string, filas: Fila[]): Promise<Resultado> {
  const claude = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  const r = await claude.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    // Si el modelo declina por política, la API reintenta sola con el modelo de respaldo recomendado
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: armarPedido(filas) }],
  }).catch((fallo: unknown) => ({ fallo }));
  if ("fallo" in r) {
    const e = r.fallo;
    if (e instanceof Anthropic.RateLimitError) return { error: "ocupado", status: 429, espera: e.headers?.get("retry-after") ?? "20" };
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.error("anthropic clave", e.status);
      return { error: "sin_clave", status: 503 };
    }
    if (e instanceof Anthropic.APIError) { console.error("anthropic", e.status, e.message); return { error: "ia", status: 502 }; }
    console.error("anthropic conexion", String(e));
    return { error: "ia", status: 502 };
  }
  if (r.stop_reason === "refusal") return { texto: "", rechazo: true };
  return { texto: r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("") };
}

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
  const claveGemini = Deno.env.get("GEMINI_API_KEY");
  const claveClaude = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claveGemini && !claveClaude) return responder({ error: "sin_clave" }, 503);

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

  const r = claveGemini ? await conGemini(claveGemini, filas as Fila[]) : await conClaude(claveClaude!, filas as Fila[]);
  if ("error" in r) {
    await devolver();
    return responder({ error: r.error }, r.status, r.espera ? { "Retry-After": r.espera } : {});
  }
  if (r.rechazo) return responder({ titulos: [], rechazo: true });
  const titulos = leerTitulos(r.texto, filas as Fila[]);

  // Se guarda con la sesión de la persona (RLS) y sin pisar un título que haya aparecido mientras tanto
  const guardados = await Promise.all(titulos.map(async (t) => {
    const { error } = await sb.from("items").update({ short_title: t.titulo }).eq("id", t.id).is("short_title", null);
    if (error) console.error("guardar", error.message);
    return error ? null : t;
  }));
  return responder({ titulos: guardados.filter(Boolean) });
});
