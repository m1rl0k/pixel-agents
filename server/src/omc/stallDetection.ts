/**
 * Stall detection — adapted from OneManCompany (Apache-2.0)
 * https://github.com/1mancompany/OneManCompany — onemancompany/core/vessel.py
 *
 * Detects assistant output that promises action without tool use in the same turn.
 */

/** Max stall retries per assignment before giving up (OMC MAX_STALL_RETRIES). */
export const MAX_STALL_RETRIES = 2;

const PROMISE_PATTERN =
  /(?:I will (?:now |start |begin )|I'll (?:now |start |begin )|Let me (?:start|begin|proceed)|Next,? I'?(?:ll| will)|I'?m going to (?:start|begin)|Going to dispatch|I need to)/i;

export function detectUnfulfilledPromises(output: string | undefined): boolean {
  if (!output?.trim()) return false;
  return PROMISE_PATTERN.test(output);
}

export function shouldRetryStall(opts: {
  hadToolsInTurn: boolean;
  assistantText: string;
  stallRetryCount: number;
}): boolean {
  if (opts.hadToolsInTurn) return false;
  if (!detectUnfulfilledPromises(opts.assistantText)) return false;
  return opts.stallRetryCount < MAX_STALL_RETRIES;
}
