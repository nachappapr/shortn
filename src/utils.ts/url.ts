export function getFInalCompletionStatus(
  successCount: number,
  failedCount: number,
) {
  if (failedCount === 0) {
    return "completed";
  }
  if (successCount === 0) {
    return "failed";
  }
  return "partial";
}
