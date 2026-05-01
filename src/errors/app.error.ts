export abstract class BaseError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AppError extends BaseError {
  code: string;
  constructor(
    message: string,
    statusCode: number,
    code: string = "INTERNAL_ERROR",
  ) {
    super(message, statusCode);
    this.code = code;
  }
}
