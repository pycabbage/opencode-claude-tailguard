import type { Message, Part, TextPart, UserMessage } from "@opencode-ai/sdk"
import { randomUUID } from "crypto"
import { logger } from "./logger"

export type MessageEntry = { info: Message; parts: Part[] }

export type Mode = "removal" | "transform"

export function getMode(): Mode {
  return process.env.OPENCODE_CLAUDE_TAILGUARD_MODE === "transform"
    ? "transform"
    : "removal"
}

export function isTargetModel(modelID: string): boolean {
  // Matches Claude 4.6 variants where prefill is not supported
  // Handles separators: -, ., _ between major.minor version
  return /claude-(opus|sonnet)-4[._-][67]/.test(modelID)
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

function isAssistantMessage(entry: MessageEntry): boolean {
  return entry.info.role === "assistant"
}

function isEmptyAssistantMessage(entry: MessageEntry): boolean {
  return entry.info.role === "assistant" && !entry.parts.some(hasContent)
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

// Returns a new MessageEntry[] array with trailing assistant messages removed or
// neutralized to ensure it ends with a user message when targeting Claude 4.6 models.
// The input array is never mutated.
//
// removal mode (default):
//   Remove ALL consecutive assistant messages from the tail.
//
// transform mode:
//   1. Remove consecutive empty assistant messages from tail
//   2. If tail is still assistant (has content), append synthetic "Continue." user message
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
  if (!last || last.info.role !== "assistant") {
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

  let result = messages

  if (mode === "removal") {
    let removed = 0
    while (result.length > 0) {
      const tail = result[result.length - 1]
      if (!tail || !isAssistantMessage(tail)) break
      result = result.slice(0, -1)
      removed++
    }
    if (removed > 0) {
      logger.log("removed", removed, "assistant message(s)")
    }
  } else {
    let removed = 0
    while (result.length > 0) {
      const tail = result[result.length - 1]
      if (!tail || !isEmptyAssistantMessage(tail)) break
      result = result.slice(0, -1)
      removed++
    }

    if (removed > 0) {
      logger.log("removed", removed, "empty assistant message(s)")
    }

    const newLast = result[result.length - 1]
    if (newLast && newLast.info.role === "assistant") {
      logger.log("appending synthetic 'Continue.' user message")
      result = [
        ...result,
        createSyntheticUserMessage(
          newLast.info.sessionID,
          latestUser.info.agent,
          latestUser.info.model
        ),
      ]
    } else if (removed > 0) {
      logger.log("no synthetic message needed: empty assistant(s) removed")
    }
  }

  logger.log("transform complete:", result.length, "messages")
  return result
}
