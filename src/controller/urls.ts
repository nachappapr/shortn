import { NextFunction, Request, Response } from "express";
import { DatabaseError } from "pg";
import { AppError } from "../errors/app.error.js";
import {
  CreateBatchUrl,
  CreateUrl,
  GetAllUrls,
  GetBatchJobStatus,
  GetUrl,
  UpdateUrlBody,
  UpdateUrlParams,
} from "../schema/urls.js";
import {
  createBatchInsertJob,
  fetchAllUrls,
  fetchBatchJobStatus,
  fetchOriginalUrl,
  modifyShortUrl,
  processBatchInsertJob,
  saveShortUrl,
} from "../services/urls.js";
import { logger } from "../utils.ts/logger.js";

export async function createShortUrl(
  req: Request<Record<string, string>, unknown, CreateUrl>,
  res: Response,
  next: NextFunction,
) {
  const { url } = req.body;

  try {
    const result = await saveShortUrl(url);

    if (!result?.code) {
      return next(
        new AppError("Failed to shorten URL", 500, "SHORTENING_FAILED"),
      );
    }
    res.status(201).json({
      shorten_url: new URL(`/${result.code}`, process.env.PUBLIC_BASE_URL).href,
    });
  } catch (err) {
    console.error("Error inserting URL:", err);
    next(new AppError("Internal Server Error", 500, "INTERNAL_ERROR"));
  }
}

export async function createBatchShortUrl(
  req: Request<Record<string, string>, unknown, CreateBatchUrl>,
  res: Response,
  next: NextFunction,
) {
  const { urls, webhookUrl } = req.body;

  try {
    const jobId = await createBatchInsertJob(webhookUrl);
    processBatchInsertJob(
      jobId,
      urls.map((u) => u.url),
      webhookUrl,
    ).catch((err) => {
      console.error("Error processing batch insert job:", err);
    });
    res.status(202).json({ jobId });
  } catch (err) {
    console.error("Error inserting URLs:", err);
    next(new AppError("Internal Server Error", 500, "INTERNAL_ERROR"));
  }
}

export async function redirectToOriginalUrl(
  req: Request<GetUrl, unknown, unknown, unknown>,
  res: Response,
  next: NextFunction,
) {
  const { code } = req.params;
  try {
    const result = await fetchOriginalUrl(code);
    if (!result.result) {
      return next(new AppError("URL not found", 404, "NOT_FOUND"));
    }

    if (result.error_type === "CACHE_RETRIEVAL_FAILED") {
      return next(
        new AppError(
          "Failed to retrieve URL from cache",
          503,
          "CACHE_RETRIEVAL_FAILED",
        ),
      );
    }
    if (result.error_type === "SERVICE_UNAVAILABLE") {
      return next(
        new AppError("Service unavailable", 503, "SERVICE_UNAVAILABLE"),
      );
    }
    res.status(302).redirect(result.result);
  } catch (err) {
    console.error("Error retrieving URL:", err);
    next(new AppError("Internal Server Error", 500, "INTERNAL_ERROR"));
  }
}

export async function getAllUrls(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { limit = 20, after } = req.query as unknown as GetAllUrls;
  try {
    const result = await fetchAllUrls(limit, after);
    res.status(200).json(result);
  } catch (err) {
    logger("Error fetching all URLs:", { error: err });
    next(new AppError("Internal Server Error", 500, "INTERNAL_ERROR"));
  }
}

export async function getBatchJobStatus(
  req: Request<GetBatchJobStatus, unknown, unknown, unknown>,
  res: Response,
  next: NextFunction,
) {
  const { jobId } = req.params;
  try {
    const result = await fetchBatchJobStatus(jobId);
    res.status(200).json(result);
  } catch (err) {
    logger("Error fetching batch job status:", { error: err });
    if (err instanceof DatabaseError && err.code === "22P02") {
      return next(new AppError("Invalid job ID format", 400, "INVALID_JOB_ID"));
    }

    if (err instanceof AppError && err.code === "BATCH_JOB_NOT_FOUND") {
      return next(
        new AppError("Batch job not found", 404, "BATCH_JOB_NOT_FOUND"),
      );
    }

    logger("Error fetching batch job status:", { error: err });
    next(new AppError("Internal Server Error", 500, "INTERNAL_ERROR"));
  }
}

export async function updateShortUrl(
  req: Request<UpdateUrlParams, unknown, UpdateUrlBody>,
  res: Response,
  next: NextFunction,
) {
  const { url } = req.body;
  const { code } = req.params;

  try {
    const result = await modifyShortUrl(url, code);

    if (!result?.code) {
      return next(new AppError("Failed to update URL", 500, "UPDATING_FAILED"));
    }
    res.status(200).json({
      shorten_url: new URL(`/${result.code}`, process.env.PUBLIC_BASE_URL).href,
    });
  } catch (err) {
    console.error("Error updating URL:", err);
    next(new AppError("Internal Server Error", 500, "INTERNAL_ERROR"));
  }
}
