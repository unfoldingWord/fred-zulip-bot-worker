export interface CodeExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  errorCode?: string;
  callsMade?: number;
  callLimit?: number;
  logs: ConsoleLog[];
  duration_ms: number;
}

export interface ConsoleLog {
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface HostFunction {
  name: string;
  fn: (...args: unknown[]) => Promise<unknown>;
}

export interface CodeExecutionOptions {
  timeout_ms: number;
  hostFunctions: HostFunction[];
  maxMcpCalls?: number;
}
