# Ollama + Gemma setup (optional)

The AI assistant is optional; 0xOZrx!! works fully offline without it.
Verified working configuration on this machine: **Ollama + `gemma4:e4b`**.

## Install

1. Download Ollama for Windows: <https://ollama.com/download>
2. Start Ollama (listens on `http://127.0.0.1:11434`).
3. Pull a Gemma model:

```powershell
ollama pull gemma4:e4b    # 8B MoE, ~8.9 GB - what this workstation prefers
# or
ollama pull gemma3:4b     # smaller alternative
```

4. Launch 0xOZrx!! — boot auto-detects the endpoint and picks the model.
   Preference order: exact `gemma4:e4b` > `gemma3n:e4b` > `gemma3:4b` >
   anything matching `gemma4`/`e4b`/`gemma` > first installed.

```
[AI] ollama connected - model gemma4:e4b (local only)
```

5. Verify anytime: run `model` in the sentinel shell, or check the
   dashboard card / top-bar chip.

## Model control (`model`)

```
model                    endpoint, active tag, reasoning state, installed list
model info [tag]         family, params, quantisation, context window, capabilities
model warm               preload into VRAM now (kills the cold start)
model use gemma4:e4b     pin a tag - persists across restarts
model auto               back to auto-detection
model think on|off       gemma4:e4b reasoning trace before each answer
```

Requests are sent with `keep_alive=30m`, so the ~9 GB model stays resident
between questions instead of reloading. Sampling defaults are
`temperature 0.4 / top_p 0.9 / num_ctx 8192` — deliberately low-variance,
because security analysis should not free-associate. The backend allowlists
sampling keys and accepts numeric values only.

## Using the assistant

```
ai explain latest scan        # structured findings -> prioritized remediation
ai explain process <pid>      # after inspect <pid>
ai why is RDP a finding       # general security Q&A, offline
ai                            # enter ai> REPL mode (/exit or Ctrl+C to leave)
```

Context sent to the model is limited to the relevant structured findings
(redacted) - never your filesystem or documents.

## Cold start note

The first AI call after Ollama starts loads the model into VRAM (gemma4:e4b
is ~9 GB) and can take minutes. Subsequent calls answer in seconds. Run
`model warm` to pay that cost up front, or use the "preload into VRAM" button
in Settings → LOCAL AI. When a reply did include a cold load, the app prints
`Ns cold load` in the response footer rather than hiding it.

## Reasoning mode

`gemma4:e4b` advertises the `thinking` capability. `model think on` sends
`think: true` and prints the trace in a dimmed block above the answer. It is
off by default: it is slower, and the answer itself is what gets acted on.
The flag is only sent when you opt in, so older Ollama builds that reject the
key keep working.

## Privacy notes

- Requests go ONLY to `http://127.0.0.1:11434` (default endpoint).
- Redaction runs before any text reaches the model.
- No cloud AI, no telemetry, ever.
