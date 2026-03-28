import { createWriteStream } from "fs"
import { homedir } from "os"
import { join } from "path"
import { stdout } from "process"

const defaultLogPath = join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "claude-tailguard-plugin.log"
)

interface LoggerOptions {
  stderr: boolean
  logfile: string
}

function createLogger(options?: Partial<LoggerOptions>) {
  const combinedOptions: LoggerOptions = {
    stderr: true,
    logfile: defaultLogPath,
    ...options,
  }

  const stream = combinedOptions.logfile
    ? createWriteStream(combinedOptions.logfile)
    : null

  return {
    log(...args: unknown[]) {
      const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`
      if (combinedOptions.stderr) stdout.write(line)
      if (stream) stream.write(line)
    },
  }
}

export const logger = createLogger()
