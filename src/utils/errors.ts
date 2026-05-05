export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class TimeoutError extends AppError {
  constructor(
    message: string,
    public readonly elapsedMs: number
  ) {
    super(message, 'TIMEOUT', 504);
    this.name = 'TimeoutError';
  }
}

export class ClaudeAPIError extends AppError {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly responseBody?: string
  ) {
    super(message, 'CLAUDE_API_ERROR', httpStatus);
    this.name = 'ClaudeAPIError';
  }
}

export class MCPError extends AppError {
  constructor(
    message: string,
    public readonly serverUrl: string,
    public readonly toolName?: string
  ) {
    super(message, 'MCP_ERROR', 502);
    this.name = 'MCPError';
  }
}

export class CodeExecutionError extends AppError {
  constructor(
    message: string,
    public readonly codeSnippet?: string
  ) {
    super(message, 'CODE_EXECUTION_ERROR', 500);
    this.name = 'CodeExecutionError';
  }
}
