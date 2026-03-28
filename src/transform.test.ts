import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk"
import type { MessageEntry } from "./transform"
import {
  getMode,
  hasContent,
  isTargetModel,
  transformMessages,
} from "./transform"

const SESSION_ID = "test-session"
const AGENT = "test-agent"

let _idCounter = 0
function nextId(): string {
  return `id-${++_idCounter}`
}

function makeUserEntry(modelID = "claude-opus-4-6"): MessageEntry {
  return {
    info: {
      role: "user",
      id: nextId(),
      sessionID: SESSION_ID,
      time: { created: Date.now() },
      agent: AGENT,
      model: { providerID: "anthropic", modelID },
    } as unknown as Message,
    parts: [],
  }
}

function makeAssistantEntry(parts: Part[]): MessageEntry {
  return {
    info: {
      role: "assistant",
      id: nextId(),
      sessionID: SESSION_ID,
      parentID: nextId(),
      modelID: "claude-opus-4-6",
      providerID: "anthropic",
      mode: "chat",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: { created: Date.now() },
    } as unknown as Message,
    parts,
  }
}

function makeTextPart(text: string): Part {
  return {
    id: nextId(),
    sessionID: SESSION_ID,
    messageID: nextId(),
    type: "text",
    text,
  } as unknown as Part
}

function makeReasoningPart(
  text: string,
  metadata?: Record<string, unknown>
): Part {
  return {
    id: nextId(),
    sessionID: SESSION_ID,
    messageID: nextId(),
    type: "reasoning",
    text,
    metadata,
    time: { start: Date.now() },
  } as unknown as Part
}

function makeToolPart(): Part {
  return {
    id: nextId(),
    sessionID: SESSION_ID,
    messageID: nextId(),
    type: "tool",
    callID: nextId(),
    tool: "bash",
    state: {
      status: "completed",
      input: {},
      output: "ok",
      title: "bash",
      metadata: {},
      time: { start: 0, end: 1 },
    },
  } as unknown as Part
}

function makeStepStartPart(): Part {
  return {
    id: nextId(),
    sessionID: SESSION_ID,
    messageID: nextId(),
    type: "step-start",
  } as unknown as Part
}

function makeStepFinishPart(): Part {
  return {
    id: nextId(),
    sessionID: SESSION_ID,
    messageID: nextId(),
    type: "step-finish",
    reason: "end_turn",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as Part
}

// ─── getMode ────────────────────────────────────────────────────────────────

describe("getMode", () => {
  test("defaults to removal when env var is unset", () => {
    delete process.env.OPENCODE_CLAUDE_TAILGUARD_MODE
    expect(getMode()).toBe("removal")
  })
  test("returns transform when env var is 'transform'", () => {
    process.env.OPENCODE_CLAUDE_TAILGUARD_MODE = "transform"
    expect(getMode()).toBe("transform")
    delete process.env.OPENCODE_CLAUDE_TAILGUARD_MODE
  })
  test("returns removal for unknown value", () => {
    process.env.OPENCODE_CLAUDE_TAILGUARD_MODE = "invalid"
    expect(getMode()).toBe("removal")
    delete process.env.OPENCODE_CLAUDE_TAILGUARD_MODE
  })
})

// ─── isTargetModel ─────────────────────────────────────────────────────────

describe("isTargetModel", () => {
  test("matches claude-opus-4-6 (hyphen separator)", () => {
    expect(isTargetModel("claude-opus-4-6")).toBe(true)
  })
  test("matches claude-opus-4.6 (dot separator)", () => {
    expect(isTargetModel("claude-opus-4.6")).toBe(true)
  })
  test("matches claude-sonnet-4-6", () => {
    expect(isTargetModel("claude-sonnet-4-6")).toBe(true)
  })
  test("matches claude-haiku-4-5", () => {
    expect(isTargetModel("claude-haiku-4-5")).toBe(false)
  })
  test("matches claude-sonnet-4.5", () => {
    expect(isTargetModel("claude-sonnet-4.5")).toBe(false)
  })
  test("does not match claude-3-opus", () => {
    expect(isTargetModel("claude-3-opus")).toBe(false)
  })
  test("does not match gpt-4", () => {
    expect(isTargetModel("gpt-4")).toBe(false)
  })
  test("does not match claude-opus-4-4", () => {
    expect(isTargetModel("claude-opus-4-4")).toBe(false)
  })
})

// ─── hasContent ─────────────────────────────────────────────────────────────

describe("hasContent", () => {
  test("TextPart with content returns true", () => {
    expect(hasContent(makeTextPart("hello"))).toBe(true)
  })
  test("TextPart with empty string returns false", () => {
    expect(hasContent(makeTextPart(""))).toBe(false)
  })
  test("ReasoningPart with text returns true", () => {
    expect(hasContent(makeReasoningPart("thinking..."))).toBe(true)
  })
  test("ReasoningPart with empty text and no metadata returns false", () => {
    expect(hasContent(makeReasoningPart(""))).toBe(false)
  })
  test("ReasoningPart with empty text and signature in metadata returns true", () => {
    expect(hasContent(makeReasoningPart("", { signature: "abc123" }))).toBe(
      true
    )
  })
  test("ReasoningPart with empty text and empty metadata returns false", () => {
    expect(hasContent(makeReasoningPart("", {}))).toBe(false)
  })
  test("ToolPart always returns true", () => {
    expect(hasContent(makeToolPart())).toBe(true)
  })
  test("StepStartPart returns false", () => {
    expect(hasContent(makeStepStartPart())).toBe(false)
  })
  test("StepFinishPart returns false", () => {
    expect(hasContent(makeStepFinishPart())).toBe(false)
  })
})

// ─── transformMessages ──────────────────────────────────────────────────────

describe("transformMessages", () => {
  test("empty array: no-op", () => {
    const messages: MessageEntry[] = []
    transformMessages(messages)
    expect(messages).toHaveLength(0)
  })

  test("last message is user: no-op", () => {
    const messages = [makeUserEntry()]
    transformMessages(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })

  test("non-target model: no-op", () => {
    const messages = [
      makeUserEntry("gpt-4o"),
      makeAssistantEntry([makeTextPart("hello")]),
    ]
    transformMessages(messages)
    expect(messages).toHaveLength(2)
  })

  test("no user message at all: no-op", () => {
    const messages = [makeAssistantEntry([makeTextPart("hello")])]
    transformMessages(messages)
    expect(messages).toHaveLength(1)
  })

  // Pattern 1: [U, A(text+thinking)] → [U, A(text+thinking), U("Continue.")]
  test("pattern 1: content-bearing assistant → append Continue", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([
        makeTextPart("hello"),
        makeReasoningPart("thinking"),
      ]),
    ]
    transformMessages(messages, "transform")
    expect(messages).toHaveLength(3)
    expect(messages[2]?.info.role).toBe("user")
    expect(messages[2]?.parts[0]).toMatchObject({
      type: "text",
      text: "Continue.",
    })
  })

  // Pattern 2: [U, A(text+thinking), A(empty)] → [U, A(text+thinking), U("Continue.")]
  test("pattern 2: empty assistant after content-bearing → remove empty + append Continue", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([
        makeTextPart("hello"),
        makeReasoningPart("thinking"),
      ]),
      makeAssistantEntry([makeStepStartPart(), makeStepFinishPart()]),
    ]
    transformMessages(messages, "transform")
    expect(messages).toHaveLength(3)
    expect(messages[1]?.parts).toHaveLength(2)
    expect(messages[2]?.info.role).toBe("user")
    expect(messages[2]?.parts[0]).toMatchObject({
      type: "text",
      text: "Continue.",
    })
  })

  // Pattern 3: [U, A(empty)] → [U]
  test("pattern 3: single empty assistant → remove only", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeStepStartPart(), makeStepFinishPart()]),
    ]
    transformMessages(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })

  // Pattern 4: [U, A(empty), A(empty)] → [U]
  test("pattern 4: multiple empty assistants → remove all", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeStepStartPart()]),
      makeAssistantEntry([makeStepFinishPart()]),
    ]
    transformMessages(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })

  // Pattern 5: [U, A(reasoning with signature, text="")] → [U, A, U("Continue.")]
  test("pattern 5: signed reasoning with empty text → preserve assistant + append Continue", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeReasoningPart("", { signature: "abc123" })]),
    ]
    transformMessages(messages, "transform")
    expect(messages).toHaveLength(3)
    expect(messages[1]?.info.role).toBe("assistant")
    expect(messages[2]?.info.role).toBe("user")
    expect(messages[2]?.parts[0]).toMatchObject({
      type: "text",
      text: "Continue.",
    })
  })

  // Pattern 6: [U, A(tool+thinking)] → [U, A(tool+thinking), U("Continue.")]
  test("pattern 6: assistant with tool + reasoning → append Continue", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeToolPart(), makeReasoningPart("thinking")]),
    ]
    transformMessages(messages, "transform")
    expect(messages).toHaveLength(3)
    expect(messages[2]?.info.role).toBe("user")
    expect(messages[2]?.parts[0]).toMatchObject({
      type: "text",
      text: "Continue.",
    })
  })

  test("synthetic message sessionID matches last assistant", () => {
    const assistant = makeAssistantEntry([makeTextPart("hello")])
    const messages = [makeUserEntry(), assistant]
    const assistantSessionID = assistant.info.sessionID
    transformMessages(messages, "transform")
    expect(messages[2]?.info.sessionID).toBe(assistantSessionID)
  })

  test("synthetic message agent and model come from latest user message", () => {
    const user = makeUserEntry("claude-sonnet-4-6")
    const messages = [user, makeAssistantEntry([makeTextPart("hello")])]
    transformMessages(messages, "transform")
    const synthetic = messages[2]?.info as {
      agent: string
      model: { modelID: string }
    }
    expect(synthetic.agent).toBe(AGENT)
    expect(synthetic.model.modelID).toBe("claude-sonnet-4-6")
  })

  test("synthetic text part has messageID matching synthetic message id", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeTextPart("hello")]),
    ]
    transformMessages(messages, "transform")
    expect(messages).toHaveLength(3)
    const syntheticMsg = messages[2] as MessageEntry
    const syntheticPart = syntheticMsg.parts[0] as { messageID: string }
    expect(syntheticPart.messageID).toBe(syntheticMsg.info.id)
  })
})

// ─── transformMessages (removal mode) ───────────────────────────────────────

describe("transformMessages (removal mode - default)", () => {
  test("content-bearing assistant → removed", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeTextPart("hello")]),
    ]
    transformMessages(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })

  test("empty assistant → removed", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeStepStartPart(), makeStepFinishPart()]),
    ]
    transformMessages(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })

  test("content-bearing and empty assistants → all removed", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeTextPart("hello")]),
      makeAssistantEntry([makeStepStartPart()]),
    ]
    transformMessages(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })

  test("assistant with signed reasoning → removed", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeReasoningPart("", { signature: "abc123" })]),
    ]
    transformMessages(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })

  test("assistant with tool part → removed", () => {
    const messages = [makeUserEntry(), makeAssistantEntry([makeToolPart()])]
    transformMessages(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })
})
