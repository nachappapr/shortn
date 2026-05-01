import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app.error.js";

function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        request_id: req.headers["x-request-id"] || null,
      },
    });
  }
  console.error(err.stack);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal Server Error",
      request_id: req.headers["x-request-id"] || null,
    },
  });
}

export default errorMiddleware;
