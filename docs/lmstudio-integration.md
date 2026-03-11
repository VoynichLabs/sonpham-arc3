# LM Studio Integration — Developer Notes

Added in `feature/lmstudio-support`. This doc captures every gotcha hit during implementation so the next developer doesn't repeat them.

## Architecture

LM Studio support is **pure client-side** — both discovery and LLM calls run in the browser.

### Discovery flow
1. `loadModels()` in `scaffolding.js` fetches `/api/llm/models` from the server → returns cloud providers + Ollama + local servers (ports 8080/8000)
2. `loadModels()` then fetches `{baseUrl}/v1/models` **directly from the browser** (default `http://localhost:1234`, 1.5s timeout)
3. Returned models are annotated with capabilities from `LMSTUDIO_CAPABILITIES` (in `scaffolding.js`), embedding models are filtered out, and results are merged into `modelsData`
4. If LM Studio isn't running, the fetch fails silently — no error, no LM Studio group in dropdown

### LLM call flow
The browser calls `localhost:1234/v1/chat/completions` directly via `_callLLMInner()`. The Railway server is **never** in the LLM call path.

### Why client-side?
The server deploys on Railway where `localhost:1234` resolves to Railway's own host, not the user's machine. Only the browser can reach the user's local LM Studio. See `docs/2026-03-10-lmstudio-discovery-plan.md` for full rationale.

### Key constraints
- No server-side proxy needed (or possible — Railway can't reach user localhost)
- User must have LM Studio running locally (or via Cloudflare Tunnel)
- CORS works out of the box in LM Studio 0.3+ (no config required)
- `LMSTUDIO_CAPABILITIES` is intentionally duplicated in `scaffolding.js` (browser) and `models.py` (CLI agent) — update both when adding models

## Pitfalls (all real, all hit)

### 1. `reasoning_content` vs `content` — GLM models
GLM 4.7 Flash returns thinking tokens in `reasoning_content`. The `content` field comes back `null` or empty. Any code that reads `choices[0].message.content` gets nothing.

**Fix (scaffolding.js):**
```js
const text = data.choices?.[0]?.message?.content
           || data.choices?.[0]?.message?.reasoning_content
           || '';
```

### 2. Provider must be in `byokProviderOrder`
If `'lmstudio'` is not in the provider order array, all discovered LM Studio models are silently dropped on the floor — they exist in the registry but never appear in the UI dropdown.

**Fix (scaffolding.js):** Add `'Lmstudio'` to `providerOrder` (the available/free group, not `byokProviderOrder`) and add a display label in `providerLabels`.

### 3. Context window defaults to 3900 — silent truncation
LM Studio's default context window is 3900 tokens. llama_index (and similar wrappers) use this value to truncate prompts *before* sending them — no error is thrown, the model just receives a mangled half-prompt.

**Fix (scaffolding.js):** Hardcode `context_window: 8192` in the client-side discovery block inside `loadModels()`. Every model discovered from LM Studio gets this override applied before it enters `modelsData`.

### 4. `finish_reason: 'length'` is your only truncation signal
When the model hits the context limit on the API side, the response silently truncates. No error. The only indicator is `finish_reason === 'length'`.

**Fix (scaffolding.js):**
```js
if (data.choices?.[0]?.finish_reason === 'length') return { text, truncated: true };
```

### 5. Thinking mode is set at model load, not per-request
Unlike Anthropic's `budget_tokens` parameter, LM Studio thinking mode is a preset baked in when the model loads. You cannot toggle it per-request via the API.

**Impact:** All requests in a session use the same thinking config. Can't mix thinking/non-thinking calls.

### 6. Reasoning model detection — no API indicator
There's no standard API field to detect if a model supports reasoning. The `/v1/models` endpoint doesn't expose this.

**Fix:** Hardcode a known-good capability lookup in `LMSTUDIO_CAPABILITIES` — exists in **two** files:
- `scaffolding.js` (browser discovery path)
- `models.py` (CLI agent path)

Both must be kept in sync. Unknown models default to `{ reasoning: false, image: false }`.

Known reasoning-capable models (confirmed as of Mar 2026):
- `zai-org/glm-4.7-flash` — reasoning only
- `zai-org/glm-4.6v-flash` — reasoning + vision
- `qwen/qwen3.5-35b-a3b` — reasoning + vision (confirmed from LM Studio load logs)
- `qwen/qwen3.5-9b` — reasoning only

### 7. Vision/image capability — check load logs
`qwen3.5-35b-a3b` has a vision encoder (confirmed from LM Studio load logs) but the model ID doesn't make this obvious. Image capability is set in `LMSTUDIO_CAPABILITIES` (both `scaffolding.js` and `models.py`). When confirming a new vision model, add it to both files.

### 8. MLX Outlines + Pydantic enums = broken JSON schema
Pydantic enums (`Enum(str)`) generate `$defs/$ref` in their JSON schema. MLX Outlines can't handle `$ref` and returns empty content.

**Fix:** Use `Literal["a", "b", "c"]` instead of `Enum` for any field used in structured output.

## Configuration

Users configure LM Studio via the BYOK panel:
- **No API key required** — `lmstudio` is in `_BYOK_FREE_PROVIDERS`
- **Base URL field** — defaults to `http://localhost:1234`, overridable for Cloudflare Tunnel users

## Testing

LM Studio discovery is **client-side only** — you cannot test it via `curl` against the server. The server's `/api/llm/models` endpoint will never return LM Studio models.

### Browser verification
1. Start the server: `python server.py --mode staging --port-staging 5050`
2. Open `http://localhost:5050` in a browser
3. With LM Studio running (at least one model loaded), open the model dropdown — LM Studio models should appear under "LM Studio (free, local)"
4. With LM Studio stopped, reload — no LM Studio group should appear, no errors in console

### Console verification
Open browser DevTools console and run:
```js
fetch('http://localhost:1234/v1/models').then(r => r.json()).then(d => console.log(d.data.map(m => m.id)));
```
This confirms what the discovery code sees. Models with `embedding` in the ID are filtered out.

### Verification checklist
- [ ] LM Studio running → models appear in dropdown under "LM Studio (free, local)"
- [ ] LM Studio stopped → no LM Studio group, no console errors
- [ ] Custom base URL (Cloudflare Tunnel) → discovery uses that URL
- [ ] Known capability models show correct RSN/IMG tags
- [ ] `text-embedding-*` models are not shown

LM Studio must be running with at least one model loaded for discovery to work.

## Client↔Server Communication Analysis

The current architecture has an important nuance: **LM Studio models exist only in the browser's memory** after discovery. The server never knows about them. This means:

### What works today
- **Discovery**: browser → LM Studio `/v1/models` → merged into `modelsData` in JS
- **LLM calls**: browser → LM Studio `/v1/chat/completions` → response parsed in JS
- **Session save/resume**: the *model name* is persisted in session metadata, so resumed sessions know which model was used

### What the server does NOT know
- Which LM Studio models the user has loaded
- Whether a specific session used an LM Studio model (it only sees the model name string)
- LM Studio token usage or costs (all tracked client-side in `callLLM._lastUsage`)

### When this matters
- **Observatory/replay**: LLM call logs stored in `llm_calls` table include model name — replays can show "this step used qwen3.5-35b-a3b" but can't verify the model is still available
- **Batch runner / CLI agent**: uses `models.py` LMSTUDIO_CAPABILITIES, NOT the browser discovery path. CLI LM Studio support is a separate concern (out of scope for this feature)
- **Analytics**: if you ever need server-side LM Studio usage stats, the model name in `llm_calls` is the only signal

### Future considerations
If you need the server to know about LM Studio models (e.g. for admin dashboards, model usage analytics, or coordinating multiple users), the browser would need to POST discovered models back to a server endpoint. This is NOT implemented today and is not needed for the current single-user architecture.

## Next Developer Notes

### Adding a new LM Studio model to the capability list
1. Load the model in LM Studio and check its capabilities (reasoning: test with a thinking prompt; vision: check load logs for mmproj)
2. Add the entry to `LMSTUDIO_CAPABILITIES` in **both**:
   - `static/js/scaffolding.js` (browser path)
   - `models.py` (CLI agent path)
3. Update this doc's pitfall #6 known models list

### Changing the discovery timeout
The 1.5s timeout in `scaffolding.js` `loadModels()` (`AbortSignal.timeout(1500)`) balances UX speed vs. slow network/tunnel latency. If users report models not appearing, increase this — but it delays the entire model dropdown load.

### If LM Studio changes its API
LM Studio uses the OpenAI-compatible `/v1/models` and `/v1/chat/completions` endpoints. If these change, update:
- Discovery: `loadModels()` in `scaffolding.js`
- LLM calls: `_callLLMInner()` lmstudio branch in `scaffolding.js`
- CORS: LM Studio 0.3+ has CORS on by default. If a future version changes this, users will see a CORS error in console — the error message in `_callLLMInner` already directs them to check model load state.

### CLI agent LM Studio support
The CLI agent (`agent.py` / `batch_runner.py`) can use LM Studio models if running on the same machine, since `localhost:1234` resolves correctly in that context. This uses `models.py` LMSTUDIO_CAPABILITIES for capability metadata. This is a separate concern from web UI discovery and is not addressed in the `feature/lmstudio-support` branch.
