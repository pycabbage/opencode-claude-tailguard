# opencode-claude-tailguard

An [OpenCode](https://opencode.ai) plugin that prevents `This model does not support assistant message prefill.` errors caused by the deprecated assistant message prefill in Claude >= 4.6 — any variant (Opus, Sonnet, Haiku, Fable, ...), including Bedrock IDs such as `global.anthropic.claude-sonnet-5` and `global.anthropic.claude-fable-5`.

Due to a bug in OpenCode, the conversation array can end with an assistant message, which the Claude 4.6+ API rejects. This plugin fixes the message array in place before it is sent to the API.

## Setup

`~/.config/opencode/opencode.json`:

```json
{
  "plugins": [
    "opencode-claude-tailguard",
  ]
}
```

## How it works

When an assistant turn is persisted as `[tool, step-start, text, ...]`, the
embedded `step-start` makes the AI SDK split it into
`assistant(tool_use) -> tool(result) -> assistant(text)`, leaving the request
ending with an assistant turn. The plugin truncates that trailing
`step-start + text` block so the request ends with `tool(result)` — exactly
what the model asked for via `stop_reason: tool_use`. No context is removed
beyond the trailing narration text, and no synthetic message is injected, so a
finished agent is never prodded into a runaway loop.

Mutations are applied **in place**: OpenCode (~1.3+) discards the hook's return
value and keeps using its own messages reference, so rebinding
`output.messages` would be silently ignored.

## Configuration

Set the `OPENCODE_CLAUDE_TAILGUARD_MODE` environment variable to control behavior:

| Value | Behavior |
|---|---|
| `surgical` (default) | Truncate the trailing `step-start + text` block of the last API-visible assistant message (see above). No entries removed, nothing injected |
| `removal` (legacy) | Remove **all** trailing assistant messages. WARNING: in agent loops the whole session tail after the last user message is a run of assistant messages, so this can strip nearly the entire conversation |
| `transform` (legacy) | Remove trailing empty/errored assistants; append synthetic `"Continue."` only when the tail is a mid-loop turn (`finish === "tool-calls"`). A genuine end turn (`finish === "stop"`) is dropped instead — appending `"Continue."` there caused infinite runaways |

Set via shell or `.env` file in your project directory:

```sh
OPENCODE_CLAUDE_TAILGUARD_MODE=transform opencode
```

## Notes

- Provider-independent: the check looks only at the model ID string, so it
  works across Anthropic first-party (`claude-opus-4-6-20260101`), Amazon
  Bedrock (`global.anthropic.claude-sonnet-5`), OpenRouter
  (`anthropic/claude-opus-4.6`), OpenCode gateways (go/zen) and other routers.
  Any ID containing "claude" plus a version >= 4.6 matches, regardless of
  variant name (Opus, Sonnet, Haiku, Fable, ...). Dated aliases parse
  correctly: `claude-sonnet-4-20250514` (Claude 4.0, prefill still supported)
  is not matched, `claude-opus-4-6-20260101` (4.6) is. Claude <= 4.5 and
  non-Claude models still support (or tolerate) trailing assistant turns and
  are not affected. Aliases whose ID does not contain "claude" cannot be
  matched.
- Errored or empty trailing assistant messages are skipped by OpenCode's own
  message conversion and never reach the API; the plugin walks past them to the
  last message the API will actually see. This also makes a stuck session
  recoverable: a plain retry after the 400 error now produces a valid request.
