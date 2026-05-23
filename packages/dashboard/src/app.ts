import express, { type Request, type Response } from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeReview } from "@reviewai/core";
import { reviewGithubPayload } from "@reviewai/github-adapter";
import { reviewGitlabPayload } from "@reviewai/gitlab-adapter";
import type { ReviewInput } from "@reviewai/shared";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, "../public");

const parseReviewInput = (body: unknown): ReviewInput | undefined => {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const candidate = body as Partial<ReviewInput>;
  const firstFile = candidate.files?.[0];

  if (candidate.platform !== "github" && candidate.platform !== "gitlab") {
    return undefined;
  }

  if (
    typeof candidate.id !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.author !== "string" ||
    typeof candidate.sourceBranch !== "string" ||
    typeof candidate.targetBranch !== "string" ||
    typeof candidate.diffUrl !== "string" ||
    typeof candidate.repoFullName !== "string" ||
    typeof firstFile?.patch !== "string"
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    title: candidate.title,
    description: candidate.description,
    author: candidate.author,
    sourceBranch: candidate.sourceBranch,
    targetBranch: candidate.targetBranch,
    platform: candidate.platform,
    diffUrl: candidate.diffUrl,
    repoFullName: candidate.repoFullName,
    files: candidate.files ?? []
  };
};

export const createApp = (): express.Express => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(publicDirectory));

  app.get("/api/health", (_request: Request, response: Response) => {
    response.json({ status: "ok", service: "reviewai-dashboard" });
  });

  app.post("/api/review", (request: Request, response: Response) => {
    const reviewInput = parseReviewInput(request.body);

    if (!reviewInput) {
      response.status(400).json({ error: "Invalid review payload." });
      return;
    }

    response.json({
      input: reviewInput,
      result: analyzeReview(reviewInput)
    });
  });

  app.post("/api/webhooks/github", (request: Request, response: Response) => {
    response.json(reviewGithubPayload(request.body));
  });

  app.post("/api/webhooks/gitlab", (request: Request, response: Response) => {
    response.json(reviewGitlabPayload(request.body));
  });

  app.get("*", (_request: Request, response: Response) => {
    response.sendFile(path.join(publicDirectory, "index.html"));
  });

  return app;
};
