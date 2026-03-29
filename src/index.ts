import type { Plugin } from "@opencode-ai/plugin"
import { transformMessages } from "./transform"
import { logger } from "./logger";

export const ClaudeTailguardPlugin: Plugin = async () => {
  logger.log("ClaudeTailguardPlugin initialized")
  return {
    "experimental.chat.messages.transform": async (_, output) => {
      output.messages = transformMessages(output.messages)
    },
  }
}
