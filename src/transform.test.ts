import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk"
import type { MessageEntry } from "./transform"
import {
  findSurgicalCut,
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

function makeAssistantEntry(parts: Part[], finish?: string): MessageEntry {
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
      ...(finish !== undefined ? { finish } : {}),
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

function makeErrorAssistantEntry(): MessageEntry {
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
      error: {
        name: "APIError",
        data: {
          message: "This model does not support assistant message prefill.",
          statusCode: 400,
        },
      },
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: { created: Date.now() },
    } as unknown as Message,
    parts: [],
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
  test("defaults to surgical when env var is unset", () => {
    delete process.env.OPENCODE_CLAUDE_TAILGUARD_MODE
    expect(getMode()).toBe("surgical")
  })
  test("returns transform when env var is 'transform'", () => {
    process.env.OPENCODE_CLAUDE_TAILGUARD_MODE = "transform"
    expect(getMode()).toBe("transform")
    delete process.env.OPENCODE_CLAUDE_TAILGUARD_MODE
  })
  test("returns removal when env var is 'removal'", () => {
    process.env.OPENCODE_CLAUDE_TAILGUARD_MODE = "removal"
    expect(getMode()).toBe("removal")
    delete process.env.OPENCODE_CLAUDE_TAILGUARD_MODE
  })
  test("returns surgical for unknown value", () => {
    process.env.OPENCODE_CLAUDE_TAILGUARD_MODE = "invalid"
    expect(getMode()).toBe("surgical")
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
  test("matches claude-opus-4-7", () => {
    expect(isTargetModel("claude-opus-4-7")).toBe(true)
  })
  test("matches claude-sonnet-5 (bare major 5)", () => {
    expect(isTargetModel("claude-sonnet-5")).toBe(true)
  })
  test("matches Bedrock global.anthropic.claude-sonnet-5", () => {
    expect(isTargetModel("global.anthropic.claude-sonnet-5")).toBe(true)
  })
  test("matches Bedrock global.anthropic.claude-fable-5", () => {
    expect(isTargetModel("global.anthropic.claude-fable-5")).toBe(true)
  })
  test("matches claude-sonnet-5-20260101", () => {
    expect(isTargetModel("claude-sonnet-5-20260101")).toBe(true)
  })
  test("matches OpenRouter-style anthropic/claude-opus-4.6", () => {
    expect(isTargetModel("anthropic/claude-opus-4.6")).toBe(true)
  })
  test("matches OpenRouter-style anthropic/claude-sonnet-5", () => {
    expect(isTargetModel("anthropic/claude-sonnet-5")).toBe(true)
  })
  test("does not match OpenRouter-style anthropic/claude-sonnet-4.5", () => {
    expect(isTargetModel("anthropic/claude-sonnet-4.5")).toBe(false)
  })
  test("matches first-party dated alias claude-opus-4-6-20260101", () => {
    expect(isTargetModel("claude-opus-4-6-20260101")).toBe(true)
  })
  test("does not match first-party dated Claude 4.0 claude-sonnet-4-20250514", () => {
    expect(isTargetModel("claude-sonnet-4-20250514")).toBe(false)
  })
  test("does not match first-party dated Claude 4.0 claude-opus-4-20250514", () => {
    expect(isTargetModel("claude-opus-4-20250514")).toBe(false)
  })
  test("does not match first-party dated claude-sonnet-4-5-20250929", () => {
    expect(isTargetModel("claude-sonnet-4-5-20250929")).toBe(false)
  })
  test("does not match Vertex legacy claude-3-7-sonnet@001", () => {
    expect(isTargetModel("claude-3-7-sonnet@001")).toBe(false)
  })
  test("does not match unversioned-dated claude-sonnet-20260101", () => {
    expect(isTargetModel("claude-sonnet-20260101")).toBe(false)
  })
  test("does not match claude-haiku-4-5", () => {
    expect(isTargetModel("claude-haiku-4-5")).toBe(false)
  })
  test("does not match Bedrock claude-haiku-4-5-20251001-v1:0", () => {
    expect(
      isTargetModel("global.anthropic.claude-haiku-4-5-20251001-v1:0")
    ).toBe(false)
  })
  test("matches claude-sonnet-4.5", () => {
    expect(isTargetModel("claude-sonnet-4.5")).toBe(false)
  })
  test("does not match claude-3-opus", () => {
    expect(isTargetModel("claude-3-opus")).toBe(false)
  })
  test("does not match claude-3-7-sonnet", () => {
    expect(isTargetModel("claude-3-7-sonnet")).toBe(false)
  })
  test("does not match gpt-4", () => {
    expect(isTargetModel("gpt-4")).toBe(false)
  })
  test("does not match glm-5.3", () => {
    expect(isTargetModel("z-ai/glm-5.3")).toBe(false)
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
    expect(hasContent(makeReasoningPart("", {})).valueOf()).toBe(false)
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

// ─── findSurgicalCut ────────────────────────────────────────────────────────

describe("findSurgicalCut", () => {
  test("production bug shape [tool, step-start, text, step-finish] cuts at step-start", () => {
    const parts = [
      makeToolPart(),
      makeStepStartPart(),
      makeTextPart("narration"),
      makeStepFinishPart(),
    ]
    expect(findSurgicalCut(parts)).toBe(1)
  })
  test("production bug shape [tool, step-start, text] cuts at step-start", () => {
    const parts = [
      makeToolPart(),
      makeStepStartPart(),
      makeTextPart("narration"),
    ]
    expect(findSurgicalCut(parts)).toBe(1)
  })
  test("production bug shape [tool, step-finish, step-start, text] cuts at step-start", () => {
    const parts = [
      makeToolPart(),
      makeStepFinishPart(),
      makeStepStartPart(),
      makeTextPart("narration"),
    ]
    expect(findSurgicalCut(parts)).toBe(2)
  })
  test("valid outlier [step-start, reasoning, tool, step-finish, text] is not cut", () => {
    const parts = [
      makeStepStartPart(),
      makeReasoningPart("hmm"),
      makeToolPart(),
      makeStepFinishPart(),
      makeTextPart("answer"),
    ]
    expect(findSurgicalCut(parts)).toBeUndefined()
  })
  test("normal shape [step-start, text, tool, step-finish] is not cut", () => {
    const parts = [
      makeStepStartPart(),
      makeTextPart("let me check"),
      makeToolPart(),
      makeStepFinishPart(),
    ]
    expect(findSurgicalCut(parts)).toBeUndefined()
  })
  test("single block [step-start, reasoning, tool, text] is not cut", () => {
    const parts = [
      makeStepStartPart(),
      makeReasoningPart("hmm"),
      makeToolPart(),
      makeTextPart("answer"),
    ]
    expect(findSurgicalCut(parts)).toBeUndefined()
  })
  test("text-only message without tool is not cut", () => {
    const parts = [makeStepStartPart(), makeTextPart("final answer")]
    expect(findSurgicalCut(parts)).toBeUndefined()
  })
  test("trailing step-start without content after it is not cut", () => {
    const parts = [makeStepStartPart(), makeToolPart(), makeStepStartPart()]
    expect(findSurgicalCut(parts)).toBeUndefined()
  })
  test("trailing block with only step-finish (no content) is not cut", () => {
    const parts = [makeToolPart(), makeStepStartPart(), makeStepFinishPart()]
    expect(findSurgicalCut(parts)).toBeUndefined()
  })
})

// ─── transformMessages (in-place contract) ──────────────────────────────────

describe("transformMessages", () => {
  test("empty array: no-op, same reference", () => {
    const messages: MessageEntry[] = []
    const result = transformMessages(messages)
    expect(result).toBe(messages)
    expect(result).toHaveLength(0)
  })

  test("last message is user: no-op", () => {
    const messages = [makeUserEntry()]
    const result = transformMessages(messages)
    expect(result).toBe(messages)
    expect(result[0]?.info.role).toBe("user")
  })

  test("non-target model: no-op", () => {
    const messages = [
      makeUserEntry("gpt-4o"),
      makeAssistantEntry([makeTextPart("hello")]),
    ]
    const result = transformMessages(messages)
    expect(result).toBe(messages)
    expect(result).toHaveLength(2)
  })

  test("non-target model claude-sonnet-4-5: no-op", () => {
    const bug = makeAssistantEntry(
      [makeToolPart(), makeStepStartPart(), makeTextPart("narration")],
      "tool-calls"
    )
    const messages = [makeUserEntry("claude-sonnet-4-5"), bug]
    transformMessages(messages)
    expect(bug.parts).toHaveLength(3)
  })

  test("no user message at all: no-op", () => {
    const messages = [makeAssistantEntry([makeTextPart("hello")])]
    const result = transformMessages(messages)
    expect(result).toBe(messages)
  })
})

// ─── transformMessages (surgical mode - default) ────────────────────────────

describe("transformMessages (surgical mode - default)", () => {
  test("bug shape: trailing [step-start, text] block removed in place, tool kept", () => {
    const earlier = makeAssistantEntry(
      [
        makeStepStartPart(),
        makeTextPart("working"),
        makeToolPart(),
        makeStepFinishPart(),
      ],
      "tool-calls"
    )
    const bug = makeAssistantEntry(
      [
        makeToolPart(),
        makeStepStartPart(),
        makeTextPart("All files exist. Let me re-run."),
        makeStepFinishPart(),
      ],
      "tool-calls"
    )
    const messages = [makeUserEntry(), earlier, bug]
    const result = transformMessages(messages)
    expect(result).toBe(messages)
    expect(messages).toHaveLength(3)
    // earlier message untouched
    expect(earlier.parts).toHaveLength(4)
    // bug message truncated right after the tool part
    expect(bug.parts).toHaveLength(1)
    expect(bug.parts[0]?.type).toBe("tool")
  })

  test("retry scenario: error assistant tail is skipped, bug message beneath is fixed", () => {
    const bug = makeAssistantEntry(
      [
        makeToolPart(),
        makeStepStartPart(),
        makeTextPart("narration"),
        makeStepFinishPart(),
      ],
      "tool-calls"
    )
    const errorTail = makeErrorAssistantEntry()
    const messages = [makeUserEntry(), bug, errorTail]
    transformMessages(messages)
    // error tail left in place (OpenCode drops it), bug message fixed
    expect(messages).toHaveLength(3)
    expect(bug.parts).toHaveLength(1)
  })

  test("empty assistant tail is skipped, bug message beneath is fixed", () => {
    const bug = makeAssistantEntry(
      [makeToolPart(), makeStepStartPart(), makeTextPart("narration")],
      "tool-calls"
    )
    const emptyTail = makeAssistantEntry([
      makeStepStartPart(),
      makeStepFinishPart(),
    ])
    const messages = [makeUserEntry(), bug, emptyTail]
    transformMessages(messages)
    expect(messages).toHaveLength(3)
    expect(bug.parts).toHaveLength(1)
  })

  test("valid tail (text after step-finish, same block) is untouched", () => {
    const valid = makeAssistantEntry(
      [
        makeStepStartPart(),
        makeReasoningPart("hmm"),
        makeToolPart(),
        makeStepFinishPart(),
        makeTextPart("answer"),
      ],
      "tool-calls"
    )
    const messages = [makeUserEntry(), valid]
    transformMessages(messages)
    expect(valid.parts).toHaveLength(5)
  })

  test("genuine end-turn text-only tail is untouched (no runaway trigger)", () => {
    const done = makeAssistantEntry(
      [makeStepStartPart(), makeTextPart("All done. Final report...")],
      "stop"
    )
    const messages = [makeUserEntry(), done]
    transformMessages(messages)
    expect(messages).toHaveLength(2)
    expect(done.parts).toHaveLength(2)
  })

  test("Bedrock claude-sonnet-5 model id is targeted", () => {
    const bug = makeAssistantEntry(
      [makeToolPart(), makeStepStartPart(), makeTextPart("narration")],
      "tool-calls"
    )
    const messages = [makeUserEntry("global.anthropic.claude-sonnet-5"), bug]
    transformMessages(messages)
    expect(bug.parts).toHaveLength(1)
  })
})

// ─── transformMessages (removal mode - legacy) ──────────────────────────────

describe("transformMessages (removal mode - legacy)", () => {
  test("content-bearing assistant → removed in place", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeTextPart("hello")]),
    ]
    const result = transformMessages(messages, "removal")
    expect(result).toBe(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })

  test("multiple empty assistants → all removed in place", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeStepStartPart()]),
      makeAssistantEntry([makeStepFinishPart()]),
    ]
    transformMessages(messages, "removal")
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })
})

// ─── transformMessages (transform mode - legacy) ────────────────────────────

describe("transformMessages (transform mode - legacy)", () => {
  test("mid-loop assistant (finish=tool-calls) → synthetic Continue. appended in place", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry(
        [makeTextPart("hello"), makeReasoningPart("thinking")],
        "tool-calls"
      ),
    ]
    const result = transformMessages(messages, "transform")
    expect(result).toBe(messages)
    expect(messages).toHaveLength(3)
    expect(messages[2]?.info.role).toBe("user")
    expect(messages[2]?.parts[0]).toMatchObject({
      type: "text",
      text: "Continue.",
    })
  })

  test("genuine end turn (finish=stop) → tail dropped, no Continue. (runaway fix)", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeTextPart("final answer")], "stop"),
    ]
    transformMessages(messages, "transform")
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })

  test("single empty assistant → removed only", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeStepStartPart(), makeStepFinishPart()]),
    ]
    transformMessages(messages, "transform")
    expect(messages).toHaveLength(1)
    expect(messages[0]?.info.role).toBe("user")
  })

  test("synthetic message sessionID matches last assistant", () => {
    const assistant = makeAssistantEntry([makeTextPart("hello")], "tool-calls")
    const messages = [makeUserEntry(), assistant]
    const assistantSessionID = assistant.info.sessionID
    const result = transformMessages(messages, "transform")
    expect(result[2]?.info.sessionID).toBe(assistantSessionID)
  })

  test("synthetic message agent and model come from latest user message", () => {
    const user = makeUserEntry("claude-sonnet-5")
    const messages = [
      user,
      makeAssistantEntry([makeTextPart("hello")], "tool-calls"),
    ]
    const result = transformMessages(messages, "transform")
    const synthetic = result[2]?.info as {
      agent: string
      model: { modelID: string }
    }
    expect(synthetic.agent).toBe(AGENT)
    expect(synthetic.model.modelID).toBe("claude-sonnet-5")
  })

  test("synthetic text part has messageID matching synthetic message id", () => {
    const messages = [
      makeUserEntry(),
      makeAssistantEntry([makeTextPart("hello")], "tool-calls"),
    ]
    const result = transformMessages(messages, "transform")
    expect(result).toHaveLength(3)
    const syntheticMsg = result[2] as MessageEntry
    const syntheticPart = syntheticMsg.parts[0] as { messageID: string }
    expect(syntheticPart.messageID).toBe(syntheticMsg.info.id)
  })
})
