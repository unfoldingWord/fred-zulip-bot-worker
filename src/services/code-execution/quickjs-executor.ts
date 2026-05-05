import { getQuickJSWASMModule } from '@cf-wasm/quickjs';
import type { RequestLogger } from '../../utils/logger.js';
import type { CodeExecutionResult, ExecutionOptions, HostFunction } from './types.js';
import { setupVM } from './vm-setup.js';
import { runCodeInVM } from './vm-execution.js';

export async function executeCode(
  code: string,
  hostFunctions: Record<string, HostFunction>,
  options: ExecutionOptions,
  logger: RequestLogger
): Promise<CodeExecutionResult> {
  const startMs = Date.now();
  logger.log('code_execution_start', { code_length: code.length });

  try {
    const module = await getQuickJSWASMModule();
    const result = await runWithVM(module, code, hostFunctions, options, logger);
    const elapsed = Date.now() - startMs;

    logger.log('code_execution_complete', {
      execution_time_ms: elapsed,
      result_size: JSON.stringify(result.result ?? '').length,
      console_lines: result.console_output.length,
    });

    return { ...result, execution_time_ms: elapsed };
  } catch (e) {
    const elapsed = Date.now() - startMs;
    logger.error('code_execution_error', { error: String(e), code_snippet: code.slice(0, 500) });
    return {
      success: false,
      result: null,
      console_output: [],
      execution_time_ms: elapsed,
      error: String(e),
    };
  }
}

async function runWithVM(
  module: Awaited<ReturnType<typeof getQuickJSWASMModule>>,
  code: string,
  hostFunctions: Record<string, HostFunction>,
  options: ExecutionOptions,
  logger: RequestLogger
): Promise<Omit<CodeExecutionResult, 'execution_time_ms'>> {
  const vm = module.newContext();
  try {
    const context = setupVM(vm, hostFunctions, options, logger);
    return await runCodeInVM(vm, code, context, options, logger);
  } finally {
    vm.dispose();
  }
}
