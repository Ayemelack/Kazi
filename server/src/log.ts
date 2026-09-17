function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  info: (...args: unknown[]) => console.log(`[${timestamp()}] INFO`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${timestamp()}] WARN`, ...args),
  error: (...args: unknown[]) => console.error(`[${timestamp()}] ERROR`, ...args),
};