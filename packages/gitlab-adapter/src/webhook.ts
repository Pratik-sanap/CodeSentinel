import { createHmac, timingSafeEqual } from "node:crypto";

import { analyzeReview } from "@reviewai/core";
import type { PullRequestEvent, ReviewInput, WebhookContext } from "@reviewai/shared";

export interface GitlabWebhookPayload {
  object_kind?: string;
  project?: {
    path_with_namespace?: string;
  };
  object_attributes?: {
    iid?: number | string;
    title?: string;
    description?: string;
    source_branch?: string;
    target_branch?: string;
    url?: string;
    diff?: string;
  };
  user?: {
    username?: string;
  };
}

const buildEvent = (payload: GitlabWebhookPayload): PullRequestEvent => ({
  id: String(payload.object_attributes?.iid ?? "unknown-gitlab-pr"),
  title: payload.object_attributes?.title ?? "Untitled merge request",
  description: payload.object_attributes?.description ?? "",
  author: payload.user?.username ?? "unknown",
  sourceBranch: payload.object_attributes?.source_branch ?? "unknown",
  targetBranch: payload.object_attributes?.target_branch ?? "main",
  platform: "gitlab",
  diffUrl: payload.object_attributes?.url ?? "",
  repoFullName: payload.project?.path_with_namespace ?? "unknown/gitlab-repository"
});

export const verifyGitlabSignature = (
  secret: string,
  body: string,
  tokenHeader: string | undefined
): boolean => {
  if (!tokenHeader) {
    return false;
  }

  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"));
  const received = Buffer.from(tokenHeader);

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
};

export const buildGitlabReviewInput = (payload: GitlabWebhookPayload): ReviewInput => ({
  ...buildEvent(payload),
  files: [
    {
      filename: "unknown",
      patch: payload.object_attributes?.diff ?? "",
      additions: 0,
      deletions: 0,
      language: "unknown",
      changes: []
    }
  ]
});

export const createGitlabWebhookContext = (payload: GitlabWebhookPayload): WebhookContext => ({
  platform: "gitlab",
  eventName: payload.object_kind ?? "unknown",
  event: buildEvent(payload),
  raw: payload
});

export const reviewGitlabPayload = (payload: GitlabWebhookPayload) => {
  const reviewInput = buildGitlabReviewInput(payload);
  const context = createGitlabWebhookContext(payload);

  return {
    context,
    result: analyzeReview(reviewInput)
  };
};
