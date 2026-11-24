// Servidor que imita la Messages API de Anthropic, SOLO para probar el proxy /asistente en local
// sin gastar ni exponer una API key real. Responde en el formato real (JSON o SSE).
// Uso: node tools/anthropic-simulado.js [puerto]
//   y en api/config.php local:  'anthropic' => ['api_key' => 'clave-de-prueba', 'url' => 'http://127.0.0.1:8126/v1/messages', ...]
// La última consulta del usuario decide el comportamiento:
//   "saturado" → 529 · "rechaza-extras" → 400 si la petición trae opciones avanzadas · "rechazo" → stop_reason refusal
//   "largo" → stop_reason max_tokens · "sin-llave" → 401 · cualquier otra → respuesta normal
// GET /ultima devuelve la última petición recibida, para comprobar qué mandó el proxy.
import { createServer } from "node:http";

const PUERTO = Number(process.argv[2] || 8126);
const CLAVE = "clave-de-prueba";
let ultima = null;
const json = (res, estado, obj) => res.writeHead(estado, { "Content-Type": "application/json" }).end(JSON.stringify(obj));
const error = (res, estado, tipo, mensaje) => json(res, estado, { type: "error", error: { type: tipo, message: mensaje } });

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/ultima") return json(res, 200, ultima);
  let crudo = "";
  req.on("data", d => { crudo += d; });
  req.on("end", async () => {
    if (req.method !== "POST" || req.url !== "/v1/messages") return error(res, 404, "not_found_error", "ruta");
    let b; try { b = JSON.parse(crudo); } catch (e) { return error(res, 400, "invalid_request_error", "json"); }
    ultima = { cabeceras: { "x-api-key": req.headers["x-api-key"] ? "(presente)" : "(falta)", "anthropic-version": req.headers["anthropic-version"], "anthropic-beta": req.headers["anthropic-beta"] || null }, cuerpo: b };
    if (req.headers["x-api-key"] !== CLAVE) return error(res, 401, "authentication_error", "invalid x-api-key");
    if (!req.headers["anthropic-version"]) return error(res, 400, "invalid_request_error", "anthropic-version header is required");
    if (!b.model || !b.max_tokens || !Array.isArray(b.messages) || b.messages[0]?.role !== "user") return error(res, 400, "invalid_request_error", "messages: first message must use the user role");
    if ("temperature" in b || "top_p" in b) return error(res, 400, "invalid_request_error", "sampling parameters are not supported");
    const q = String(b.messages[b.messages.length - 1].content);
    if (q.includes("saturado")) return error(res, 529, "overloaded_error", "Overloaded");
    if (q.includes("sin-llave")) return error(res, 401, "authentication_error", "invalid x-api-key");
    if (q.includes("rechaza-extras") && ("fallbacks" in b || "output_config" in b || "cache_control" in b)) return error(res, 400, "invalid_request_error", "fallbacks: Extra inputs are not permitted");
    const stop = q.includes("rechazo") ? "refusal" : q.includes("largo") ? "max_tokens" : "end_turn";
    const texto = stop === "refusal" ? "" : `Respuesta simulada a: «${q.slice(0, 60)}». Según IEEE 43-2013, el mínimo es 5 MΩ a 40 °C. Paso recibido: ${/Paso actual: ([^\n]*)/.exec(JSON.stringify(b.system))?.[1]?.slice(0, 50) || "s/d"}`;
    const sistema = JSON.stringify(b.system || "").length, uso = { input_tokens: 40 + q.length, cache_creation_input_tokens: 0, cache_read_input_tokens: Math.round(sistema / 4), output_tokens: Math.ceil(texto.length / 4) };
    if (!b.stream) return json(res, 200, { id: "msg_sim", type: "message", role: "assistant", model: b.model, content: [{ type: "thinking", thinking: "", signature: "sim" }, { type: "text", text: texto }], stop_reason: stop, stop_details: null, usage: uso });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const ev = (tipo, datos) => res.write(`event: ${tipo}\ndata: ${JSON.stringify({ type: tipo, ...datos })}\n\n`);
    ev("message_start", { message: { id: "msg_sim", type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, usage: { ...uso, output_tokens: 1 } } });
    ev("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } });
    ev("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sim" } });
    ev("content_block_stop", { index: 0 });
    ev("ping", {});
    ev("content_block_start", { index: 1, content_block: { type: "text", text: "" } });
    for (const palabra of texto.split(/(?<= )/)) { ev("content_block_delta", { index: 1, delta: { type: "text_delta", text: palabra } }); await new Promise(r => setTimeout(r, 25)); }
    ev("content_block_stop", { index: 1 });
    ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: uso.output_tokens } });
    ev("message_stop", {});
    res.end();
  });
}).listen(PUERTO, "127.0.0.1", () => console.log(`Anthropic simulado en http://127.0.0.1:${PUERTO}/v1/messages`));
