export interface RequestLogger {
  log: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
}

function emit(
  level: 'info' | 'warn' | 'error',
  requestId: string,
  event: string,
  fields?: Record<string, unknown>
): void {
  const entry = {
    level,
    event,
    request_id: requestId,
    timestamp: Date.now(),
    ...fields,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
}

export function createRequestLogger(requestId: string): RequestLogger {
  return {
    log: (event, fields) => emit('info', requestId, event, fields),
    warn: (event, fields) => emit('warn', requestId, event, fields),
    error: (event, fields) => emit('error', requestId, event, fields),
  };
}
