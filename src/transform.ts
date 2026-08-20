import type { Message, Part, TextPart, UserMessage } from "@opencode-ai/sdk"
import { randomUUID } from "crypto"
import { logger } from "./logger"

export type MessageEntry = { info: Message; parts: Part[] }

export type Mode = "surgical" | "removal" | "transform"

export function getMode(): Mode {
  const value = process.env.OPENCODE_CLAUDE_TAILGUARD_MODE
  if (value === "removal" || value === "transform" || value === "surgical") {
    return value
  }
  return "surgical"
}

// Claude >= 4.6 dropped assistant message prefill: any request whose
// conversation ends with an assistant turn is rejected with 400.
// Provider-independent: matching is purely on the model ID string, so it works
// across Anthropic first-party ("claude-opus-4-6-20260101"), Amazon Bedrock
// ("global.anthropic.claude-sonnet-5"), OpenRouter ("anthropic/claude-opus-4.6"),
// OpenCode gateways and any other router — the provider ID is never consulted.
// Version digits are bounded (max two, never followed by another digit) so
// dated aliases parse correctly: "claude-sonnet-4-20250514" is Claude 4.0
// (prefill still supported), not 4.20250514.
export function isTargetModel(modelID: string): boolean {
  const match = /claude\D*?(\d{1,2})(?!\d)(?:[._-](\d{1,2})(?!\d))?/i.exec(
    modelID
  )
  if (!match) return false
  const major = Number.parseInt(match[1] ?? "", 10)
  const minor =
    match[2] !== undefined ? Number.parseInt(match[2], 10) : undefined
  if (!Number.isFinite(major)) return false
  if (major >= 5) return true
  return major === 4 && minor !== undefined && minor >= 6
}

// Returns true if a part carries meaningful content
// Structure-only parts (step-start, step-finish, etc.) return false
export function hasContent(part: Part): boolean {
  switch (part.type) {
    case "text":
      return part.text.length > 0
    case "reasoning":
      return (
        part.text.length > 0 ||
        (part.metadata !== undefined && Object.keys(part.metadata).length > 0)
      )
    case "tool":
    case "file":
      return true
    case "agent":
      return part.source !== undefined
    default:
      return false
  }
}

// The bug this plugin fixes, verified against 17/17 production failures:
//
// OpenCode's AI SDK adapter can persist a single assistant turn as
//   [tool, step-start, text, step-finish]
// The embedded step-start makes convertToModelMessages() split the turn into
//   assistant(tool_use) -> tool(result) -> assistant(text)
// leaving the request ending with an assistant turn.
//
// The fix: within the LAST message the API will actually see, drop the parts
// from the trailing step-start onward when that final block has content but no
// tool call. The request then ends with tool(result) — the exact shape the
// model asked for via stop_reason=tool_use — and the model re-concludes on its
// next turn. No context is removed (only the trailing narration text that
// never reached the API in a valid form anyway) and no synthetic "Continue."
// message is injected, so a finished agent is never prodded into a runaway.
//
// Valid shapes are left untouched, e.g.
//   [step-start, reasoning, tool, step-finish, text]  (single block: no split)
//   [step-start, text, tool, step-finish]             (text precedes tool)
export function findSurgicalCut(parts: Part[]): number | undefined {
  let lastStepStart = -1
  let lastTool = -1
  for (let i = 0; i < parts.length; i++) {
    const type = parts[i]?.type
    if (type === "step-start") lastStepStart = i
    else if (type === "tool") lastTool = i
  }
  if (lastTool < 0) return undefined // no tool call: not the bug shape
  if (lastStepStart < 0) return undefined // single block: cannot split
  if (lastStepStart < lastTool) return undefined // final block contains the tool: valid
  const tail = parts.slice(lastStepStart + 1)
  if (tail.some((part) => part.type === "tool")) return undefined
  if (!tail.some((part) => hasContent(part))) return undefined
  return lastStepStart
}

function isAssistantMessage(entry: MessageEntry): boolean {
  return entry.info.role === "assistant"
}

function isEmptyAssistantMessage(entry: MessageEntry): boolean {
  return entry.info.role === "assistant" && !entry.parts.some(hasContent)
}

// OpenCode's toModelMessagesEffect() drops assistant messages that errored or
// carry no content parts, so they never reach the API and never need fixing.
// The last message the API will actually see is the last assistant entry that
// is content-bearing and error-free.
function isDroppedByOpenCode(entry: MessageEntry): boolean {
  const info = entry.info as { role: string; error?: unknown }
  if (info.role !== "assistant") return true
  return isEmptyAssistantMessage(entry) || info.error !== undefined
}

function findLatestUserMessage(
  messages: MessageEntry[]
): { info: UserMessage; parts: Part[] } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg !== undefined && msg.info.role === "user") {
      return msg as { info: UserMessage; parts: Part[] }
    }
  }
  return undefined
}

function createSyntheticUserMessage(
  sessionID: string,
  agent: string,
  model: { providerID: string; modelID: string }
): MessageEntry {
  const id = randomUUID()
  const info: UserMessage = {
    role: "user",
    id,
    sessionID,
    time: { created: Date.now() },
    agent,
    model,
  }
  const part: TextPart = {
    id: randomUUID(),
    sessionID,
    messageID: id,
    type: "text",
    text: "Continue.",
  }
  return { info, parts: [part] }
}

// IMPORTANT: mutates `messages` (and the entries inside it) IN PLACE and
// returns the same array reference.
//
// OpenCode >= ~1.3 fires "experimental.chat.messages.transform" as
//   yield* plugin.trigger(..., { messages: msgs })
// and then keeps using its own `msgs` reference, discarding the trigger's
// return value. A plugin that rebinds `output.messages = [...]` is silently
// ignored; only in-place mutations reach the LLM request.
//
// surgical mode (default):
//   Truncate the parts of the last API-visible assistant message at the
//   trailing step-start (see findSurgicalCut). Removes nothing else, injects
//   nothing.
//
// removal mode (legacy):
//   Remove ALL trailing assistant messages in place. WARNING: in agent loops
//   the whole session after the last user message is a run of assistant
//   messages, so this can strip nearly the entire conversation.
//
// transform mode (legacy):
//   Remove trailing empty/errored assistants in place; if the remaining tail
//   is a content-bearing assistant with finish === "tool-calls" (a mid-loop
//   turn), append a synthetic "Continue." user message. A tail whose finish
//   is a real end turn ("stop" etc.) is dropped instead — appending
//   "Continue." there is what caused infinite runaways.
export function transformMessages(
  messages: MessageEntry[],
  mode: Mode = getMode()
): MessageEntry[] {
  logger.log(
    "transform called:",
    messages.length,
    "messages",
    `(mode: ${mode})`
  )

  const last = messages[messages.length - 1]
  if (last?.info.role !== "assistant") {
    logger.log("skip: last message is not assistant")
    return messages
  }

  const latestUser = findLatestUserMessage(messages)
  if (!latestUser) {
    logger.log("skip: no user message found")
    return messages
  }
  if (!isTargetModel(latestUser.info.model.modelID)) {
    logger.log("skip: non-target model:", latestUser.info.model.modelID)
    return messages
  }

  logger.log("target model:", latestUser.info.model.modelID)

  if (mode === "surgical") {
    for (let i = messages.length - 1; i >= 0; i--) {
      const entry = messages[i]
      if (!entry || !isAssistantMessage(entry)) break
      if (isDroppedByOpenCode(entry)) continue
      const cut = findSurgicalCut(entry.parts)
      if (cut !== undefined) {
        const removed = entry.parts.length - cut
        entry.parts.length = cut
        logger.log(
          `surgical: truncated ${removed} trailing part(s) of ${entry.info.id}`
        )
      } else {
        logger.log("surgical: no cut point, message left unchanged")
      }
      break
    }
    logger.log("transform complete:", messages.length, "messages")
    return messages
  }

  if (mode === "removal") {
    let removed = 0
    while (messages.length > 0) {
      const tail = messages[messages.length - 1]
      if (!tail || !isAssistantMessage(tail)) break
      messages.splice(-1, 1)
      removed++
    }
    if (removed > 0) {
      logger.log("removed", removed, "assistant message(s)")
    }
    logger.log("transform complete:", messages.length, "messages")
    return messages
  }

  // transform (legacy)
  let removed = 0
  while (messages.length > 0) {
    const tail = messages[messages.length - 1]
    if (!tail || !isDroppedByOpenCode(tail) || !isAssistantMessage(tail)) break
    messages.splice(-1, 1)
    removed++
  }
  if (removed > 0) {
    logger.log("removed", removed, "empty assistant message(s)")
  }

  const newLast = messages[messages.length - 1]
  if (newLast && isAssistantMessage(newLast)) {
    const finish = (newLast.info as { finish?: string }).finish
    if (finish === "tool-calls") {
      logger.log("appending synthetic 'Continue.' user message")
      messages.push(
        createSyntheticUserMessage(
          newLast.info.sessionID,
          latestUser.info.agent,
          latestUser.info.model
        )
      )
    } else {
      logger.log(
        `transform: tail assistant finish=${finish ?? "unknown"} (end turn) — dropping tail entry instead of 'Continue.'`
      )
      messages.splice(-1, 1)
    }
  } else if (removed > 0) {
    logger.log("no synthetic message needed: empty assistant(s) removed")
  }

  logger.log("transform complete:", messages.length, "messages")
  return messages
}
