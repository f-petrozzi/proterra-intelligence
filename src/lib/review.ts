import { createHash } from "node:crypto";

export function fallbackStoryReviewId(canonicalUrl: string) {
  return `story-${createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16)}`;
}

export function reviewAnchor(issueDate: string, storyReviewId: string, fieldPath: string) {
  return `${issueDate}:${storyReviewId}:${fieldPath}`;
}

export function reviewAttributes(input: {
  issueDate: string;
  storyReviewId: string;
  fieldPath: string;
  label: string;
}) {
  return {
    "data-review-anchor": reviewAnchor(input.issueDate, input.storyReviewId, input.fieldPath),
    "data-story-review-id": input.storyReviewId,
    "data-review-field-path": input.fieldPath,
    "data-review-label": input.label
  };
}

