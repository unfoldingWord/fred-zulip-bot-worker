import { getQuickJSWASMModule, QuickJSContext } from '@cf-wasm/quickjs/workerd';
import { CodeExecutionError, MCPCallLimitError, TimeoutError } from '../../utils/errors.js';
import type { RequestLogger } from '../../utils/logger.js';
import { summarizeArgs } from '../../utils/log-redaction.js';
import type {
  CodeExecutionOptions,
  CodeExecutionResult,
  ConsoleLog,
  HostFunction,
} from './types.js';

const INTERRUPT_CHECK_CYCLES = 10000;
const DEFAULT_MAX_MCP_CALLS = 10;
const MCP_CALL_WARNING_THRESHOLD = 0.8;
const CONSOLE_LINE_MAX = 1024;
const CODE_LOG_PREFIX_LEN = 1000;
const STACK_LOG_LEN = 500;

interface MCPCallCounter {
  count: number;
  limit: number;
}

interface PendingCall {
  id: number;
  fn: HostFunction;
  args: unknown[];
}

async function getQuickJSModule() {
  return await getQuickJSWASMModule();
}

function setupConsole(vm: QuickJSContext, logs: ConsoleLog[], logger: RequestLogger): void {
  const consoleHandle = vm.newObject();
  const logLevels = ['log', 'info', 'warn', 'error'] as const;

  for (const level of logLevels) {
    const fnHandle = vm.newFunction(level, (...args) => {
      const message = args
        .map((arg) => {
          const val = vm.dump(arg);
          return typeof val === 'string' ? val : JSON.stringify(val);
        })
        .join(' ');
      const truncated =
        message.length > CONSOLE_LINE_MAX ? message.slice(0, CONSOLE_LINE_MAX) + '…' : message;
      logs.push({ level, message: truncated, timestamp: Date.now() });
      logger.log('code_execution_console', { level, message: truncated });
    });
    vm.setProp(consoleHandle, level, fnHandle);
    fnHandle.dispose();
  }

  vm.setProp(vm.global, 'console', consoleHandle);
  consoleHandle.dispose();
}

function setVMResult(vm: QuickJSContext, id: number, value: unknown): void {
  let jsonValue: string;
  try {
    jsonValue = JSON.stringify(value);
  } catch (e) {
    throw new Error(
      `Failed to serialize value for VM: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const safeStringLiteral = JSON.stringify(jsonValue);
  const result = vm.evalCode(`__pendingResults__[${id}] = JSON.parse(${safeStringLiteral});`);
  if (result.error) {
    const errorValue = vm.dump(result.error);
    result.error.dispose();
    throw new Error(`Failed to set VM result: ${formatErrorValue(errorValue)}`);
  }
  result.value.dispose();
}

function registerHostFunction(
  vm: QuickJSContext,
  hostFn: HostFunction,
  pendingCalls: PendingCall[],
  callIdRef: { id: number }
): void {
  const fnHandle = vm.newFunction(hostFn.name, (...args) => {
    const id = callIdRef.id++;
    const dumpedArgs = args.map((arg) => vm.dump(arg));

    const promiseResult = vm.evalCode(
      `new Promise((resolve, reject) => { __resolvers__[${id}] = { resolve, reject }; })`
    );

    if (promiseResult.error) {
      promiseResult.error.dispose();
      throw new Error('Failed to create promise in sandbox');
    }

    const promiseHandle = promiseResult.value;
    pendingCalls.push({ id, fn: hostFn, args: dumpedArgs });
    return promiseHandle;
  });

  vm.setProp(vm.global, hostFn.name, fnHandle);
  fnHandle.dispose();
}

function setupHostFunctions(vm: QuickJSContext, hostFunctions: HostFunction[]): PendingCall[] {
  const pendingCalls: PendingCall[] = [];
  const callIdRef = { id: 0 };

  const initResult = vm.evalCode(
    'var __pendingResults__ = {}; var __resolvers__ = {}; var __result__ = undefined; var __executionError__ = undefined;'
  );
  if (initResult.error) {
    initResult.error.dispose();
  } else {
    initResult.value.dispose();
  }

  for (const hostFn of hostFunctions) {
    registerHostFunction(vm, hostFn, pendingCalls, callIdRef);
  }

  return pendingCalls;
}

function resolvePendingCall(vm: QuickJSContext, callId: number, result: unknown): void {
  setVMResult(vm, callId, result);
  const resolveCode = `__resolvers__[${callId}].resolve(__pendingResults__[${callId}]);`;
  const resolveResult = vm.evalCode(resolveCode);
  if (resolveResult.error) {
    resolveResult.error.dispose();
  } else {
    resolveResult.value.dispose();
  }
}

function rejectPendingCall(vm: QuickJSContext, callId: number, error: unknown): void {
  let msg = error instanceof Error ? error.message : String(error);
  try {
    setVMResult(vm, callId, { __error__: msg });
  } catch {
    msg = 'Error: Result serialization failed';
  }
  const rejectCode = `__resolvers__[${callId}].reject(new Error(${JSON.stringify(msg)}));`;
  const rejectResult = vm.evalCode(rejectCode);
  if (rejectResult.error) {
    rejectResult.error.dispose();
  } else {
    rejectResult.value.dispose();
  }
}

function logMcpCall(
  logger: RequestLogger,
  mcpCounter: MCPCallCounter,
  toolName: string,
  args: unknown[]
): void {
  logger.log('mcp_call_executed', {
    tool_name: toolName,
    args: summarizeArgs(Object.fromEntries(args.map((a, i) => [String(i), a]))),
    call_number: mcpCounter.count,
    limit: mcpCounter.limit,
  });
  const warningThreshold = mcpCounter.limit * MCP_CALL_WARNING_THRESHOLD;
  if (mcpCounter.count >= warningThreshold && mcpCounter.count < mcpCounter.limit) {
    logger.warn('mcp_call_limit_warning', {
      calls_made: mcpCounter.count,
      limit: mcpCounter.limit,
      remaining: mcpCounter.limit - mcpCounter.count,
    });
  }
}

async function callWithWallClockBudget<T>(
  promise: Promise<T>,
  remainingMs: number,
  callName: string,
  totalTimeoutMs: number,
  logger: RequestLogger
): Promise<T> {
  if (remainingMs <= 0) {
    logger.warn('host_call_wallclock_timeout', {
      tool_name: callName,
      remaining_ms: remainingMs,
      total_timeout_ms: totalTimeoutMs,
      reason: 'budget_already_exhausted',
    });
    throw new TimeoutError(
      `Host call '${callName}' rejected: execute_code wall-clock budget already exhausted`,
      0
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      logger.warn('host_call_wallclock_timeout', {
        tool_name: callName,
        remaining_ms: remainingMs,
        total_timeout_ms: totalTimeoutMs,
        reason: 'timer_fired',
      });
      reject(
        new TimeoutError(
          `Host call '${callName}' exceeded execute_code wall-clock budget (${remainingMs}ms remaining)`,
          remainingMs
        )
      );
    }, remainingMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executePendingCall(
  vm: QuickJSContext,
  call: PendingCall,
  mcpCounter: MCPCallCounter,
  logger: RequestLogger,
  budget: { startTime: number; timeoutMs: number }
): Promise<void> {
  mcpCounter.count++;
  logMcpCall(logger, mcpCounter, call.fn.name, call.args);
  const callStart = Date.now();
  try {
    const remainingMs = budget.timeoutMs - (Date.now() - budget.startTime);
    const result = await callWithWallClockBudget(
      Promise.resolve().then(() => call.fn.fn(...call.args)),
      remainingMs,
      call.fn.name,
      budget.timeoutMs,
      logger
    );
    const resultSize = (() => {
      try {
        return JSON.stringify(result ?? null).length;
      } catch {
        return -1;
      }
    })();
    logger.log('mcp_call_complete', {
      tool_name: call.fn.name,
      call_number: mcpCounter.count,
      duration_ms: Date.now() - callStart,
      result_size: resultSize,
      success: true,
    });
    resolvePendingCall(vm, call.id, result);
  } catch (error) {
    logger.warn('mcp_call_failed', {
      tool_name: call.fn.name,
      call_number: mcpCounter.count,
      duration_ms: Date.now() - callStart,
      error: error instanceof Error ? error.message : String(error),
      error_name: error instanceof Error ? error.name : 'Unknown',
    });
    rejectPendingCall(vm, call.id, error);
  }
}

async function processPendingCalls(
  vm: QuickJSContext,
  pendingCalls: PendingCall[],
  mcpCounter: MCPCallCounter,
  logger: RequestLogger,
  budget: { startTime: number; timeoutMs: number }
): Promise<void> {
  do {
    if (pendingCalls.length > 0) {
      const batch = pendingCalls.splice(0, pendingCalls.length);
      if (mcpCounter.count + batch.length > mcpCounter.limit) {
        logger.warn('mcp_call_limit_exceeded', {
          calls_made: mcpCounter.count,
          calls_attempted: mcpCounter.count + batch.length,
          limit: mcpCounter.limit,
        });
        throw new MCPCallLimitError(mcpCounter.count, mcpCounter.limit);
      }
      await Promise.all(
        batch.map((call) => executePendingCall(vm, call, mcpCounter, logger, budget))
      );
    }
    vm.runtime.executePendingJobs();
  } while (pendingCalls.length > 0);
}

function createInterruptHandler(startTime: number, timeoutMs: number) {
  let interrupted = false;
  let cycleCount = 0;

  const handler = () => {
    cycleCount++;
    if (cycleCount % INTERRUPT_CHECK_CYCLES === 0 && Date.now() - startTime > timeoutMs) {
      interrupted = true;
      return true;
    }
    return false;
  };

  return { handler, isInterrupted: () => interrupted };
}

function formatErrorValue(errorValue: unknown): string {
  if (typeof errorValue === 'string') return errorValue;
  if (errorValue && typeof errorValue === 'object') {
    const err = errorValue as Record<string, unknown>;
    if (err.message) {
      return err.stack ? `${err.message}\n${err.stack}` : String(err.message);
    }
    try {
      return JSON.stringify(errorValue);
    } catch {
      return String(errorValue);
    }
  }
  return String(errorValue);
}

function evaluateUserCode(vm: QuickJSContext, code: string): void {
  const wrappedCode = `(async () => { ${code} })().catch(e => { __executionError__ = e instanceof Error ? e.message : String(e); });`;
  const result = vm.evalCode(wrappedCode, 'user-code.js');
  if (result.error) {
    const errorValue = vm.dump(result.error);
    result.error.dispose();
    throw new CodeExecutionError(formatErrorValue(errorValue));
  }
  result.value.dispose();
}

function checkExecutionError(vm: QuickJSContext): void {
  const errorResult = vm.evalCode('__executionError__', 'get-error.js');
  if (errorResult.error) {
    errorResult.error.dispose();
    return;
  }
  const errorValue = vm.dump(errorResult.value);
  errorResult.value.dispose();
  if (errorValue !== undefined) {
    throw new CodeExecutionError(formatErrorValue(errorValue));
  }
}

function extractResult(vm: QuickJSContext): unknown {
  const finalResult = vm.evalCode('__result__', 'get-result.js');
  if (finalResult.error) {
    const errorValue = vm.dump(finalResult.error);
    finalResult.error.dispose();
    throw new CodeExecutionError(formatErrorValue(errorValue));
  }
  const value = vm.dump(finalResult.value);
  finalResult.value.dispose();
  return value;
}

function buildSuccessResult(
  value: unknown,
  logs: ConsoleLog[],
  startTime: number,
  mcpCounter: MCPCallCounter
): CodeExecutionResult {
  const result: CodeExecutionResult = {
    success: true,
    result: value,
    logs,
    duration_ms: Date.now() - startTime,
  };
  if (mcpCounter.count > 0) {
    result.callsMade = mcpCounter.count;
    result.callLimit = mcpCounter.limit;
  }
  return result;
}

function buildErrorResult(
  error: unknown,
  logs: ConsoleLog[],
  startTime: number,
  mcpCounter?: MCPCallCounter
): CodeExecutionResult {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';

  if (error instanceof MCPCallLimitError) {
    return {
      success: false,
      error: errorMessage,
      errorCode: 'MCP_CALL_LIMIT_EXCEEDED',
      callsMade: error.callsMade,
      callLimit: error.limit,
      logs,
      duration_ms: Date.now() - startTime,
    };
  }

  if (error instanceof TimeoutError) {
    return {
      success: false,
      error: errorMessage,
      errorCode: 'TIMEOUT',
      logs,
      duration_ms: Date.now() - startTime,
      ...(mcpCounter && { callsMade: mcpCounter.count, callLimit: mcpCounter.limit }),
    };
  }

  return {
    success: false,
    error: errorMessage,
    logs,
    duration_ms: Date.now() - startTime,
    ...(mcpCounter && { callsMade: mcpCounter.count, callLimit: mcpCounter.limit }),
  };
}

function logExecutionError(
  logger: RequestLogger,
  error: unknown,
  startTime: number,
  mcpCounter: MCPCallCounter,
  code: string
): void {
  const baseData = {
    duration_ms: Date.now() - startTime,
    mcp_calls_made: mcpCounter.count,
    mcp_calls_limit: mcpCounter.limit,
    code: code.slice(0, CODE_LOG_PREFIX_LEN),
  };
  if (error instanceof MCPCallLimitError) {
    logger.warn('code_execution_limit_error', {
      ...baseData,
      error: 'MCP_CALL_LIMIT_EXCEEDED',
    });
  } else if (error instanceof TimeoutError) {
    logger.warn('code_execution_timeout', {
      ...baseData,
      error: error.message,
      elapsed_ms: error.elapsedMs,
      phase: 'host_call_wallclock',
    });
  } else {
    logger.error('code_execution_error', {
      ...baseData,
      error: error instanceof Error ? error.message : String(error),
      error_name: error instanceof Error ? error.name : 'Unknown',
      stack:
        error instanceof Error && error.stack ? error.stack.slice(0, STACK_LOG_LEN) : undefined,
    });
  }
}

interface VMExecutionContext {
  vm: QuickJSContext;
  code: string;
  options: CodeExecutionOptions;
  logs: ConsoleLog[];
  mcpCounter: MCPCallCounter;
  logger: RequestLogger;
}

async function runCodeInVM(ctx: VMExecutionContext): Promise<unknown> {
  const startTime = Date.now();
  setupConsole(ctx.vm, ctx.logs, ctx.logger);
  const pendingCalls = setupHostFunctions(ctx.vm, ctx.options.hostFunctions);
  const interrupt = createInterruptHandler(startTime, ctx.options.timeout_ms);
  ctx.vm.runtime.setInterruptHandler(interrupt.handler);
  evaluateUserCode(ctx.vm, ctx.code);
  if (interrupt.isInterrupted()) {
    ctx.logger.warn('code_execution_timeout', {
      duration_ms: Date.now() - startTime,
      timeout_ms: ctx.options.timeout_ms,
      phase: 'interrupt',
    });
    throw new TimeoutError(
      `Code execution exceeded ${ctx.options.timeout_ms}ms`,
      ctx.options.timeout_ms
    );
  }
  ctx.vm.runtime.executePendingJobs();
  await processPendingCalls(ctx.vm, pendingCalls, ctx.mcpCounter, ctx.logger, {
    startTime,
    timeoutMs: ctx.options.timeout_ms,
  });
  checkExecutionError(ctx.vm);
  return extractResult(ctx.vm);
}

export async function executeCode(
  code: string,
  options: CodeExecutionOptions,
  logger: RequestLogger
): Promise<CodeExecutionResult> {
  const startTime = Date.now();
  const logs: ConsoleLog[] = [];
  let vm: QuickJSContext | null = null;
  const mcpCounter: MCPCallCounter = {
    count: 0,
    limit: options.maxMcpCalls ?? DEFAULT_MAX_MCP_CALLS,
  };
  logger.log('code_execution_start', {
    code_length: code.length,
    code: code.slice(0, CODE_LOG_PREFIX_LEN),
    host_functions: options.hostFunctions.map((f) => f.name),
    max_mcp_calls: mcpCounter.limit,
    timeout_ms: options.timeout_ms,
  });

  try {
    const module = await getQuickJSModule();
    const ctx = module.newContext();
    vm = ctx;
    const value = await runCodeInVM({ vm: ctx, code, options, logs, mcpCounter, logger });
    const resultSize = (() => {
      try {
        return JSON.stringify(value ?? null).length;
      } catch {
        return -1;
      }
    })();
    logger.log('code_execution_complete', {
      duration_ms: Date.now() - startTime,
      console_logs_count: logs.length,
      mcp_calls_made: mcpCounter.count,
      mcp_calls_limit: mcpCounter.limit,
      success: true,
      result_size: resultSize,
    });
    return buildSuccessResult(value, logs, startTime, mcpCounter);
  } catch (error) {
    logExecutionError(logger, error, startTime, mcpCounter, code);
    return buildErrorResult(error, logs, startTime, mcpCounter);
  } finally {
    vm?.dispose();
  }
}

export function createMCPHostFunctions(
  toolCaller: (toolName: string, args: unknown) => Promise<unknown>,
  toolNames: string[]
): HostFunction[] {
  return toolNames.map((name) => ({
    name,
    fn: async (...args: unknown[]) => {
      const toolArgs = args.length === 1 ? args[0] : args;
      return toolCaller(name, toolArgs);
    },
  }));
}
