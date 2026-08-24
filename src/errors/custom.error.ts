export class CustomError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.message = message;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}
