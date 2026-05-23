import type { ReviewIssue } from "@reviewai/shared";

/**
 * Compute a quality score between 0 and 100 based on detected review issues.
 *
 * Scoring rules:
 * - Start at 100
 * - critical security issue: -20 each (max deduction -60)
 * - critical bug: -15 each (max deduction -45)
 * - warning performance: -5 each (max deduction -20)
 * - warning smell: -3 each (max deduction -15)
 * - suggestion: -1 each (max deduction -5)
 * - Minimum score: 0
 *
 * @param issues Array of ReviewIssue objects
 * @returns Normalized score between 0 and 100
 */
export function computeScore(issues: ReviewIssue[]): number {
  const start = 100;

  const counts = {
    criticalSecurity: 0,
    criticalBug: 0,
    warningPerformance: 0,
    warningSmell: 0,
    suggestions: 0
  };

  for (const issue of issues) {
    if (issue.severity === "critical" && issue.category === "security") {
      counts.criticalSecurity += 1;
    } else if (issue.severity === "critical" && issue.category === "bug") {
      counts.criticalBug += 1;
    } else if (issue.severity === "warning" && issue.category === "performance") {
      counts.warningPerformance += 1;
    } else if (issue.severity === "warning" && issue.category === "smell") {
      counts.warningSmell += 1;
    } else if (issue.severity === "suggestion") {
      counts.suggestions += 1;
    }
  }

  const deduction =
    Math.min(counts.criticalSecurity, 3) * 20 +
    Math.min(counts.criticalBug, 3) * 15 +
    Math.min(counts.warningPerformance, 4) * 5 +
    Math.min(counts.warningSmell, 5) * 3 +
    Math.min(counts.suggestions, 5) * 1;

  const score = Math.max(0, start - deduction);
  return Math.round(score);
}

/**
 * Human friendly label for a numeric score.
 *
 * - 85-100: Excellent
 * - 70-84: Good
 * - 50-69: Needs Work
 * - 0-49: Critical
 */
export function getScoreLabel(score: number): "Excellent" | "Good" | "Needs Work" | "Critical" {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s >= 85) return "Excellent";
  if (s >= 70) return "Good";
  if (s >= 50) return "Needs Work";
  return "Critical";
}

const hex = (v: number) => v.toString(16).padStart(2, "0");

/**
 * Map a score to a hex color on a green->yellow->red gradient.
 * 100 -> green (#28a745), 50 -> yellow (#f1c40f), 0 -> red (#e74c3c)
 * @param score numeric 0-100
 */
export function getScoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, Math.round(score)));

  // interpolate between two segments: green->yellow and yellow->red
  const green = { r: 40, g: 167, b: 69 }; // #28a745
  const yellow = { r: 241, g: 196, b: 15 }; // #f1c40f
  const red = { r: 231, g: 76, b: 60 }; // #e74c3c

  let from, to, t;
  if (s >= 50) {
    from = yellow;
    to = green;
    t = (s - 50) / 50; // 0..1
  } else {
    from = red;
    to = yellow;
    t = s / 50; // 0..1
  }

  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);

  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export default {
  computeScore,
  getScoreLabel,
  getScoreColor
};
