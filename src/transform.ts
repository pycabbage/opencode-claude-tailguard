import type { Message, Part, TextPart, UserMessage } from "@opencode-ai/sdk"
import { logger } from "./logger"

export type MessageEntry = { info: Message; parts: Part[] }

// Matches Claude 4.6 variants where prefill is not supported
// Handles separators: -, ., _ between major.minor version
const TARGET_PATTERN = /claude-(opus|sonnet)-4[._-]6/

export function isTargetModel(modelID: string): boolean {
  return TARGET_PATTERN.test(modelID)
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
  const id = crypto.randomUUID()
  const info: UserMessage = {
    role: "user",
    id,
    sessionID,
    time: { created: Date.now() },
    agent,
    model,
  }
  const part: TextPart = {
    id: crypto.randomUUID(),
    sessionID,
    messageID: id,
    type: "text",
    text: "Continue.",
  }
  return { info, parts: [part] }
}

// Transforms the message array in-place to ensure it ends with a user message
// when targeting Claude 4.6 models.
//
// Algorithm:
// 1. No-op if last message is not assistant
// 2. No-op if latest user message is not a target model
// 3. Pop consecutive empty assistant messages from tail
// 4. If tail is still assistant (has content), append synthetic "Continue." user message
export function transformMessages(messages: MessageEntry[]): void {
  logger.log("transform called:", messages.length, "messages")

  const last = messages[messages.length - 1]
  if (!last || last.info.role !== "assistant") {
    logger.log("skip: last message is not assistant")
    return
  }

  const latestUser = findLatestUserMessage(messages)
  if (!latestUser) {
    logger.log("skip: no user message found")
    return
  }
  if (!isTargetModel(latestUser.info.model.modelID)) {
    logger.log("skip: non-target model:", latestUser.info.model.modelID)
    return
  }

  logger.log("target model:", latestUser.info.model.modelID)

  let removed = 0
  while (messages.length > 0) {
    const tail = messages[messages.length - 1]
    if (!tail || !isEmptyAssistantMessage(tail)) break
    messages.pop()
    removed++
  }

  if (removed > 0) {
    logger.log("removed", removed, "empty assistant message(s)")
  }

  const newLast = messages[messages.length - 1]
  if (newLast && newLast.info.role === "assistant") {
    logger.log("appending synthetic 'Continue.' user message")
    messages.push(
      createSyntheticUserMessage(
        newLast.info.sessionID,
        latestUser.info.agent,
        latestUser.info.model
      )
    )
  } else if (removed > 0) {
    logger.log("no synthetic message needed: empty assistant(s) removed")
  }

  logger.log("transform complete:", messages.length, "messages")
}
