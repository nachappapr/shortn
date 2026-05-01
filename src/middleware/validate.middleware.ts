import { NextFunction, Request, Response } from "express";
import { z, ZodObject, core } from "zod";
import { AppError } from "../errors/app.error.js";

export const validateSchema =
  (schema: ZodObject<core.$ZodShape>) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const validationErrors = err.issues.map((e) => e.message).join(", ");
        console.error("Validation Error:", validationErrors);
        return next(new AppError(validationErrors, 400, "VALIDATION_ERROR"));
      }
      next(new AppError("Internal Server Error", 500, "INTERNAL_ERROR"));
    }
  };
