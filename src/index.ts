import type { Plugin } from "@opencode-ai/plugin"
import { transformMessages } from "./transform"

export const ClaudeTailguardPlugin: Plugin = async (_ctx) => {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      transformMessages(output.messages)
    },
  }
}
