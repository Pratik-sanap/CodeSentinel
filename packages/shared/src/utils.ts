import type { ReviewSeverity } from "./types.js";

export const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

export const clampRiskScore = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

export const severityWeights: Record<ReviewSeverity, number> = {
  suggestion: 5,
  warning: 15,
  critical: 30
};
