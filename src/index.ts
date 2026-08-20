import type { Plugin } from "@opencode-ai/plugin"
import { logger } from "./logger"
import { transformMessages } from "./transform"

export const ClaudeTailguardPlugin: Plugin = async () => {
  logger.log("ClaudeTailguardPlugin initialized")
  return {
    "experimental.chat.messages.transform": async (_, output) => {
      // In-place contract: OpenCode discards the hook's return value and keeps
      // using its own `messages` reference, so transformMessages() must mutate
      // the array (and entries) in place. Do NOT rebind output.messages.
      transformMessages(output.messages)
    },
  }
}
