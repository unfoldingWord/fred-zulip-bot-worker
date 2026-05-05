import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseIntEnvVar, getOrchestrationConfig } from '../../../src/utils/config.js';
import type { RequestLogger } from '../../../src/utils/logger.js';
import type { Env } from '../../../src/types/env.js';

describe('parseIntEnvVar', () => {
  const logger: RequestLogger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed integer for valid string', () => {
    expect(parseIntEnvVar('42', 'TEST', 10, logger)).toBe(42);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns default for undefined value', () => {
    expect(parseIntEnvVar(undefined, 'TEST', 10, logger)).toBe(10);
  });

  it('returns default and warns for non-numeric string', () => {
    expect(parseIntEnvVar('abc', 'TEST', 10, logger)).toBe(10);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('returns default for empty string', () => {
    expect(parseIntEnvVar('', 'TEST', 10, logger)).toBe(10);
  });
});

describe('getOrchestrationConfig', () => {
  const logger: RequestLogger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults when env vars are not set', () => {
    const env = { ENVIRONMENT: 'test' } as unknown as Env;
    const config = getOrchestrationConfig(env, logger);

    expect(config.model).toBe('claude-sonnet-4-6');
    expect(config.maxTokens).toBe(4096);
    expect(config.maxIterations).toBe(25);
    expect(config.codeExecTimeoutMs).toBe(30000);
    expect(config.maxMcpCallsPerExecution).toBe(10);
    expect(config.maxMcpCallsPerRequest).toBe(50);
    expect(config.fredMcpUrl).toBe('https://fred-mcp.fly.dev/mcp');
  });

  it('uses env values when provided', () => {
    const env = {
      ENVIRONMENT: 'test',
      CLAUDE_MODEL: 'claude-haiku-4-5',
      CLAUDE_MAX_TOKENS: '8192',
      MAX_ORCHESTRATION_ITERATIONS: '10',
      CODE_EXEC_TIMEOUT_MS: '15000',
      MAX_MCP_CALLS_PER_EXECUTION: '5',
      MAX_MCP_CALLS_PER_REQUEST: '20',
      FRED_MCP_URL: 'http://localhost:3000/mcp',
    } as unknown as Env;
    const config = getOrchestrationConfig(env, logger);

    expect(config.model).toBe('claude-haiku-4-5');
    expect(config.maxTokens).toBe(8192);
    expect(config.maxIterations).toBe(10);
    expect(config.codeExecTimeoutMs).toBe(15000);
    expect(config.maxMcpCallsPerExecution).toBe(5);
    expect(config.maxMcpCallsPerRequest).toBe(20);
    expect(config.fredMcpUrl).toBe('http://localhost:3000/mcp');
  });
});
