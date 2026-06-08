export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitBreakerError";
    Error.captureStackTrace(this, this.constructor);
  }
}
