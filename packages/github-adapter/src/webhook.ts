import { createHmac, timingSafeEqual } from "node:crypto";

import { analyzeReview } from "@reviewai/core";
import type { PullRequestEvent, ReviewInput, WebhookContext, WebhookPayload } from "@reviewai/shared";

export interface GithubWebhookPayload {
  action?: string;
  repository?: {
    full_name?: string;
  };
  pull_request?: {
    id?: number | string;
    title?: string;
    body?: string;
    head?: {
      ref?: string;
    };
    base?: {
      ref?: string;
    };
    html_url?: string;
    user?: {
      login?: string;
    };
    diff?: string;
  };
}

const buildEvent = (payload: GithubWebhookPayload): PullRequestEvent => ({
  id: String(payload.pull_request?.id ?? "unknown-github-pr"),
  title: payload.pull_request?.title ?? "Untitled pull request",
  description: payload.pull_request?.body ?? "",
  author: payload.pull_request?.user?.login ?? "unknown",
  sourceBranch: payload.pull_request?.head?.ref ?? "unknown",
  targetBranch: payload.pull_request?.base?.ref ?? "main",
  platform: "github",
  diffUrl: payload.pull_request?.html_url ?? "",
  repoFullName: payload.repository?.full_name ?? "unknown/github-repository"
});

export interface GithubWebhookEnvelope extends WebhookPayload<PullRequestEvent, GithubWebhookPayload> {
  input: ReviewInput;
}

export const verifyGithubSignature = (
  secret: string,
  body: string,
  signatureHeader: string | undefined
): boolean => {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"));
  const received = Buffer.from(signatureHeader.slice("sha256=".length));

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
};

export const buildGithubReviewInput = (payload: GithubWebhookPayload): ReviewInput => ({
  ...buildEvent(payload),
  files: [
    {
      filename: "unknown",
      patch: payload.pull_request?.diff ?? "",
      additions: 0,
      deletions: 0,
      language: "unknown",
      changes: []
    }
  ]
});

export const createGithubWebhookContext = (payload: GithubWebhookPayload): WebhookContext => ({
  platform: "github",
  eventName: payload.action ?? "unknown",
  event: buildEvent(payload),
  raw: payload
});

export const reviewGithubPayload = (payload: GithubWebhookPayload) => {
  const reviewInput = buildGithubReviewInput(payload);
  const context = createGithubWebhookContext(payload);

  return {
    context,
    result: analyzeReview(reviewInput)
  };
};
