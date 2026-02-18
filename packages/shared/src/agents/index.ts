/**
 * Agents Module
 *
 * Workspace agents are stateful multi-stage workflows with deterministic
 * control flow enforcement, following the 12-Factor Agents methodology.
 */

export * from './types.ts';
export * from './storage.ts';
export { classifyError } from './error-classifier.ts';
export { resolveAgentEnvironment } from './environment.ts';
export type { AgentEnvironmentResolution, AutoEnableWarning, AutoEnableDiagnostic } from './environment.ts';
