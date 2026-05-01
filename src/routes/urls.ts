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

const router: ExpressRouter = Router();

router.post("/shorten", validateSchema(createUrlSchema), createShortUrl);
router.get("/urls", validateSchema(GetAllUrlsSchema), getAllUrls);
router.get("/:code", validateSchema(GetUrlSchema), redirectToOriginalUrl);

export default router;
