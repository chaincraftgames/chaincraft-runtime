import pino from 'pino';

export type { Logger } from 'pino';

/**
 * Centralized logger for the Chaincraft runtime.
 * Always get the session logger from the session object so that logs are
 * tagged with the gameId and specId. This makes it easy to filter logs for 
 * a specific game session.
 * 
 * Log level conventions:
 * Level	When to use
 * trace	RNG draws, fine-grained value resolution
 * debug	Every effect execution, state reads/writes
 * info	    Action taken, flow transitions, session start/end
 * warn	    Unexpected-but-handled situations
 * error	Thrown errors before re-throw
 */
export const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // In dev you'd pipe through pino-pretty; in prod raw JSON is fine
});

export function createSessionLogger(gameId: string, specId: string) {
  return rootLogger.child({ gameId, specId });
}