export interface CodeExecutionResult {
  success: boolean;
  result: unknown;
  console_output: ConsoleEntry[];
  execution_time_ms: number;
  error?: string;
}

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface ExecutionOptions {
  timeoutMs: number;
  maxMcpCallsPerExecution: number;
}

export type HostFunction = (args: unknown) => Promise<string>;
