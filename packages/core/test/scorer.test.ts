import { describe, expect, it } from "vitest";
import { computeScore, getScoreLabel, getScoreColor } from "../src/scorer.js";
import type { ReviewIssue } from "@reviewai/shared";

describe("scorer.computeScore", () => {
  it("applies deductions and caps correctly", () => {
    const issues: ReviewIssue[] = [];

    // 2 critical security = -40
    issues.push({ severity: "critical", category: "security", line: 1, message: "", suggestion: "", filename: "a" });
    issues.push({ severity: "critical", category: "security", line: 2, message: "", suggestion: "", filename: "a" });

    // 4 warning performance = -20 (cap at 4)
    for (let i = 0; i < 4; i++) {
      issues.push({ severity: "warning", category: "performance", line: 10 + i, message: "", suggestion: "", filename: "b" });
    }

    // 6 suggestions -> capped at -5
    for (let i = 0; i < 6; i++) {
      issues.push({ severity: "suggestion", category: "style", line: 20 + i, message: "", suggestion: "", filename: "c" });
    }

    const score = computeScore(issues);
    // start 100 -40 -20 -5 = 35
    expect(score).toBe(35);
  });

  it("never goes below zero", () => {
    const issues: ReviewIssue[] = [];
    // 10 critical security = -200 but capped to -60
    for (let i = 0; i < 10; i++) {
      issues.push({ severity: "critical", category: "security", line: i + 1, message: "", suggestion: "", filename: "d" });
    }

    const score = computeScore(issues);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe("scorer.labels and colors", () => {
  it("returns expected labels", () => {
    expect(getScoreLabel(95)).toBe("Excellent");
    expect(getScoreLabel(75)).toBe("Good");
    expect(getScoreLabel(60)).toBe("Needs Work");
    expect(getScoreLabel(40)).toBe("Critical");
  });

  it("returns hex colors", () => {
    expect(getScoreColor(100)).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(getScoreColor(50)).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(getScoreColor(0)).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
