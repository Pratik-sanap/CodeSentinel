import { describe, expect, it } from "vitest";

import { getMergeRecommendation } from "../src/mergeAdvisor.js";
import type { ReviewResult } from "@reviewai/shared";

const buildResult = (score: number, issues: ReviewResult["issues"]): ReviewResult => ({
  prId: "pr-1",
  summary: "summary",
  issues,
  score,
  processingMs: 100
});

describe("mergeAdvisor.getMergeRecommendation", () => {
  it("blocks critical security issues", () => {
    const recommendation = getMergeRecommendation(
      buildResult(92, [
        { severity: "critical", category: "security", line: 10, message: "secret exposed", suggestion: "remove it", filename: "src/a.ts" }
      ])
    );

    expect(recommendation.verdict).toBe("block");
    expect(recommendation.blockers).toHaveLength(1);
  });

  it("requests changes for low scores", () => {
    const recommendation = getMergeRecommendation(
      buildResult(58, [
        { severity: "warning", category: "bug", line: 12, message: "bug risk", suggestion: "fix it", filename: "src/b.ts" }
      ])
    );

    expect(recommendation.verdict).toBe("request-changes");
  });

  it("approves clean high-scoring reviews", () => {
    const recommendation = getMergeRecommendation(buildResult(92, []));

    expect(recommendation.verdict).toBe("approve");
    expect(recommendation.confidence).toBeGreaterThan(80);
  });
});