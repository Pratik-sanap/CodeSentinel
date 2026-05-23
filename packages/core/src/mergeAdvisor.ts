import type { ReviewIssue, ReviewResult } from "@reviewai/shared";

export interface MergeRecommendation {
  verdict: "approve" | "approve-with-changes" | "request-changes" | "block";
  confidence: number;
  blockers: string[];
  quickWins: string[];
  riskAreas: string[];
}

const unique = (values: string[]): string[] => [...new Set(values.filter((value) => value.trim().length > 0))];

const formatIssue = (issue: ReviewIssue): string => `${issue.filename}:${issue.line} - ${issue.message}`;

const getConfidence = (verdict: MergeRecommendation["verdict"], result: ReviewResult, issues: ReviewIssue[]): number => {
  const score = Math.max(0, Math.min(100, Math.round(result.score)));

  if (verdict === "block") {
    return Math.max(85, score);
  }

  if (verdict === "request-changes") {
    return Math.max(70, 100 - score);
  }

  if (verdict === "approve-with-changes") {
    return Math.max(65, Math.min(90, score + Math.min(issues.length, 10)));
  }

  return Math.min(98, Math.max(82, score + 5));
};

export function getMergeRecommendation(result: ReviewResult): MergeRecommendation {
  const issues = result.issues;
  const criticalSecurityIssues = issues.filter((issue) => issue.severity === "critical" && issue.category === "security");
  const criticalBugIssues = issues.filter((issue) => issue.severity === "critical" && issue.category === "bug");
  const score = Math.max(0, Math.min(100, Math.round(result.score)));

  const verdict: MergeRecommendation["verdict"] = criticalSecurityIssues.length > 0
    ? "block"
    : criticalBugIssues.length > 0 || score < 60
      ? "request-changes"
      : score > 80
        ? "approve"
        : "approve-with-changes";

  const blockers = unique([
    ...criticalSecurityIssues.map(formatIssue),
    ...(verdict === "request-changes" ? criticalBugIssues.map(formatIssue) : [])
  ]);

  const quickWins = unique(
    issues
      .filter((issue) => issue.severity === "suggestion" || (issue.severity === "warning" && issue.category === "style"))
      .slice(0, 5)
      .map((issue) => `${issue.filename}:${issue.line} - ${issue.suggestion}`)
  );

  const riskAreas = unique(
    issues
      .filter((issue) => issue.severity === "critical" || issue.severity === "warning")
      .map((issue) => `${issue.category} in ${issue.filename}`)
  );

  return {
    verdict,
    confidence: getConfidence(verdict, result, issues),
    blockers,
    quickWins,
    riskAreas
  };
}