import { describe, it, expect, vi } from 'vitest';
import { executeCode } from '../../../../src/services/code-execution/quickjs-executor.js';
import type { HostFunction } from '../../../../src/services/code-execution/types.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

function makeLogger(): RequestLogger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('executeCode', () => {
  const baseOptions = { timeout_ms: 5000, hostFunctions: [] as HostFunction[] };

  it('executes basic JavaScript and returns __result__', async () => {
    const logger = makeLogger();
    const result = await executeCode('__result__ = 2 + 2;', baseOptions, logger);

    expect(result.success).toBe(true);
    expect(result.result).toBe(4);
    expect(result.duration_ms).toBeTypeOf('number');
  });

  it('captures console output', async () => {
    const logger = makeLogger();
    const result = await executeCode(
      'console.log("hello"); console.warn("warning");',
      baseOptions,
      logger
    );

    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(2);
    expect(result.logs[0].level).toBe('log');
    expect(result.logs[0].message).toBe('hello');
    expect(result.logs[1].level).toBe('warn');
    expect(logger.log).toHaveBeenCalledWith(
      'code_execution_console',
      expect.objectContaining({ level: 'log', message: 'hello' })
    );
  });

  it('returns success: false for invalid code', async () => {
    const logger = makeLogger();
    const result = await executeCode('this is not valid javascript!!!', baseOptions, logger);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('handles undefined __result__', async () => {
    const logger = makeLogger();
    const result = await executeCode('const x = 5;', baseOptions, logger);

    expect(result.success).toBe(true);
    expect(result.result).toBeUndefined();
  });

  it('supports object results', async () => {
    const logger = makeLogger();
    const result = await executeCode(
      '__result__ = { count: 3, items: ["a", "b"] };',
      baseOptions,
      logger
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ count: 3, items: ['a', 'b'] });
  });

  it('logs execution start and complete', async () => {
    const logger = makeLogger();
    await executeCode('__result__ = 1;', baseOptions, logger);

    expect(logger.log).toHaveBeenCalledWith('code_execution_start', expect.any(Object));
    expect(logger.log).toHaveBeenCalledWith('code_execution_complete', expect.any(Object));
  });

  it('awaits async host functions and returns their result', async () => {
    const logger = makeLogger();
    const echo: HostFunction = {
      name: 'echo',
      fn: async (...args) => args[0],
    };
    const result = await executeCode(
      '__result__ = await echo({ hello: 1, nested: [1, 2] });',
      { timeout_ms: 5000, hostFunctions: [echo] },
      logger
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ hello: 1, nested: [1, 2] });
    expect(result.callsMade).toBe(1);
  });

  it('enforces per-execution MCP cap', async () => {
    const logger = makeLogger();
    const fn: HostFunction = { name: 'do_thing', fn: async () => 'ok' };
    const result = await executeCode(
      `await do_thing({}); await do_thing({}); __result__ = 'done';`,
      { timeout_ms: 5000, hostFunctions: [fn], maxMcpCalls: 1 },
      logger
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('MCP_CALL_LIMIT_EXCEEDED');
    expect(result.callLimit).toBe(1);
  });

  it('enforces wall-clock budget on a hung host call', async () => {
    const logger = makeLogger();
    const hang: HostFunction = {
      name: 'hang',
      fn: () => new Promise(() => {}),
    };
    const result = await executeCode(
      'try { await hang({}); __result__ = "should not reach"; } catch (e) { __result__ = "caught: " + e.message; }',
      { timeout_ms: 100, hostFunctions: [hang] },
      logger
    );

    expect(result.success).toBe(true);
    expect(String(result.result)).toMatch(/wall-clock budget/i);
    expect(logger.warn).toHaveBeenCalledWith('host_call_wallclock_timeout', expect.any(Object));
  });
});
