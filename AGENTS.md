# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode plugin that prevents `400 Bad Request` errors caused by deprecated assistant message prefill in Claude Opus 4.6 and Sonnet 4.6. OpenCode occasionally leaves trailing assistant messages in the conversation array; this plugin removes or neutralizes them before the API call.

## Commands

```bash
bun install           # install dependencies
bun run lint          # Biome lint/format check
bun test              # run tests
bun test --watch      # watch mode
bun run tsc --noEmit  # type check only
```

To run a single test file: `bun test src/transform.test.ts`

## Architecture

```
src/
  index.ts          # Plugin entry point — registers experimental.chat.messages.transform hook
  transform.ts      # All transformation logic (exported: transformMessages, hasContent, isTargetModel)
  logger.ts         # File + stdout logger → ~/.local/share/opencode/claude-tailguard-plugin.log
  transform.test.ts # Test suite (bun:test)
```

`index.ts` registers the hook and delegates entirely to `transformMessages()` in `transform.ts`.

### Transformation Logic (`transform.ts`)

Target models: any Claude model with version >= 4.6, regardless of variant name (Opus, Sonnet, Haiku, Fable, ...), naming scheme, or provider. `isTargetModel` is purely model-ID-based (the provider ID is never consulted) and parses only the major/minor version with bounded digits — e.g. `claude-opus-4.6`, `claude-sonnet-5`, `global.anthropic.claude-fable-5` (Bedrock), `claude-opus-4-6-20260101` (first-party dated), `anthropic/claude-opus-4.6` (OpenRouter) all match. Dated Claude-4.0 aliases (`claude-sonnet-4-20250514`) must NOT match — version digits are capped at two and may not be followed by another digit. `claude-haiku-4-5` and non-Claude models still allow prefill and are skipped.

**Mode (`OPENCODE_CLAUDE_TAILGUARD_MODE`):**

| Value | Behavior |
|---|---|
| `surgical` (default) | Truncate the trailing `step-start + text` block of the last API-visible assistant message (bug shape `[tool, ..., step-start, text]`) so the request ends with `tool(result)` |
| `removal` (legacy) | Remove **all** trailing assistant messages (in agent loops this can strip nearly the whole conversation) |
| `transform` (legacy) | Remove trailing empty/errored assistants; append synthetic `"Continue."` only when the tail has `finish === "tool-calls"`; genuine end turns (`finish === "stop"`) are dropped |

**`transformMessages(messages, mode)` algorithm:**

MUTATES the input array (and its entries) IN PLACE and returns the same
reference. OpenCode (~1.3+) fires `experimental.chat.messages.transform` and
keeps using its own `messages` reference, discarding the trigger's return
value — rebinding `output.messages` is silently ignored, so only in-place
mutations reach the LLM request. Never return a new array from this function.

1. No-op if last message is not `role === "assistant"`
2. No-op if latest user message is not a target model
3. Walk back past assistant entries OpenCode itself drops (`info.error` set, or no content parts); the first content-bearing, error-free assistant is the last message the API will see
4. `surgical`: cut its parts at the trailing `step-start` when the final block has content but no tool part (`findSurgicalCut`)
   `removal`: splice off all trailing assistant messages
   `transform`: splice off dropped-by-OpenCode tails, then append `"Continue."` (mid-loop) or drop the tail entry (end turn)

**Surgical cut rule (`findSurgicalCut`):** return the index of the last
`step-start` iff (a) the message contains a `tool` part, (b) that `step-start`
sits after the last `tool` part, and (c) the block following it carries content
(text/reasoning) but no `tool` part. Valid shapes — e.g. `[step-start,
reasoning, tool, step-finish, text]` (single block, no split) or
`[step-start, text, tool, step-finish]` — are left untouched.

**Part content classification (`hasContent`):**

| Part type | Content-retaining if |
|---|---|
| `text` | `text.length > 0` |
| `reasoning` | `text.length > 0` OR `metadata` has any key (signature) |
| `tool`, `file` | always |
| `agent` | `source` field present |
| `step-start`, `step-finish`, `snapshot`, `patch`, `retry`, `compaction`, others | never |

## TypeScript

- `noUncheckedIndexedAccess: true` — `arr[i]` returns `T | undefined`; guard all indexed reads
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `moduleResolution: "bundler"` — import paths without extensions are fine under Bun

## Bun Runtime

Use `bun` instead of `node`/`ts-node`. Do not use `bunx` to run executables under `node_modules/.bin`; use `bun run` or `./node_modules/.bin/<cmd>` instead. `bunx` downloads packages from the registry and should not be used for locally installed tools. Bun auto-loads `.env`.
