// Pure: does a status change need the submission review first (FR-7.2)? No DB or UI imports.
// Yes only when the column is the status column, the NEW option counts as submitted (6.1), it differs from the current one, and the
// application has no submission yet. Anything else saves directly: a further submission is a manual one (6.6), and moving backward
// never touches submissions (FR-7.8).
export function needsSubmissionReview(o: { isStatus: boolean; optionId: number | null; currentOptionId: number | null; submittedIds: number[]; submissionCount: number }): boolean {
  return o.isStatus && o.optionId !== null && o.optionId !== o.currentOptionId && o.submissionCount === 0 && o.submittedIds.includes(o.optionId);
}

export const NEEDS_REVIEW_ERROR = "This status needs a submission review first. Choose it again to review the files.";
