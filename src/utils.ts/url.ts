export function getFinalCompletionStatus(
  successCount: number,
  failedCount: number,
  pendingCount: number,
): "completed" | "partial" | "failed" {
  const notDelivered = failedCount + pendingCount;

  if (notDelivered === 0) return "completed"; // every item has a result
  if (successCount === 0) return "failed"; // nothing was ever delivered
  return "partial"; // some delivered, some not
}
