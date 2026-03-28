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

## Notes

The transformation is applied only when a Claude 4.6 model is in use. Other models are not affected.
