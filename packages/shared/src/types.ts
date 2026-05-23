/**
 * Describes a pull request or merge request that is being reviewed.
 */
export interface PullRequestEvent {
  /** Unique identifier for the pull request or merge request. */
  id: string;
  /** Title shown in the code hosting platform UI. */
  title: string;
  /** Human-readable description or body text for the request. */
  description: string;
  /** Display name or handle of the author who opened the request. */
  author: string;
  /** Branch the changes originate from. */
  sourceBranch: string;
  /** Branch the changes will be merged into. */
  targetBranch: string;
  /** Hosting platform that emitted the event. */
  platform: "github" | "gitlab";
  /** URL pointing to the diff or patch representation. */
  diffUrl: string;
  /** Fully qualified repository name, such as owner/repo. */
  repoFullName: string;
}

/**
 * Represents a single added or removed line captured from a diff hunk.
 */
export interface DiffLine {
  /** Whether the line was added or removed in the diff. */
  type: "add" | "delete";
  /** One-based line number from the original file, when the line was removed. */
  oldLineNumber?: number;
  /** One-based line number from the updated file, when the line was added. */
  newLineNumber?: number;
  /** Content of the changed line without the leading diff marker. */
  content: string;
}

/**
 * Represents a single file-level diff captured from a pull request event.
 */
export interface FileDiff {
  /** File name or path relative to the repository root. */
  filename: string;
  /** Normalized patch snippet containing only changed lines. */
  patch: string;
  /** Number of added lines in the file diff. */
  additions: number;
  /** Number of removed lines in the file diff. */
  deletions: number;
  /** Best-effort language identifier for the file. */
  language: string;
  /** Structured list of added and removed lines with line numbers. */
  changes: DiffLine[];
}

/**
 * Represents a single issue found during automated review.
 */
export interface ReviewIssue {
  /** Severity assigned by the review engine. */
  severity: "critical" | "warning" | "suggestion";
  /** Logical category for the issue. */
  category: "security" | "performance" | "bug" | "smell" | "style";
  /** One-based line number where the issue was detected. */
  line: number;
  /** Human-readable explanation of the issue. */
  message: string;
  /** Suggested fix or remediation guidance. */
  suggestion: string;
  /** File that contains the issue. */
  filename: string;
}

/**
 * Final result returned by the review engine.
 */
export interface ReviewResult {
  /** Identifier of the pull request that was reviewed. */
  prId: string;
  /** Short summary of the overall review outcome. */
  summary: string;
  /** Structured issues discovered during analysis. */
  issues: ReviewIssue[];
  /** Normalized review score from 0 to 100. */
  score: number;
  /** Total time spent processing the review in milliseconds. */
  processingMs: number;
}

/**
 * Generic webhook payload wrapper used by platform adapters.
 */
export interface WebhookPayload<TEvent, TRaw = unknown> {
  /** Hosting platform that produced the webhook. */
  platform: PullRequestEvent["platform"];
  /** Event name or action reported by the provider. */
  eventName: string;
  /** Optional delivery identifier supplied by the provider. */
  deliveryId?: string;
  /** Parsed pull request event emitted by the adapter. */
  event: TEvent;
  /** Original provider payload for logging or signature validation. */
  raw: TRaw;
}

export type ReviewProvider = PullRequestEvent["platform"];
export type ReviewSeverity = ReviewIssue["severity"];

export type ReviewInput = PullRequestEvent & {
  files: FileDiff[];
};

export type ReviewFinding = ReviewIssue;

export type WebhookContext = WebhookPayload<PullRequestEvent>;
