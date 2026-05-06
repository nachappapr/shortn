export interface SaveShortUrlApi {
  code: string;
  original_url: string;
}

export interface BulkJobResultRow {
  jobid: string;
  status: string;
  original_url: string;
  urlstatus: string;
  error: string | null;
  shortenedurl: string | null;
}

export type BatchJobStatusApi = {
  jobId: string;
  status: string;
  successCount: number;
  failedCount: number;
  results: {
    shortenedUrl: string | null;
    originalUrl: string;
    status: string;
    error: string | null;
  }[];
};
