import express, { Router, type Router as ExpressRouter } from "express";
import {
  createBatchShortUrl,
  createShortUrl,
  getAllUrls,
  redirectToOriginalUrl,
} from "../controller/urls.js";
import { validateSchema } from "../middleware/validate.middleware.js";
import {
  createBatchUrlSchema,
  createUrlSchema,
  GetAllUrlsSchema,
  GetUrlSchema,
} from "../schema/urls.js";
import { idempotencyMiddleware } from "../middleware/idempotency.middleware.js";

const router: ExpressRouter = Router();

router.post(
  "/shorten",
  validateSchema(createUrlSchema),
  idempotencyMiddleware,
  createShortUrl,
);

router.post(
  "/shorten/batch",
  express.json({ limit: "10mb" }), // Adjust the limit as needed
  validateSchema(createBatchUrlSchema),
  createBatchShortUrl,
);

router.get("/urls", validateSchema(GetAllUrlsSchema), getAllUrls);
router.get("/:code", validateSchema(GetUrlSchema), redirectToOriginalUrl);

export default router;
