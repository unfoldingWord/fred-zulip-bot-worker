import type { QuickJSContext } from '@cf-wasm/quickjs';
import type { RequestLogger } from '../../utils/logger.js';
import type { CodeExecutionResult, ExecutionOptions } from './types.js';
import type { VMContext } from './vm-setup.js';

export async function runCodeInVM(
  vm: QuickJSContext,
  code: string,
  context: VMContext,
  options: ExecutionOptions,
  logger: RequestLogger
): Promise<Omit<CodeExecutionResult, 'execution_time_ms'>> {
  const wrappedCode = wrapUserCode(code);
  const evalResult = vm.evalCode(wrappedCode);

  if ('error' in evalResult && evalResult.error) {
    const errorStr = vm.dump(evalResult.error);
    evalResult.error.dispose();
    return {
      success: false,
      result: null,
      console_output: context.consoleOutput,
      error: String(errorStr),
    };
  }

  if ('value' in evalResult) evalResult.value.dispose();

  if (context.pendingCalls.length > 0) {
    logger.warn('code_execution_sync_only', {
      pending_calls: context.pendingCalls.length,
      note: 'Async host calls not yet supported in sync mode',
    });
  }

  const result = extractResult(vm, options);
  return { success: true, result, console_output: context.consoleOutput };
}

function wrapUserCode(code: string): string {
  return `(function() {\n${code}\n; return typeof __result__ !== 'undefined' ? __result__ : undefined;\n})()`;
}

function extractResult(vm: QuickJSContext, _options: ExecutionOptions): unknown {
  const resultHandle = vm.getProp(vm.global, '__result__');
  if (vm.typeof(resultHandle) === 'undefined') {
    resultHandle.dispose();
    return undefined;
  }
  const result = vm.dump(resultHandle);
  resultHandle.dispose();
  return result;
}
