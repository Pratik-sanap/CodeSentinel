import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Octokit } from "@octokit/rest";

import { getMergeRecommendation, parseDiff } from "@reviewai/core";
import type { FileDiff, PullRequestEvent, ReviewIssue, ReviewResult } from "@reviewai/shared";

type ReviewEngine = (event: PullRequestEvent, files: FileDiff[]) => Promise<ReviewResult> | ReviewResult;

interface GitHubUser {
  login?: string;
}

interface GitHubRepository {
  full_name?: string;
  owner?: GitHubUser;
  name?: string;
}

interface GitHubPullRequest {
  number?: number;
  id?: number | string;
  title?: string;
  body?: string;
  html_url?: string;
  diff_url?: string;
  head?: {
    ref?: string;
    sha?: string;
  };
  base?: {
    ref?: string;
  };
  user?: GitHubUser;
}

interface GitHubPullRequestWebhookPayload {
  action?: string;
  repository?: GitHubRepository;
  pull_request?: GitHubPullRequest;
}

interface GitHubPullRequestFile {
  filename: string;
  patch?: string | null;
  additions?: number;
  deletions?: number;
  status?: string;
  previous_filename?: string;
}

interface GitHubReviewComment {
  path: string;
  position: number;
  body: string;
}

const allowedPullRequestActions = new Set(["opened", "synchronize", "reopened"]);
const signatureHeaderName = "x-hub-signature-256";
const githubEventHeaderName = "x-github-event";
const githubDeliveryHeaderName = "x-github-delivery";
const filesPageSize = 100;
const retryDelaysMs = [1_000, 2_000, 4_000];

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const getGithubSecret = (): string => {
  const secret = process.env.GITHUB_APP_SECRET?.trim();
  if (!secret) {
    throw new Error("GITHUB_APP_SECRET is not configured.");
  }

  return secret;
};

const getGithubAuthToken = (): string | undefined =>
  process.env.GITHUB_APP_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim();

const verifyGithubSignature = (secret: string, body: Buffer, signatureHeader: string | undefined): boolean => {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const receivedSignature = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const expectedSignature = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"), "hex");

  if (receivedSignature.length !== expectedSignature.length) {
    return false;
  }

  return timingSafeEqual(expectedSignature, receivedSignature);
};

const isRetryableRateLimitError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = Reflect.get(error as Record<string, unknown>, "status");
  const message = String(Reflect.get(error as Record<string, unknown>, "message") ?? "");
  const headers = Reflect.get(error as Record<string, unknown>, "response") as { headers?: Record<string, unknown> } | undefined;
  const retryAfter = headers?.headers?.["retry-after"];
  const rateLimitRemaining = headers?.headers?.["x-ratelimit-remaining"];

  return (
    status === 429 ||
    status === 403 ||
    message.toLowerCase().includes("rate limit") ||
    message.includes("secondary rate limit") ||
    retryAfter !== undefined ||
    rateLimitRemaining === 0
  );
};

const getRetryDelayMs = (error: unknown, attempt: number): number => {
  if (error && typeof error === "object") {
    const response = Reflect.get(error as Record<string, unknown>, "response") as { headers?: Record<string, unknown> } | undefined;
    const headers = response?.headers;
    const retryAfter = headers?.["retry-after"];
    const rateLimitReset = headers?.["x-ratelimit-reset"];

    if (typeof retryAfter === "string") {
      const parsedRetryAfter = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0) {
        return parsedRetryAfter * 1_000;
      }
    }

    if (typeof rateLimitReset === "string") {
      const parsedReset = Number.parseInt(rateLimitReset, 10);
      if (Number.isFinite(parsedReset) && parsedReset > 0) {
        return Math.max(1_000, parsedReset * 1_000 - Date.now() + 1_000);
      }
    }
  }

  return retryDelaysMs[attempt] ?? retryDelaysMs[retryDelaysMs.length - 1] ?? 1_000;
};

const withRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableRateLimitError(error) || attempt === retryDelaysMs.length) {
        break;
      }

      await sleep(getRetryDelayMs(error, attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("GitHub request failed.");
};

const buildRepoFullName = (repository: GitHubRepository | undefined): string => {
  if (repository?.full_name) {
    return repository.full_name;
  }

  const owner = repository?.owner?.login;
  const name = repository?.name;

  if (owner && name) {
    return `${owner}/${name}`;
  }

  return "unknown/github-repository";
};

const buildPullRequestEvent = (payload: GitHubPullRequestWebhookPayload): PullRequestEvent => ({
  id: String(payload.pull_request?.number ?? payload.pull_request?.id ?? "unknown-github-pr"),
  title: payload.pull_request?.title ?? "Untitled pull request",
  description: payload.pull_request?.body ?? "",
  author: payload.pull_request?.user?.login ?? "unknown",
  sourceBranch: payload.pull_request?.head?.ref ?? "unknown",
  targetBranch: payload.pull_request?.base?.ref ?? "main",
  platform: "github",
  diffUrl: payload.pull_request?.diff_url ?? payload.pull_request?.html_url ?? "",
  repoFullName: buildRepoFullName(payload.repository)
});

const buildSyntheticDiff = (filename: string, patch: string): string => [
  `diff --git a/${filename} b/${filename}`,
  `--- a/${filename}`,
  `+++ b/${filename}`,
  patch.trimEnd()
].join("\n");

const buildDiffPositionMap = (patch: string): number[] => {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const positions: number[] = [];
  let inHunk = false;
  let currentPosition = 0;

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line === "\\ No newline at end of file") {
      continue;
    }

    currentPosition += 1;

    if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) {
      positions.push(currentPosition);
    }
  }

  return positions;
};

const toFileDiff = (file: GitHubPullRequestFile): { diff: FileDiff; positions: number[] } => {
  const patch = file.patch?.trim();

  if (!patch) {
    return {
      diff: {
        filename: file.filename,
        patch: "",
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
        language: "plaintext",
        changes: []
      },
      positions: []
    };
  }

  const parsed = parseDiff(buildSyntheticDiff(file.filename, patch));
  const diff =
    parsed[0] ??
    ({
      filename: file.filename,
      patch: patch.replace(/\r\n/g, "\n"),
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      language: "plaintext",
      changes: []
    } satisfies FileDiff);

  return {
    diff,
    positions: buildDiffPositionMap(patch)
  };
};

const fetchPullRequestFiles = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<GitHubPullRequestFile[]> => {
  const files: GitHubPullRequestFile[] = [];

  for (let page = 1; ; page += 1) {
    const response = (await withRetry(() =>
      octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: filesPageSize,
        page
      })
    )) as { data: GitHubPullRequestFile[] };

    const pageFiles = response.data as GitHubPullRequestFile[];
    files.push(...pageFiles);

    if (pageFiles.length < filesPageSize) {
      break;
    }
  }

  return files;
};

const getScoreBadge = (score: number): string => {
  if (score >= 85) {
    return "brightgreen";
  }

  if (score >= 70) {
    return "green";
  }

  if (score >= 50) {
    return "yellow";
  }

  return "red";
};

const escapeMarkdown = (value: string): string => value.replace(/\|/g, "\\|").replace(/\n/g, " ");

const buildSummaryBody = (result: ReviewResult): string => {
  const issues = result.issues;
  const summaryLines = [
    "## Automated Review",
    `![Review score](https://img.shields.io/badge/review-${encodeURIComponent(`${result.score}/100`)}-${getScoreBadge(result.score)})`,
    "",
    `**Score:** ${result.score}/100`,
    `**Summary:** ${result.summary}`,
    `**Issues found:** ${issues.length}`,
    "",
    "### Issue Table",
    issues.length === 0
      ? "No issues were detected."
      : [
          "| Severity | Category | File | Line | Message |",
          "| --- | --- | --- | ---: | --- |",
          ...issues.map(
            (issue: ReviewIssue) =>
              `| ${escapeMarkdown(issue.severity)} | ${escapeMarkdown(issue.category)} | ${escapeMarkdown(issue.filename)} | ${issue.line} | ${escapeMarkdown(issue.message)} |`
          )
        ].join("\n"),
    "",
    "### Markdown Summary",
    result.summary
  ];

  return summaryLines.join("\n");
};

const buildReviewComments = (
  files: Array<{ diff: FileDiff; positions: number[] }>,
  issues: ReviewIssue[]
): GitHubReviewComment[] => {
  const comments: GitHubReviewComment[] = [];

  for (const issue of issues) {
    const file = files.find((candidate) => candidate.diff.filename === issue.filename);
    if (!file) {
      continue;
    }

    const changeIndex = issue.line - 1;
    const commentPosition = file.positions[changeIndex];
    const change = file.diff.changes[changeIndex];

    if (!commentPosition || !change || change.type !== "add") {
      continue;
    }

    comments.push({
      path: file.diff.filename,
      position: commentPosition,
      body: `**${issue.severity.toUpperCase()}** ${issue.message}\n\n${issue.suggestion}`
    });
  }

  return comments;
};

const createGithubClient = (): Octokit => new Octokit({ auth: getGithubAuthToken() });

const mapReviewEvent = (verdict: ReturnType<typeof getMergeRecommendation>["verdict"]): "APPROVE" | "REQUEST_CHANGES" =>
  verdict === "approve" || verdict === "approve-with-changes" ? "APPROVE" : "REQUEST_CHANGES";

export const createGithubRouter = (reviewEngine: ReviewEngine): Router => {
  const router = Router();
  const octokit = createGithubClient();

  router.post("/", async (request: Request, response: Response) => {
      try {
        const body = request.body;

        if (!Buffer.isBuffer(body)) {
          response.status(400).json({ error: "GitHub webhook body must be sent as raw JSON." });
          return;
        }

        let payload: GitHubPullRequestWebhookPayload;
        try {
          payload = JSON.parse(body.toString("utf8")) as GitHubPullRequestWebhookPayload;
        } catch {
          response.status(400).json({ error: "Invalid GitHub webhook payload." });
          return;
        }

        const secret = getGithubSecret();
        const signatureHeader = request.header(signatureHeaderName);

        if (!verifyGithubSignature(secret, body, signatureHeader)) {
          response.status(401).json({ error: "Invalid GitHub webhook signature." });
          return;
        }

        const eventName = request.header(githubEventHeaderName);
        if (eventName !== "pull_request") {
          response.status(200).json({ ignored: true, reason: "Unsupported GitHub event." });
          return;
        }

        const action = payload.action;
        if (!action || !allowedPullRequestActions.has(action)) {
          response.status(200).json({ ignored: true, action: action ?? "unknown" });
          return;
        }

        const pullRequest = payload.pull_request;
        const repository = payload.repository;

        if (!pullRequest?.number || !repository) {
          response.status(400).json({ error: "Missing pull request or repository data." });
          return;
        }

        const owner = repository.owner?.login ?? repository.full_name?.split("/")[0];
        const repo = repository.name ?? repository.full_name?.split("/")[1];

        if (!owner || !repo) {
          response.status(400).json({ error: "Unable to resolve repository owner and name." });
          return;
        }

        const pullNumber = pullRequest.number;
        const pullEvent = buildPullRequestEvent(payload);
        const fileResults = await fetchPullRequestFiles(octokit, owner, repo, pullNumber);
        const diffs = fileResults.map(toFileDiff);
        const reviewInputFiles = diffs.map((item) => item.diff);
        const reviewResult = await reviewEngine(pullEvent, reviewInputFiles);
        const mergeRecommendation = getMergeRecommendation(reviewResult);
        const comments = buildReviewComments(diffs, reviewResult.issues);

        const reviewRequest = {
          owner,
          repo,
          pull_number: pullNumber,
          event: mapReviewEvent(mergeRecommendation.verdict),
          body: buildSummaryBody(reviewResult),
          comments,
          ...(pullRequest.head?.sha ? { commit_id: pullRequest.head.sha } : {})
        };

        await withRetry(() => octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", reviewRequest));

        response.status(200).json({
          ok: true,
          reviewId: reviewResult.prId,
          issues: reviewResult.issues.length,
          score: reviewResult.score,
          summary: reviewResult.summary,
          mergeRecommendation,
          deliveryId: request.header(githubDeliveryHeaderName) ?? undefined
        });
      } catch (error) {
        console.error("GitHub webhook review failed:", error);
        response.status(500).json({
          error: error instanceof Error ? error.message : "Unable to process GitHub webhook."
        });
      }
  });

  return router;
};