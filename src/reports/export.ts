import type { ScanRecord } from "../types/system";
import { redactDeep } from "../engine/redaction";
import { openReportsDir, sha256Hex, writeReport } from "../lib/ipc";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#ff5566",
  HIGH: "#ff9040",
  MEDIUM: "#ffd24a",
  LOW: "#58a6ff",
  INFO: "#8aa39b",
};

export function buildHtmlReport(r: ScanRecord): string {
  const sev = (s: string) => `<span style="color:${SEV_COLOR[s] ?? "#999"};font-weight:700">${esc(s)}</span>`;
  const rows = r.findings
    .map(
      (f) => `
<tr>
  <td class="mono">${esc(f.id)}</td>
  <td>${sev(f.severity)}</td>
  <td>${esc(f.category)}</td>
  <td><b>${esc(f.title)}</b><br/><span class="dim mono">${esc(f.evidence)}</span>${
        f.recommendation ? `<br/><span class="rec">→ ${esc(f.recommendation)}</span>` : ""
      }</td>
</tr>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>0xOZrx!! report ${esc(r.id)}</title>
<style>
 body{background:#05080a;color:#c9d4d1;font:13px/1.55 "Cascadia Mono",Consolas,monospace;margin:0;padding:32px}
 h1{color:#00ff9c;letter-spacing:.06em} h2{border-bottom:1px solid #1c2b26;padding-bottom:4px}
 table{border-collapse:collapse;width:100%} td,th{border:1px solid #17241f;padding:8px;text-align:left;vertical-align:top}
 th{color:#7d8a87;font-size:11px;letter-spacing:.1em}
 .mono{font-family:inherit}.dim{color:#7d8a87;font-size:12px}
 .rec{color:#9fe8c9;font-size:12px}
 .score{font-size:42px;font-weight:800;color:${r.score.total >= 80 ? "#00ff9c" : r.score.total >= 55 ? "#ffd24a" : "#ff5566"}}
 .grid{display:flex;gap:18px;flex-wrap:wrap}.card{border:1px solid #17241f;padding:12px 16px}
 footer{margin-top:28px;color:#7d8a87;font-size:11px}
</style></head><body>
<h1>0xOZrx!! SECURITY REPORT ${r.mock ? "(MOCK DATA)" : ""}</h1>
<p class="dim">scan ${esc(r.id)} · kind=${esc(r.kind)} · host=${esc(r.host)} · ${esc(r.os)}<br/>
generated ${new Date().toISOString()} · duration ${(r.durationMs / 1000).toFixed(1)}s</p>
<div class="grid">
 <div class="card"><div class="dim">SECURITY SCORE</div><div class="score">${r.score.total}/100</div>
 <div class="dim">CRIT ${r.score.counts.CRITICAL} · HIGH ${r.score.counts.HIGH} · MED ${r.score.counts.MEDIUM} · LOW ${r.score.counts.LOW}</div></div>
 <div class="card"><div class="dim">FINDINGS</div><div class="score">${r.findings.length}</div></div>
 <div class="card"><div class="dim">NETWORK EXPOSURE</div><div style="font-size:26px;font-weight:700">${esc(r.exposure ?? "--")}</div></div>
</div>
<h2>Score breakdown</h2><table><tr><th>Category</th><th>Lost</th><th>Max</th></tr>
${r.score.breakdown.map((b) => `<tr><td>${esc(b.category)}</td><td>${b.lost}</td><td>${b.max}</td></tr>`).join("")}
</table>
<h2>Findings</h2>
${rows ? `<table><tr><th>ID</th><th>Severity</th><th>Category</th><th>Detail</th></tr>${rows}</table>` : "<p>No detected issues within the scope of this scan. This does not mean the system is 'secure' - scanners are imperfect.</p>"}
<footer>0xOZrx!! local-first security workstation · evidence text auto-redacted for export · no cloud involved in generation</footer>
</body></html>`;
}

export async function exportReport(eng: { tag: (ch: "INFO" | "PASS" | "WARN" | "ERROR" | "DIM", m: string) => void }, r: ScanRecord, format: "html" | "json" | "md"): Promise<void> {
  const ts = new Date(r.startedAt).toISOString().replace(/[:T]/g, "-").slice(0, 19);
  try {
    let content: string;
    if (format === "html") content = buildHtmlReport(r);
    else if (format === "md") content = buildMdReport(r);
    else content = JSON.stringify(redactDeep(r), null, 2);

    const path = await writeReport(`ozrx-${r.kind}-${ts}.${format}`, content);
    const hash = await sha256Hex(content);
    eng.tag("PASS", `report written: ${path}`);
    eng.tag("DIM", `sha256: ${hash}`);
    await openReportsDir();
  } catch (e) {
    eng.tag("ERROR", `report export failed: ${String(e).slice(0, 140)}`);
  }
}

function buildMdReport(r: ScanRecord): string {
  const lines: string[] = [
    `# 0xOZrx!! report ${r.id}${r.mock ? " (MOCK DATA)" : ""}`,
    "",
    `- kind: ${r.kind}`,
    `- host: ${r.host} (${r.os})`,
    `- score: **${r.score.total}/100**`,
    `- exposure: ${r.exposure ?? "--"}`,
    "",
    "| ID | Sev | Category | Finding |",
    "|---|---|---|---|",
  ];
  for (const f of r.findings)
    lines.push(`| ${f.id} | ${f.severity} | ${f.category} | ${f.title.replace(/\|/g, "\\|")} |`);
  return lines.join("\n") + "\n";
}
