import { createHmac, timingSafeEqual } from "node:crypto";

import axios, { AxiosError, type AxiosInstance } from "axios";
import express, { type Request, type Response, Router } from "express";

import { parseDiff } from "@reviewai/core";
import type { FileDiff, PullRequestEvent, ReviewIssue, ReviewResult } from "@reviewai/shared";

type ReviewEngine = (event: PullRequestEvent, files: FileDiff[]) => Promise<ReviewResult> | ReviewResult;

interface GitLabUser {
  name?: string;
  username?: string;
}

interface GitLabProject {
  id?: number | string;
  path_with_namespace?: string;
  name?: string;
  namespace?: string;
  web_url?: string;
}

interface GitLabMergeRequest {
  iid?: number | string;
  title?: string;
  description?: string;
  state?: string;
  action?: string;
  source_branch?: string;
  target_branch?: string;
  web_url?: string;
  diff_refs?: {
    base_sha?: string;
    head_sha?: string;
    start_sha?: string;
  };
  author?: GitLabUser;
  last_commit?: {
    id?: string;
  };
}

interface GitLabDiffEntry {
  old_path?: string;
  new_path?: string;
  diff?: string;
  renamed_file?: boolean;
  deleted_file?: boolean;
  new_file?: boolean;
}

interface GitLabWebhookPayload {
  object_kind?: string;
  project?: GitLabProject;
  merge_request?: GitLabMergeRequest;
  user?: GitLabUser;
}

interface GitLabReviewPosition {
  position_type: "text";
  base_sha: string;
  start_sha: string;
  head_sha: string;
  old_path?: string;
  new_path?: string;
  old_line?: number;
  new_line?: number;
}

interface GitLabDiscussionNote {
  body: string;
  position: GitLabReviewPosition;
}

interface GitLabFileReviewData {
  diff: FileDiff;
  newPath: string;
}

const allowedActions = new Set(["open", "opened", "update"]);
const retryDelaysMs = [1_000, 2_000, 4_000];
const defaultApiBaseUrl = "https://gitlab.com/api/v4";
const perPage = 100;

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const getGitlabSecret = (): string => {
  const secret = process.env.GITLAB_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("GITLAB_WEBHOOK_SECRET is not configured.");
  }

  return secret;
};

const getGitlabApiToken = (): string | undefined =>
  process.env.GITLAB_API_TOKEN?.trim() || process.env.GITLAB_ACCESS_TOKEN?.trim() || process.env.GITLAB_PERSONAL_ACCESS_TOKEN?.trim();

const getGitlabApiBaseUrl = (): string => process.env.GITLAB_API_BASE_URL?.trim() || defaultApiBaseUrl;

const verifyGitlabToken = (secret: string, tokenHeader: string | undefined): boolean => {
  if (!tokenHeader) {
    return false;
  }

  const expected = Buffer.from(secret, "utf8");
  const received = Buffer.from(tokenHeader, "utf8");

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
};

const isRetryableGitlabError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const axiosError = error as Partial<AxiosError> & { response?: { status?: number; headers?: Record<string, unknown> } };
  const status = axiosError.response?.status ?? 0;
  const headers = axiosError.response?.headers ?? {};
  const retryAfter = headers["retry-after"];
  const remaining = headers["ratelimit-remaining"] ?? headers["x-ratelimit-remaining"];
  const message = String((error as { message?: string }).message ?? "");

  return (
    status === 429 ||
    status === 403 ||
    String(retryAfter ?? "") !== "" ||
    String(remaining ?? "") === "0" ||
    /rate limit/i.test(message)
  );
};

const getRetryDelayMs = (error: unknown, attempt: number): number => {
  if (error && typeof error === "object") {
    const axiosError = error as Partial<AxiosError> & { response?: { headers?: Record<string, unknown> } };
    const headers = axiosError.response?.headers ?? {};
    const retryAfter = headers["retry-after"];

    if (typeof retryAfter === "string") {
      const parsed = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed * 1_000;
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

      if (!isRetryableGitlabError(error) || attempt === retryDelaysMs.length) {
        break;
      }

      await sleep(getRetryDelayMs(error, attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("GitLab request failed.");
};

const createGitlabClient = (): AxiosInstance => {
  const token = getGitlabApiToken();
  const config = token
    ? {
        baseURL: getGitlabApiBaseUrl(),
        headers: {
          "PRIVATE-TOKEN": token
        }
      }
    : {
        baseURL: getGitlabApiBaseUrl()
      };

  return axios.create(config);
};

const buildRepoFullName = (project: GitLabProject | undefined): string => {
  if (project?.path_with_namespace) {
    return project.path_with_namespace;
  }

  if (project?.namespace && project?.name) {
    return `${project.namespace}/${project.name}`;
  }

  return "unknown/gitlab-repository";
};

const buildPullRequestEvent = (payload: GitLabWebhookPayload): PullRequestEvent => {
  const mergeRequest = payload.merge_request;

  return {
    id: String(mergeRequest?.iid ?? "unknown-gitlab-mr"),
    title: mergeRequest?.title ?? "Untitled merge request",
    description: mergeRequest?.description ?? "",
    author: mergeRequest?.author?.username ?? mergeRequest?.author?.name ?? payload.user?.username ?? "unknown",
    sourceBranch: mergeRequest?.source_branch ?? "unknown",
    targetBranch: mergeRequest?.target_branch ?? "main",
    platform: "gitlab",
    diffUrl: mergeRequest?.web_url ?? "",
    repoFullName: buildRepoFullName(payload.project)
  };
};

const buildSyntheticDiff = (entry: GitLabDiffEntry): string => {
  const oldPath = entry.old_path ?? entry.new_path ?? "unknown-file";
  const newPath = entry.new_path ?? entry.old_path ?? "unknown-file";

  return [
    `diff --git a/${oldPath} b/${newPath}`,
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
    (entry.diff ?? "").trimEnd()
  ].join("\n");
};

const toFileDiff = (entry: GitLabDiffEntry): FileDiff | null => {
  const patch = entry.diff?.trim();
  if (!patch) {
    return null;
  }

  const parsed = parseDiff(buildSyntheticDiff(entry));
  const diff = parsed[0];
  if (!diff) {
    return null;
  }

  return diff;
};

const fetchMergeRequestDiffs = async (
  client: AxiosInstance,
  projectId: number | string,
  mergeRequestIid: number | string
): Promise<GitLabDiffEntry[]> => {
  const diffs: GitLabDiffEntry[] = [];
  let page = 1;

  for (;;) {
    const response = await withRetry(() =>
      client.get<GitLabDiffEntry[]>(`/projects/${encodeURIComponent(String(projectId))}/merge_requests/${encodeURIComponent(String(mergeRequestIid))}/diffs`, {
        params: {
          per_page: perPage,
          page
        }
      })
    );

    diffs.push(...response.data);

    const nextPage = String(response.headers["x-next-page"] ?? "");
    if (nextPage) {
      page = Number.parseInt(nextPage, 10);
      if (!Number.isFinite(page) || page <= 0) {
        break;
      }
      continue;
    }

    if (response.data.length < perPage) {
      break;
    }

    page += 1;
  }

  return diffs;
};

const buildSummaryBody = (result: ReviewResult): string => {
  const counts = result.issues.reduce(
    (accumulator, issue) => {
      accumulator[issue.severity] += 1;
      return accumulator;
    },
    {
      critical: 0,
      warning: 0,
      suggestion: 0
    }
  );

  const issueRows =
    result.issues.length === 0
      ? "No issues were detected."
      : [
          "| Severity | Category | File | Line | Message |",
          "| --- | --- | --- | ---: | --- |",
          ...result.issues.map(
            (issue: ReviewIssue) =>
              `| ${issue.severity} | ${issue.category} | ${issue.filename} | ${issue.line} | ${issue.message.replace(/\|/g, "\\|")} |`
          )
        ].join("\n");

  return [
    `### Review Score: ${result.score}/100`,
    "",
    result.summary,
    "",
    "#### Breakdown",
    `- Critical: ${counts.critical}`,
    `- Warning: ${counts.warning}`,
    `- Suggestion: ${counts.suggestion}`,
    "",
    "#### Issue Table",
    issueRows
  ].join("\n");
};

const buildDiscussionNotes = (
  reviewFiles: GitLabFileReviewData[],
  issues: ReviewIssue[],
  mergeRequest: GitLabMergeRequest
): GitLabDiscussionNote[] => {
  const diffRefs = mergeRequest.diff_refs;
  if (!diffRefs?.base_sha || !diffRefs.head_sha || !diffRefs.start_sha) {
    return [];
  }

  const notes: GitLabDiscussionNote[] = [];

  for (const issue of issues) {
    const file = reviewFiles.find((candidate) => candidate.diff.filename === issue.filename);
    if (!file) {
      continue;
    }

    const change = file.diff.changes[issue.line - 1];
    if (!change?.newLineNumber) {
      continue;
    }

    notes.push({
      body: `**${issue.severity.toUpperCase()}** ${issue.message}\n\n${issue.suggestion}`,
      position: {
        position_type: "text",
        base_sha: diffRefs.base_sha,
        start_sha: diffRefs.start_sha,
        head_sha: diffRefs.head_sha,
        old_path: file.diff.filename,
        new_path: file.newPath,
        new_line: change.newLineNumber
      }
    });
  }

  return notes;
};

const postDiscussionNotes = async (
  client: AxiosInstance,
  projectId: number | string,
  mergeRequestIid: number | string,
  notes: GitLabDiscussionNote[]
): Promise<void> => {
  for (const note of notes) {
    await withRetry(() =>
      client.post(`/projects/${encodeURIComponent(String(projectId))}/merge_requests/${encodeURIComponent(String(mergeRequestIid))}/discussions`, note)
    );
  }
};

const postSummaryNote = async (
  client: AxiosInstance,
  projectId: number | string,
  mergeRequestIid: number | string,
  body: string
): Promise<void> => {
  await withRetry(() =>
    client.post(`/projects/${encodeURIComponent(String(projectId))}/merge_requests/${encodeURIComponent(String(mergeRequestIid))}/notes`, {
      body
    })
  );
};

const normalizeAction = (payload: GitLabWebhookPayload): string =>
  payload.merge_request?.action ?? payload.merge_request?.state ?? payload.object_kind ?? "unknown";

export const createGitlabRouter = (reviewEngine: ReviewEngine): Router => {
  const router = Router();
  const client = createGitlabClient();

  router.post("/webhooks/gitlab", express.json({ limit: "2mb" }), async (request: Request, response: Response) => {
    try {
      const tokenHeader = request.header("x-gitlab-token");
      if (!verifyGitlabToken(getGitlabSecret(), tokenHeader)) {
        response.status(401).json({ error: "Invalid GitLab webhook token." });
        return;
      }

      const payload = request.body as GitLabWebhookPayload;
      if (!payload || typeof payload !== "object") {
        response.status(400).json({ error: "Invalid GitLab webhook payload." });
        return;
      }

      if (payload.object_kind !== "merge_request") {
        response.status(200).json({ ignored: true, reason: "Unsupported GitLab event." });
        return;
      }

      const action = normalizeAction(payload).toLowerCase();
      if (!allowedActions.has(action)) {
        response.status(200).json({ ignored: true, action });
        return;
      }

      const mergeRequest = payload.merge_request;
      const project = payload.project;

      if (!mergeRequest?.iid || !project?.id) {
        response.status(400).json({ error: "Missing merge request or project identifiers." });
        return;
      }

      const pullEvent = buildPullRequestEvent(payload);
      const diffEntries = await fetchMergeRequestDiffs(client, project.id, mergeRequest.iid);
      const reviewFiles = diffEntries
        .map((entry) => {
          const diff = toFileDiff(entry);
          if (!diff) {
            return null;
          }

          return {
            diff,
            newPath: entry.new_path ?? entry.old_path ?? diff.filename
          } satisfies GitLabFileReviewData;
        })
        .filter((item): item is GitLabFileReviewData => item !== null);

      const files = reviewFiles.map((item) => item.diff);
      const reviewResult = await reviewEngine(pullEvent, files);
      const notes = buildDiscussionNotes(reviewFiles, reviewResult.issues, mergeRequest);

      if (notes.length > 0) {
        await postDiscussionNotes(client, project.id, mergeRequest.iid, notes);
      }

      await postSummaryNote(client, project.id, mergeRequest.iid, buildSummaryBody(reviewResult));

      response.status(200).json({
        ok: true,
        reviewId: reviewResult.prId,
        issues: reviewResult.issues.length,
        score: reviewResult.score,
        summary: reviewResult.summary
      });
    } catch (error) {
      console.error("GitLab webhook review failed:", error);
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unable to process GitLab webhook."
      });
    }
  });

  return router;
};