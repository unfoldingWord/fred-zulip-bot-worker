import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequestLogger } from '../../../src/utils/logger.js';

describe('createRequestLogger', () => {
  const requestId = 'req-abc-123';
  let logSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logSpy = vi.fn();
    warnSpy = vi.fn();
    errorSpy = vi.fn();
    console.log = logSpy; // eslint-disable-line no-console
    console.warn = warnSpy;
    console.error = errorSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits structured JSON log with event and request_id', () => {
    const logger = createRequestLogger(requestId);
    logger.log('test_event', { foo: 'bar' });

    expect(logSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.event).toBe('test_event');
    expect(output.request_id).toBe(requestId);
    expect(output.foo).toBe('bar');
    expect(output.level).toBe('info');
    expect(output.timestamp).toBeTypeOf('number');
  });

  it('emits warn level via console.warn', () => {
    const logger = createRequestLogger(requestId);
    logger.warn('warn_event', { count: 5 });

    expect(warnSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(output.level).toBe('warn');
    expect(output.event).toBe('warn_event');
    expect(output.count).toBe(5);
  });

  it('emits error level via console.error', () => {
    const logger = createRequestLogger(requestId);
    logger.error('error_event', { error: 'something broke' });

    expect(errorSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(output.level).toBe('error');
    expect(output.event).toBe('error_event');
    expect(output.error).toBe('something broke');
  });

  it('works without optional fields', () => {
    const logger = createRequestLogger(requestId);
    logger.log('minimal_event');

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.event).toBe('minimal_event');
    expect(output.request_id).toBe(requestId);
  });
});
