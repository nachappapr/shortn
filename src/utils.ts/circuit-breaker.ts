import { CircuitBreakerError } from "../errors/circuit.error.js";

class CircuitBreaker {
  private state: "closed" | "open" | "half-open" = "closed";
  private failureCount = 0;
  private lastFailureTime: number = 0;
  private readonly failureThreshold: number;
  private readonly recoveryTimeout: number;
  private probeInFlight: boolean = false;

  constructor(failureThreshold: number, recoveryTimeout: number) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
  }

  private reset() {
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  private trip() {
    this.state = "open";
    this.lastFailureTime = Date.now();
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      const now = Date.now();
      if (now - this.lastFailureTime > this.recoveryTimeout) {
        this.state = "half-open";
      } else {
        throw new CircuitBreakerError(
          "Circuit is open. Please try again later.",
        );
      }
    }
    if (this.state === "half-open") {
      if (this.probeInFlight) {
        throw new CircuitBreakerError(
          "Probe in flight. Please try again later.",
        );
      }

      this.probeInFlight = true;

      try {
        const result = await fn();
        this.reset();
        return result;
      } catch (error) {
        this.trip();
        throw error;
      } finally {
        this.probeInFlight = false;
      }
    }

    try {
      const result = await fn();
      this.reset();
      return result;
    } catch (error) {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.trip();
      }
      throw error;
    }
  }
}

export default CircuitBreaker;
