# opencode-claude-tailguard

An [OpenCode](https://opencode.ai) plugin that prevents `This model does not support assistant message prefill.` errors caused by the deprecated assistant message prefill in Claude Opus 4.6, Sonnet 4.6.

Due to a bug in OpenCode, the conversation array can end with an assistant message, which the Claude 4.6 API rejects. This plugin fixes the message array before it is sent to the API.

## Setup

`~/.config/opencode/opencode.json`:

```json
{
  "plugins": [
    "opencode-claude-tailguard",
  ]
}
```

## Configuration

Set the `OPENCODE_CLAUDE_TAILGUARD_MODE` environment variable to control behavior:

| Value | Behavior |
|---|---|
| `removal` (default) | Remove **all** trailing assistant messages regardless of content |
| `transform` | Remove empty trailing assistants; append synthetic `"Continue."` if a content-bearing assistant remains |

Set via shell or `.env` file in your project directory:

```sh
OPENCODE_CLAUDE_TAILGUARD_MODE=transform opencode
```

## Notes

The transformation is applied only when a Claude 4.6 model is in use. Other models are not affected.
