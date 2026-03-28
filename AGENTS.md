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

Target models: `/claude-(opus|sonnet)-4[._-]6/` — Claude 4.6 Opus and Sonnet only.

**Mode (`OPENCODE_CLAUDE_TAILGUARD_MODE`):**

| Value | Behavior |
|---|---|
| `removal` (default) | Remove **all** trailing assistant messages regardless of content |
| `transform` | Remove empty trailing assistants; append synthetic `"Continue."` if content-bearing assistant remains |

**`transformMessages(messages, mode)` algorithm:**
1. No-op if last message is not `role === "assistant"`
2. No-op if latest user message is not a target model
3. `removal`: pop all trailing assistant messages (content-bearing or empty)
   `transform`: pop empty trailing assistants; if still ends with assistant, push synthetic user message

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
