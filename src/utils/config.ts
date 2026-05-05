import type { Env } from '../types/env.js';
import type { RequestLogger } from './logger.js';

export interface OrchestrationConfig {
  model: string;
  maxTokens: number;
  maxIterations: number;
  codeExecTimeoutMs: number;
  maxMcpCallsPerExecution: number;
  maxMcpCallsPerRequest: number;
  fredMcpUrl: string;
}

export function parseIntEnvVar(
  value: string | undefined,
  key: string,
  defaultValue: number,
  logger: RequestLogger
): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    logger.warn('invalid_env_var', { key, value, using: defaultValue });
    return defaultValue;
  }
  return parsed;
}

export function getOrchestrationConfig(env: Env, logger: RequestLogger): OrchestrationConfig {
  return {
    model: env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
    maxTokens: parseIntEnvVar(env.CLAUDE_MAX_TOKENS, 'CLAUDE_MAX_TOKENS', 4096, logger),
    maxIterations: parseIntEnvVar(
      env.MAX_ORCHESTRATION_ITERATIONS,
      'MAX_ORCHESTRATION_ITERATIONS',
      25,
      logger
    ),
    codeExecTimeoutMs: parseIntEnvVar(
      env.CODE_EXEC_TIMEOUT_MS,
      'CODE_EXEC_TIMEOUT_MS',
      30000,
      logger
    ),
    maxMcpCallsPerExecution: parseIntEnvVar(
      env.MAX_MCP_CALLS_PER_EXECUTION,
      'MAX_MCP_CALLS_PER_EXECUTION',
      10,
      logger
    ),
    maxMcpCallsPerRequest: parseIntEnvVar(
      env.MAX_MCP_CALLS_PER_REQUEST,
      'MAX_MCP_CALLS_PER_REQUEST',
      50,
      logger
    ),
    fredMcpUrl: env.FRED_MCP_URL ?? 'https://fred-mcp.fly.dev/mcp',
  };
}
