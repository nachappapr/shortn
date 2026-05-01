import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app.error.js";

function notFoundMiddleware(req: Request, res: Response, next: NextFunction) {
  next(new AppError("Not Found", 404, "ROUTE_NOT_FOUND"));
}

export default notFoundMiddleware;
