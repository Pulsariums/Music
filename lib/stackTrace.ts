export interface StackFrame {
  method: string;
  file: string;
  line: number;
  column: number;
  raw: string;
}

/**
 * Parses a standard browser Error stack trace into structured frames.
 * Helps pinpoint the exact file and line number causing the crash.
 */
export const parseStackTrace = (stack: string): StackFrame[] => {
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];

  // Regex to match "at Method (File:Line:Col)" or "at File:Line:Col"
  // Chrome/Edge format: "at functionName ( ... )"
  const chromeRe = /at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+))\)?/;

  for (const line of lines) {
    const match = line.match(chromeRe);
    if (match) {
      frames.push({
        method: match[1] || '<anonymous>',
        file: match[2],
        line: parseInt(match[3], 10),
        column: parseInt(match[4], 10),
        raw: line.trim()
      });
    }
  }

  return frames;
};
