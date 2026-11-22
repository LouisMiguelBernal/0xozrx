import type { ScanRecord } from "../types/system";
import { aiChat, modelInfo, pickModel, warmModel } from "../lib/ipc";
import { redact } from "../engine/redaction";
import { useLive, useSettings } from "../store/settings";
import { getLatestScan } from "../scan/scans";
import type { ConsoleEngine } from "../engine/console";
import { ANSI } from "../engine/output";

export const OLLAMA_ENDPOINT = "http://127.0.0.1:11434";

/** The tag this workstation is tuned for; mirrors ai.rs PREFERRED_MODELS[0]. */
export const PREFERRED_MODEL = "gemma4:e4b";

/** Keeps the ~9 GB model resident between questions instead of reloading it. */
export const KEEP_ALIVE = "30m";

const SYSTEM_PROMPT = [
  "You are the 0xOZrx!! local security assistant running fully offline via Ollama.",
  "Audience: the machine's owner performing defensive security on their own system.",
  "Rules:",
  "- Label statements as OBSERVED (present in provided data), INFERRED (your reasoning), or UNKNOWN.",
  "- Never claim you ran a scan or collected data yourself; you only interpret what is given.",
  "- Be concise and structured. Prefer short sections and bullet lists.",
  "- Defensive remediation only; no offensive exploitation guidance.",
  "- If information is missing, say UNKNOWN instead of guessing.",
  "- When you recommend a change, name the exact Windows setting or command and say what it reverts to.",
].join("\n");

let modelCache: string | null = null;

/** Force the next call to re-resolve the model (after `model use`, etc.). */
export function invalidateModelCache(): void {
  modelCache = null;
}

export async function ensureModel(): Promise<string> {
  const pinned = useSettings.getState().preferredModel;
  if (pinned) {
    modelCache = pinned;
    useLive.getState().setAiModel(pinned);
    return pinned;
  }
  if (modelCache) return modelCache;

  const pick = await pickModel(OLLAMA_ENDPOINT);
  useLive.getState().setAiModel(pick.model);
  // Fall back to the tuned tag so the error names something actionable.
  modelCache = pick.model ?? pick.recommended ?? PREFERRED_MODEL;
  return modelCache;
}

/** Load the model into VRAM ahead of the first question. */
export async function warmUp(eng: ConsoleEngine): Promise<void> {
  const model = await ensureModel();
  eng.tag("AI", `warming ${model} (~9 GB for ${PREFERRED_MODEL}) - this is the slow part, once...`);
  const res = await warmModel(OLLAMA_ENDPOINT, model, KEEP_ALIVE);
  if (res.loaded) {
    eng.tag("PASS", `${model} resident in ${(res.load_ms / 1000).toFixed(1)}s · keep_alive ${KEEP_ALIVE}`);
  } else {
    eng.tag("ERROR", `warm-up failed: ${(res.error ?? "unknown").slice(0, 160)}`);
  }
}

/** Print family/quant/context/capabilities for a local tag. */
export async function describeModel(eng: ConsoleEngine, model: string): Promise<void> {
  try {
    const info = await modelInfo(OLLAMA_ENDPOINT, model);
    const kv = (k: string, v: string) => eng.raw(`  ${ANSI.dim(k.padEnd(14))}${v}\r\n`);
    kv("MODEL", info.model + (info.model === PREFERRED_MODEL ? ANSI.color(82, "  ← tuned for this workstation") : ""));
    kv("FAMILY", info.family ?? "unknown");
    kv("PARAMS", info.parameter_size ?? "unknown");
    kv("QUANT", info.quantization ?? "unknown");
    kv("CONTEXT", info.context_length ? `${info.context_length.toLocaleString()} tokens` : "unknown");
    kv("CAPABILITIES", info.capabilities.join(", ") || "none reported");
    if (info.thinking)
      kv("THINKING", `supported · currently ${useSettings.getState().aiThinking ? "ON" : "OFF"} (model think on|off)`);
  } catch (e) {
    eng.tag("ERROR", `model introspection failed: ${String(e).slice(0, 160)}`);
  }
}

export function buildScanContext(scan: ScanRecord | null): string {
  if (!scan) return "";
  const compact = {
    host: scan.host,
    os: scan.os,
    kind: scan.kind,
    score: scan.score.total,
    counts: scan.score.counts,
    exposure: scan.exposure,
    findings: scan.findings.slice(0, 25).map((f) => ({
      id: f.id,
      sev: f.severity,
      cat: f.category,
      title: f.title,
      evidence: f.evidence.slice(0, 300),
    })),
  };
  return `\n\nSCAN CONTEXT (machine-generated, treat as OBSERVED):\n${redact(JSON.stringify(compact))}`;
}

interface ChatMsg {
  role: string;
  content: string;
}
const history: ChatMsg[] = [];

export function resetAiHistory(): void {
  history.length = 0;
}

export async function askAi(
  eng: ConsoleEngine,
  prompt: string,
  opts: { withScan?: boolean } = {}
): Promise<void> {
  const online = useLive.getState().ollamaOnline;
  if (online === false) {
    eng.tag("AI", "OLLAMA OFFLINE - start Ollama (docs/OLLAMA.md). Everything else keeps working.");
    return;
  }
  let ctx = "";
  if (opts.withScan) {
    ctx = buildScanContext(getLatestScan());
    if (!ctx) eng.tag("DIM", "no stored scan yet - answering without scan context");
  }
  const think = useSettings.getState().aiThinking;
  eng.tag(
    "AI",
    `thinking (${useLive.getState().aiModel ?? "detecting model..."}${think ? " · reasoning ON" : ""}) - cold models may need a minute to load into VRAM...`
  );
  try {
    const model = await ensureModel();
    const messages: ChatMsg[] = [
      { role: "system", content: SYSTEM_PROMPT + (ctx || "") },
      ...history,
      { role: "user", content: prompt },
    ];
    const reply = await aiChat(OLLAMA_ENDPOINT, model, messages, 600, {
      keepAlive: KEEP_ALIVE,
      think,
      options: { temperature: 0.4, num_ctx: 8192 },
    });
    history.push({ role: "user", content: prompt });
    history.push({ role: "assistant", content: reply.content });
    while (history.length > 8) history.shift();

    eng.raw("\r\n");
    if (think && reply.thinking) {
      eng.raw(ANSI.dim("── reasoning ──") + "\r\n");
      for (const line of reply.thinking.replace(/\r?\n/g, "\r\n").split("\r\n"))
        eng.raw(ANSI.dim(line) + "\r\n");
      eng.raw(ANSI.dim("───────────────") + "\r\n\r\n");
    }
    for (const line of reply.content.replace(/\r?\n/g, "\r\n").split("\r\n")) eng.raw(line + "\r\n");

    const meta = [
      `[${reply.model}]`,
      `${((reply.latency_ms ?? 0) / 1000).toFixed(1)}s`,
      reply.response_tokens ? `${reply.response_tokens} out tokens` : null,
      // A big load time is the cold-start tell, so surface it rather than hide it.
      reply.load_ms && reply.load_ms > 1500 ? `${(reply.load_ms / 1000).toFixed(1)}s cold load` : null,
    ].filter(Boolean);
    eng.raw(`\r\n\x1b[2m${meta.join(" · ")}\x1b[0m\r\n`);
  } catch (e) {
    eng.tag("ERROR", `AI request failed: ${String(e).slice(0, 160)}`);
  }
}

/** Handler used by the ai> REPL mode inside the terminal. */
export async function handleAiLine(eng: ConsoleEngine, line: string): Promise<void> {
  if (!line.trim()) return;
  await askAi(eng, line);
}
