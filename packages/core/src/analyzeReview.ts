import {
  clampRiskScore,
  normalizeWhitespace,
  severityWeights,
  type FileDiff,
  type ReviewInput,
  type ReviewIssue,
  type ReviewResult,
  type ReviewSeverity
} from "@reviewai/shared";

interface HeuristicRule {
  ruleId: string;
  severity: ReviewSeverity;
  category: ReviewIssue["category"];
  pattern: RegExp;
  message: string;
  suggestion: string;
}

const heuristics: HeuristicRule[] = [
  {
    ruleId: "no-console-log",
    severity: "suggestion",
    category: "style",
    pattern: /console\.log\(/,
    message: "Remove debug logging before merging.",
    suggestion: "Replace debug logs with a structured logger or remove the call entirely."
  },
  {
    ruleId: "no-todo",
    severity: "warning",
    category: "smell",
    pattern: /TODO|FIXME/,
    message: "Follow up on the TODO or FIXME before shipping.",
    suggestion: "Convert the comment into a tracked task or complete the follow-up work."
  },
  {
    ruleId: "no-eval",
    severity: "critical",
    category: "security",
    pattern: /\beval\(/,
    message: "Avoid eval because it creates a security risk.",
    suggestion: "Use a safe parser or explicit branching instead of evaluating source text."
  },
  {
    ruleId: "no-hardcoded-secret",
    severity: "critical",
    category: "security",
    pattern: /api[_-]?key|secret|token|password/i,
    message: "Move secrets out of source control.",
    suggestion: "Read the value from an environment variable or secret manager."
  }
];

const buildIssues = (file: FileDiff): ReviewIssue[] => {
  const issues: ReviewIssue[] = [];
  const lines = file.patch.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    const matchedRule = heuristics.find((rule) => rule.pattern.test(line));
    if (!matchedRule) {
      continue;
    }

    issues.push({
      severity: matchedRule.severity,
      category: matchedRule.category,
      line: index + 1,
      message: matchedRule.message,
      suggestion: matchedRule.suggestion,
      filename: file.filename
    });
  }

  return issues;
};

export function analyzeReview(input: ReviewInput): ReviewResult {
  const startedAt = Date.now();
  const issues = input.files.flatMap((file) => buildIssues(file));
  const penalty = issues.reduce((score, issue) => score + severityWeights[issue.severity], 0);
  const sizePenalty = Math.min(20, input.files.reduce((size, file) => size + file.patch.length, 0) / 200);
  const score = clampRiskScore(100 - penalty - sizePenalty);

  const summary =
    issues.length === 0
      ? `No obvious issues detected for ${input.repoFullName}.`
      : `${issues.length} review issue${issues.length === 1 ? "" : "s"} detected for ${input.repoFullName}.`;

  return {
    prId: input.id,
    summary: normalizeWhitespace(summary),
    issues,
    score,
    processingMs: Date.now() - startedAt
  };
}
