import { createWriteStream } from "fs"
import { lstat, mkdir } from "fs/promises"
import { homedir } from "os"
import { dirname, join } from "path"
import { stdout } from "process"

export interface Logger {
  log(...args: unknown[]): void
}

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

async function createStream(path: string) {
  try {
    const dirPath = dirname(path)
    if (!(await lstat(dirPath)).isDirectory()) {
      await mkdir(dirPath, { recursive: true })
    }
    return createWriteStream(path, { flush: true })
  } finally {}
}

export async function createLogger(
  options?: Partial<LoggerOptions>
): Promise<Logger> {
  const combinedOptions: LoggerOptions = {
    stderr: true,
    logfile: defaultLogPath,
    ...options,
  }

  const stream = combinedOptions.logfile
    ? await createStream(combinedOptions.logfile)
    : null

  return {
    log(...args: unknown[]) {
      const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`
      if (combinedOptions.stderr) stdout.write(line)
      if (combinedOptions.logfile && stream) stream.write(line)
    },
  }
}

export const logger = await createLogger()
