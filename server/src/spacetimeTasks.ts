/**
 * Default worker orders for the autonomous facility loop.
 *
 * These are seed assignments only. User-entered swarm goals can be research,
 * design, writing, operations, coding, planning, or any other task shape.
 */

export const SPACETIME_WORKER_TASKS = [
  'break down the current user goal into scout, builder, reviewer, and verifier lanes',
  'identify the next smallest useful improvement and define acceptance criteria',
  'research the unknowns and report sources, assumptions, and confidence',
  'draft a plan that another worker can execute without hidden context',
  'review peer output for gaps, regressions, and missing validation',
  'summarize the current swarm state into decisions, blockers, and next actions',
  'propose UI/UX improvements that make the orchestrator easier to command',
  'write a concise user-facing explanation of the latest swarm result',
  'map dependencies, credentials, and runtime risks before execution',
  'turn a broad request into concrete subtasks with owners and stop conditions',
  'verify whether the latest change satisfies the user goal',
  'generate test scenarios for the active task, including edge cases',
  'prepare a fallback path if the primary approach fails',
  'inspect logs or state for signals that change the plan',
  'convert a peer finding into an implementation-ready patch brief',
  'document reusable knowledge for future agents in the project',
  'check whether the swarm should use a specialist model or provider',
  'reduce duplicate work by merging compatible peer findings',
  'identify the next self-improvement for the agent orchestration loop',
  'score progress against target result, constraints, evidence, and stop condition',
] as const;

/** Round-robin next task for a worker dispatch. */
export function pickSpacetimeTask(cursor: number): string {
  return SPACETIME_WORKER_TASKS[cursor % SPACETIME_WORKER_TASKS.length];
}
