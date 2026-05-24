import {
  clampRiskScore,
  severityWeights,
  type FileDiff,
  type PullRequestEvent,
  type ReviewIssue,
  type ReviewResult
} from "@reviewai/shared";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_NAME = "openai/gpt-3.5-turbo";
const RETRY_DELAYS_MS = [10_000, 20_000, 40_000];
const MAX_BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1_000;

const severityOrder: ReviewIssue["severity"][] = ["critical", "warning", "suggestion"];
const categoryOrder: ReviewIssue["category"][] = ["security", "performance", "bug", "smell", "style"];

type ModelIssue = Partial<ReviewIssue> & {
  line?: number | string;
  severity?: string;
  category?: string;
  message?: string;
  suggestion?: string;
  filename?: string;
};

type ModelIssuesPayload =
  | ModelIssue[]
  | {
      issues?: ModelIssue[];
      findings?: ModelIssue[];
    };

interface OpenRouterCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const getFileChangedLines = (file: FileDiff): string => {
  if (file.changes.length === 0) {
    return "No changed lines were captured for this file.";
  }

  return file.changes
    .map((change) => {
      const lineNumber = change.type === "add" ? change.newLineNumber : change.oldLineNumber;
      const marker = change.type === "add" ? "+" : "-";
      return `${marker}${lineNumber ?? 0}: ${change.content}`;
    })
    .join("\n");
};

const buildFilePrompt = (file: FileDiff): string => [
  "You are an expert code reviewer.",
  "Analyze the diff below for security vulnerabilities, performance bottlenecks, bugs, code smells, and style issues.",
  "Respond ONLY with raw JSON. No markdown. No code fences. No prose.",
  "Return an array of objects where each object matches this shape:",
  '{"severity":"critical|warning|suggestion","category":"security|performance|bug|smell|style","line":1,"message":"...","suggestion":"...","filename":"..."}',
  "If there are no issues, return an empty JSON array.",
  `Filename: ${file.filename}`,
  `Language: ${file.language}`,
  `Additions: ${file.additions}`,
  `Deletions: ${file.deletions}`,
  "Changed lines:",
  getFileChangedLines(file),
  "Unified patch snippet:",
  file.patch
].join("\n");

const buildSummaryPrompt = (issues: ReviewIssue[], pr: PullRequestEvent): string => {
  const severityBreakdown = severityOrder
    .map((severity) => `${severity}: ${issues.filter((issue) => issue.severity === severity).length}`)
    .join(", ");
  const qualityScore = calculateQualityScore(issues);
  const criticalIssues = issues.filter((issue) => issue.severity === "critical").slice(0, 3);

  return [
    "You are summarizing a pull request review.",
    "Write a concise markdown summary with these sections:",
    "- overall summary",
    "- severity breakdown",
    "- top 3 critical issues",
    "- quality score",
    "Use clear markdown headings and bullet lists.",
    `Repository: ${pr.repoFullName}`,
    `PR Title: ${pr.title}`,
    `Source Branch: ${pr.sourceBranch}`,
    `Target Branch: ${pr.targetBranch}`,
    `Issue Count: ${issues.length}`,
    `Severity Breakdown: ${severityBreakdown}`,
    `Quality Score: ${qualityScore}/100`,
    "Critical Issues:",
    criticalIssues.length === 0
      ? "None"
      : criticalIssues
          .map((issue, index) => `${index + 1}. [${issue.filename}:${issue.line}] ${issue.message} -> ${issue.suggestion}`)
          .join("\n"),
    "All Issues:",
    issues.length === 0
      ? "None"
      : issues
          .map((issue, index) => `${index + 1}. [${issue.severity}/${issue.category}] ${issue.filename}:${issue.line} - ${issue.message}`)
          .join("\n")
  ].join("\n");
};

const calculateQualityScore = (issues: ReviewIssue[]): number => {
  const penalty = issues.reduce((total, issue) => total + (severityWeights[issue.severity] ?? 0), 0);
  return clampRiskScore(100 - penalty);
};

const parseJsonPayload = (text: string): ModelIssuesPayload => {
  const trimmed = text.trim();

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const payloadText = fencedMatch?.[1] ?? trimmed;

  const firstBrace = payloadText.search(/[\[{]/);
  const lastBrace = Math.max(payloadText.lastIndexOf("}"), payloadText.lastIndexOf("]"));
  const jsonText = firstBrace >= 0 && lastBrace >= firstBrace ? payloadText.slice(firstBrace, lastBrace + 1) : payloadText;

  return JSON.parse(jsonText) as ModelIssuesPayload;
};

const normalizeSeverity = (value: unknown): ReviewIssue["severity"] => {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "critical" || normalized === "warning" || normalized === "suggestion") {
    return normalized;
  }

  return "suggestion";
};

const normalizeCategory = (value: unknown): ReviewIssue["category"] => {
  const normalized = String(value ?? "").toLowerCase();
  if (
    normalized === "security" ||
    normalized === "performance" ||
    normalized === "bug" ||
    normalized === "smell" ||
    normalized === "style"
  ) {
    return normalized;
  }

  return "smell";
};

const normalizeLineNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

const normalizeIssue = (item: ModelIssue, fallbackFile: FileDiff): ReviewIssue => {
  const lineFallback =
    fallbackFile.changes.find((change) => change.type === "add" && change.newLineNumber)
      ?.newLineNumber ?? fallbackFile.changes.find((change) => change.type === "delete" && change.oldLineNumber)?.oldLineNumber ?? 1;

  return {
    severity: normalizeSeverity(item.severity),
    category: normalizeCategory(item.category),
    line: normalizeLineNumber(item.line, lineFallback),
    message: String(item.message ?? "Potential issue detected."),
    suggestion: String(item.suggestion ?? "Review the surrounding code and apply a safer implementation."),
    filename: String(item.filename ?? fallbackFile.filename)
  };
};

const extractIssues = (payload: ModelIssuesPayload, file: FileDiff): ReviewIssue[] => {
  const candidates = Array.isArray(payload) ? payload : payload.issues ?? payload.findings ?? [];
  return candidates.map((issue) => normalizeIssue(issue, file));
};

const isRetryableRateLimitError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = Reflect.get(error as Record<string, unknown>, "status");
  const code = Reflect.get(error as Record<string, unknown>, "code");
  const message = String(Reflect.get(error as Record<string, unknown>, "message") ?? "");

  return status === 429 || code === 429 || message.includes("429") || /rate limit/i.test(message);
};

const extractCompletionContent = (payload: OpenRouterCompletionResponse): string => {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  throw new Error("OpenRouter response did not include choices[0].message.content");
};

const callOpenRouter = async (prompt: string): Promise<string> => {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing.");
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "CodeSentinel"
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [{ role: "user", content: prompt }],
      stream: false
    })
  });
  console.log("OpenRouter response status:", response.status);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter request failed (${response.status} ${response.statusText}): ${errorBody}`);
  }

  const payload = (await response.json()) as OpenRouterCompletionResponse;
  return extractCompletionContent(payload);
};

const generateWithRetry = async (prompt: string): Promise<string> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await callOpenRouter(prompt);
    } catch (error) {
      lastError = error;

      if (!isRetryableRateLimitError(error) || attempt === RETRY_DELAYS_MS.length) {
        break;
      }

      await sleep(RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 10_000);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed.");
};

export async function analyzeFileDiff(file: FileDiff): Promise<ReviewIssue[]> {
  const responseText = await generateWithRetry(buildFilePrompt(file));

  try {
    return extractIssues(parseJsonPayload(responseText), file);
  } catch (error) {
    throw new Error(`Unable to parse model JSON for ${file.filename}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function generatePRSummary(issues: ReviewIssue[], pr: PullRequestEvent): Promise<string> {
  const responseText = await generateWithRetry(buildSummaryPrompt(issues, pr));
  return responseText.trim();
}

export async function runFullReview(pr: PullRequestEvent, diffs: FileDiff[]): Promise<ReviewResult> {
  const startedAt = Date.now();
  const collectedIssues: ReviewIssue[] = [];

  for (let index = 0; index < diffs.length; index += MAX_BATCH_SIZE) {
    const batch = diffs.slice(index, index + MAX_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((file) => analyzeFileDiff(file)));

    for (const result of results) {
      if (result.status === "fulfilled") {
        collectedIssues.push(...result.value);
      }
    }

    if (index + MAX_BATCH_SIZE < diffs.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const penalty = collectedIssues.reduce((total, issue) => total + (severityWeights[issue.severity] ?? 0), 0);
  const sizePenalty = Math.min(20, diffs.reduce((total, file) => total + file.patch.length, 0) / 200);
  const score = clampRiskScore(100 - penalty - sizePenalty);
  const summary = await generatePRSummary(collectedIssues, pr);

  return {
    prId: pr.id,
    summary,
    issues: collectedIssues,
    score,
    processingMs: Date.now() - startedAt
  };
}