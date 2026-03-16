# Plan: Prompt Caching + Lexical Grid Encoding

**Date**: 2026-03-15
**Scope**: Linear and Linear w/ Interrupt scaffolding types

---

## Problem

1. **No prompt caching** — every Anthropic LLM call sends the full system prompt (ARC description, color palette, agent priors, task instructions) as new tokens. This is wasteful since the static prefix is identical across all calls in a session.

2. **RLE grid encoding is spatially lossy** — current `compressRowJS` encodes grids as `0x10 5 5 0x3` which collapses spatial information. LLMs reason better about 2D spatial layouts when they can "see" the grid as a character map.

## Scope

**In scope:**
- Prompt caching via `cache_control` for Anthropic provider (Linear + Linear w/ Interrupt)
- Lexical grid encoding using [LexicalColorPalette16](https://github.com/sweiss93/LexicalColorPalette16)-inspired single-character mapping
- Updated grid legend in prompts

**Out of scope:**
- Caching for other providers (Gemini cached_content, OpenAI, etc. — future work)
- Caching for RLM, Three-System, Agent Spawn, World Model scaffoldings (they have their own prompt builders)
- Image input implementation (separate feature)

## Architecture

### 1. Prompt Caching (Anthropic)

**Current flow:**
```
buildClientPrompt() → single string prompt
askLLM() → callLLM([{role: 'user', content: prompt}], model)
_callLLMInner(Anthropic) → body.messages = [{role: 'user', content: prompt}]
```

**New flow:**
```
buildClientPrompt() → returns { system: staticString, user: dynamicString }
askLLM() → callLLM([{role: 'system', content: system}, {role: 'user', content: user}], model)
_callLLMInner(Anthropic) → body.system = [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}]
                           body.messages = [{role: 'user', content: user}]
```

**Static (cached) content**: ARC description + color palette + agent priors + task format instructions
**Dynamic (per-call) content**: Game state + compact context + history + changes + grid

**Cost savings**: Anthropic charges 10% for cached input tokens vs 100% for new. The system prompt is ~500-800 tokens, so with 50+ calls per session this saves meaningfully. More importantly, cached prefixes are faster.

**Files touched:**
- `static/js/scaffolding-linear.js` — `buildClientPrompt()` returns `{system, user}` object
- `static/js/llm.js` — `askLLM()` Linear path passes system+user messages
- `static/js/scaffolding.js` — `_callLLMInner()` Anthropic branch uses structured system with `cache_control`

**Backward compatibility:** Non-Anthropic providers already handle system messages (Gemini extracts them, OpenAI passes them through). Puter.js flattens to text. No provider breaks.

### 2. Lexical Grid Encoding

**Mapping (ARC3 → single character, inspired by LexicalColorPalette16):**

| ARC3 Index | Color | Char | Mnemonic |
|-----------|-------|------|----------|
| 0 | White | `.` | Background dot |
| 1 | LightGray | `1` | Gray level 1 |
| 2 | Gray | `2` | Gray level 2 |
| 3 | DarkGray | `3` | Gray level 3 |
| 4 | VeryDarkGray | `4` | Gray level 4 |
| 5 | Black | `K` | blacK |
| 6 | Magenta | `M` | Magenta |
| 7 | LightMagenta | `m` | light magenta |
| 8 | Red | `R` | Red |
| 9 | Blue | `B` | Blue |
| 10 | LightBlue | `b` | light blue |
| 11 | Yellow | `Y` | Yellow |
| 12 | Orange | `O` | Orange |
| 13 | Maroon | `r` | dark red (maroon) |
| 14 | Green | `G` | Green |
| 15 | Purple | `P` | Purple |

**Example output (64×64 grid):**
```
## GRID (64×64 lexical — see color legend in system prompt)
................................................................
................................................................
..............KKKKKKKKKKKKKK....................................
..............K............K....................................
..............K....R.......K....................................
..............K............K....................................
..............KKKKKKKKKKKKKK....................................
```

vs current RLE:
```
## GRID (RLE, colors 0-15)
Row 0: 0x64
Row 1: 0x64
Row 2: 0x14 5x14 0x36
...
```

The lexical format preserves spatial relationships perfectly — the LLM can "see" walls, corridors, objects as shapes in the text.

**Token impact**: A 64×64 grid = 4,096 characters + 63 newlines ≈ 1,040 tokens. Current RLE for a sparse grid might be 300-600 tokens. For a dense grid, RLE can be 800+ tokens. The lexical format is a fixed ~1,040 tokens regardless of grid complexity — more predictable and not much larger.

**Files touched:**
- `static/js/scaffolding.js` — add `gridToLexical(grid)` function + `ARC3_LEXICAL_MAP` constant
- `static/js/scaffolding-linear.js` — use lexical encoding instead of RLE, include legend in system prompt
- `prompts/shared/color_palette.txt` — add lexical legend

## TODOs

### Phase 1: Lexical Grid Encoding
- [ ] Add `ARC3_LEXICAL_MAP` array and `gridToLexical(grid)` in `scaffolding.js`
- [ ] Update `buildClientPrompt()` in `scaffolding-linear.js` to use lexical grid
- [ ] Update color palette prompt to include the character legend
- [ ] Verify: start a session with LS20, check that the prompt contains the lexical grid

### Phase 2: Prompt Caching
- [ ] Modify `buildClientPrompt()` to return `{system, user}` instead of a single string
- [ ] Update `askLLM()` in `llm.js` to pass separate system/user messages for Linear path
- [ ] Update `_callLLMInner()` Anthropic branch to use structured system with `cache_control: {type: 'ephemeral'}`
- [ ] Ensure parse-retry path in `askLLM()` also uses system/user split
- [ ] Verify: make an Anthropic call, check response headers for `anthropic-cache-read-input-tokens` > 0 on second call
- [ ] Verify: non-Anthropic providers (Gemini, Groq, etc.) still work correctly

### Phase 3: Headers & Changelog
- [ ] Update file headers for all touched files
- [ ] Add CHANGELOG.md entry

## Docs / Changelog Touchpoints
- `CHANGELOG.md` — new entry for prompt caching + lexical grid
- File headers on: `scaffolding.js`, `scaffolding-linear.js`, `llm.js`
