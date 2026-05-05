import { z } from "zod";

export const createUrlSchema = z.object({
  body: z.object({
    url: z.url("Invalid URL format"),
  }),
});

export const createBatchUrlSchema = z.object({
  body: z.object({
    urls: z
      .array(
        z.object({
          url: z.url("Invalid URL format"),
        }),
      )
      .min(1, "At least one URL is required")
      .max(1000, "Maximum 1000 URLs allowed"),
  }),
});

export const GetUrlSchema = z.object({
  params: z.object({
    code: z.string("Code must be a string").min(1, "Code is required"),
  }),
});

export const GetAllUrlsSchema = z.object({
  query: z.object({
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .refine((num) => !isNaN(num) && num > 0, {
        message: "Limit must be a positive integer",
      }),
    after: z.string().optional(),
  }),
});

export type CreateUrl = z.infer<typeof createUrlSchema>["body"];
export type CreateBatchUrl = z.infer<typeof createBatchUrlSchema>["body"];
export type GetUrl = z.infer<typeof GetUrlSchema>["params"];
export type GetAllUrls = z.infer<typeof GetAllUrlsSchema>["query"];
