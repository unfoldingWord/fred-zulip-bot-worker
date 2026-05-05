import type { RequestLogger } from '../../utils/logger.js';

const UNHEALTHY_THRESHOLD = 3;

export class HealthTracker {
  private consecutiveFailures = 0;
  private healthy = true;

  get isHealthy(): boolean {
    return this.healthy;
  }

  get failureCount(): number {
    return this.consecutiveFailures;
  }

  recordSuccess(logger: RequestLogger): void {
    if (!this.healthy) {
      logger.log('health_state_change', {
        old_state: 'unhealthy',
        new_state: 'healthy',
        failure_count: this.consecutiveFailures,
      });
    }
    this.consecutiveFailures = 0;
    this.healthy = true;
  }

  recordFailure(logger: RequestLogger): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= UNHEALTHY_THRESHOLD && this.healthy) {
      this.healthy = false;
      logger.log('health_state_change', {
        old_state: 'healthy',
        new_state: 'unhealthy',
        failure_count: this.consecutiveFailures,
      });
    }
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.healthy = true;
  }
}
