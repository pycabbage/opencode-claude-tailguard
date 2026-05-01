import type { Plugin } from "@opencode-ai/plugin"
import { logger } from "./logger"
import { transformMessages } from "./transform"

export const ClaudeTailguardPlugin: Plugin = async () => {
  logger.log("ClaudeTailguardPlugin initialized")
  return {
    "experimental.chat.messages.transform": async (_, output) => {
      output.messages = transformMessages(output.messages)
    },
  }
}
