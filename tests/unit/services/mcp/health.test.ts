import { describe, it, expect, vi } from 'vitest';
import { HealthTracker } from '../../../../src/services/mcp/health.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

describe('HealthTracker', () => {
  const logger: RequestLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  it('starts healthy', () => {
    const tracker = new HealthTracker();
    expect(tracker.isHealthy).toBe(true);
    expect(tracker.failureCount).toBe(0);
  });

  it('remains healthy after 1-2 failures', () => {
    const tracker = new HealthTracker();
    tracker.recordFailure(logger);
    expect(tracker.isHealthy).toBe(true);
    tracker.recordFailure(logger);
    expect(tracker.isHealthy).toBe(true);
  });

  it('becomes unhealthy after 3 consecutive failures', () => {
    const tracker = new HealthTracker();
    tracker.recordFailure(logger);
    tracker.recordFailure(logger);
    tracker.recordFailure(logger);

    expect(tracker.isHealthy).toBe(false);
    expect(tracker.failureCount).toBe(3);
    expect(logger.log).toHaveBeenCalledWith(
      'health_state_change',
      expect.objectContaining({
        old_state: 'healthy',
        new_state: 'unhealthy',
      })
    );
  });

  it('recovers on success after being unhealthy', () => {
    const tracker = new HealthTracker();
    tracker.recordFailure(logger);
    tracker.recordFailure(logger);
    tracker.recordFailure(logger);
    expect(tracker.isHealthy).toBe(false);

    tracker.recordSuccess(logger);
    expect(tracker.isHealthy).toBe(true);
    expect(tracker.failureCount).toBe(0);
  });

  it('resets counter on success', () => {
    const tracker = new HealthTracker();
    tracker.recordFailure(logger);
    tracker.recordFailure(logger);
    tracker.recordSuccess(logger);
    tracker.recordFailure(logger);

    expect(tracker.isHealthy).toBe(true);
    expect(tracker.failureCount).toBe(1);
  });

  it('reset() restores healthy state', () => {
    const tracker = new HealthTracker();
    tracker.recordFailure(logger);
    tracker.recordFailure(logger);
    tracker.recordFailure(logger);
    tracker.reset();

    expect(tracker.isHealthy).toBe(true);
    expect(tracker.failureCount).toBe(0);
  });
});
