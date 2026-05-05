import type { QuickJSContext, QuickJSHandle } from '@cf-wasm/quickjs';
import type { RequestLogger } from '../../utils/logger.js';
import type { ConsoleEntry, ExecutionOptions, HostFunction } from './types.js';

export interface VMContext {
  consoleOutput: ConsoleEntry[];
  pendingCalls: Array<{ name: string; args: unknown; resolve: (v: string) => void }>;
  mcpCallCount: number;
}

export function setupVM(
  vm: QuickJSContext,
  hostFunctions: Record<string, HostFunction>,
  options: ExecutionOptions,
  _logger: RequestLogger
): VMContext {
  const context: VMContext = { consoleOutput: [], pendingCalls: [], mcpCallCount: 0 };

  setupConsole(vm, context);
  setupHostFunctions(vm, hostFunctions, context, options);

  return context;
}

function setupConsole(vm: QuickJSContext, context: VMContext): void {
  const consoleObj = vm.newObject();
  const levels = ['log', 'info', 'warn', 'error'] as const;

  for (const level of levels) {
    const fn = vm.newFunction(level, (...args: QuickJSHandle[]) => {
      const message = args.map((a) => vm.dump(a)).join(' ');
      context.consoleOutput.push({ level, message, timestamp: Date.now() });
    });
    vm.setProp(consoleObj, level, fn);
    fn.dispose();
  }

  vm.setProp(vm.global, 'console', consoleObj);
  consoleObj.dispose();
}

function setupHostFunctions(
  vm: QuickJSContext,
  hostFunctions: Record<string, HostFunction>,
  context: VMContext,
  options: ExecutionOptions
): void {
  for (const [name, _fn] of Object.entries(hostFunctions)) {
    const wrapped = vm.newFunction(name, (...args: QuickJSHandle[]) => {
      if (context.mcpCallCount >= options.maxMcpCallsPerExecution) {
        return {
          error: vm.newString(`MCP call limit (${options.maxMcpCallsPerExecution}) exceeded`),
        };
      }
      context.mcpCallCount++;
      const firstArg = args[0];
      const input = firstArg ? vm.dump(firstArg) : {};
      context.pendingCalls.push({ name, args: input, resolve: () => {} });
      return { error: vm.newString('__PENDING_CALL__:' + (context.pendingCalls.length - 1)) };
    });
    vm.setProp(vm.global, name, wrapped);
    wrapped.dispose();
  }
}
