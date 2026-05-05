import { describe, it, expect, vi } from 'vitest';
import { executeCode } from '../../../../src/services/code-execution/quickjs-executor.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

describe('executeCode', () => {
  const logger: RequestLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const defaultOptions = { timeoutMs: 5000, maxMcpCallsPerExecution: 10 };

  it('executes basic JavaScript and returns result via __result__', async () => {
    const result = await executeCode('__result__ = 2 + 2;', {}, defaultOptions, logger);

    expect(result.success).toBe(true);
    expect(result.result).toBe(4);
    expect(result.execution_time_ms).toBeTypeOf('number');
  });

  it('captures console output', async () => {
    const result = await executeCode(
      'console.log("hello"); console.warn("warning");',
      {},
      defaultOptions,
      logger
    );

    expect(result.success).toBe(true);
    expect(result.console_output).toHaveLength(2);
    expect(result.console_output[0].level).toBe('log');
    expect(result.console_output[0].message).toBe('hello');
    expect(result.console_output[1].level).toBe('warn');
  });

  it('returns error for invalid code', async () => {
    const result = await executeCode('this is not valid javascript!!!', {}, defaultOptions, logger);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('handles undefined __result__', async () => {
    const result = await executeCode('const x = 5;', {}, defaultOptions, logger);

    expect(result.success).toBe(true);
    expect(result.result).toBeUndefined();
  });

  it('supports object results', async () => {
    const result = await executeCode(
      '__result__ = { count: 3, items: ["a", "b"] };',
      {},
      defaultOptions,
      logger
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ count: 3, items: ['a', 'b'] });
  });

  it('logs execution start and complete', async () => {
    await executeCode('__result__ = 1;', {}, defaultOptions, logger);

    expect(logger.log).toHaveBeenCalledWith('code_execution_start', expect.any(Object));
    expect(logger.log).toHaveBeenCalledWith('code_execution_complete', expect.any(Object));
  });
});
