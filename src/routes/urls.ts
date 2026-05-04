import { Router, type Router as ExpressRouter } from "express";
import {
  createShortUrl,
  getAllUrls,
  redirectToOriginalUrl,
} from "../controller/urls.js";
import { validateSchema } from "../middleware/validate.middleware.js";
import {
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
router.get("/urls", validateSchema(GetAllUrlsSchema), getAllUrls);
router.get("/:code", validateSchema(GetUrlSchema), redirectToOriginalUrl);

export default router;
