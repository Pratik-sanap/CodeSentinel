import "dotenv/config";

import cors from "cors";
import express, { type Request, type Response } from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runFullReview } from "@reviewai/core";
import { createGithubRouter } from "@reviewai/github-adapter";
import { createGitlabRouter } from "@reviewai/gitlab-adapter";
import type { FileDiff, PullRequestEvent, ReviewInput, ReviewIssue, ReviewResult } from "@reviewai/shared";

interface StoredReview {
  key: string;
  createdAt: string;
  event: PullRequestEvent;
  result: ReviewResult;
}

interface ReviewListItem {
  key: string;
  createdAt: string;
  prId: string;
  platform: PullRequestEvent["platform"];
  repoFullName: string;
  title: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  score: number;
  issueCount: number;
  summary: string;
}

interface ReviewStats {
  totalReviews: number;
  avgScore: number;
  issuesByCategory: Record<ReviewIssue["category"], number>;
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, "../public");
const reviewStore = new Map<string, StoredReview>();

const reviewKey = (event: PullRequestEvent): string => `${event.platform}:${event.repoFullName}:${event.id}`;

const saveReview = (event: PullRequestEvent, result: ReviewResult): StoredReview => {
  const record: StoredReview = {
    key: reviewKey(event),
    createdAt: new Date().toISOString(),
    event,
    result
  };

  reviewStore.delete(record.key);
  reviewStore.set(record.key, record);
  return record;
};

const listRecentReviews = (): ReviewListItem[] =>
  Array.from(reviewStore.values())
    .slice(-50)
    .reverse()
    .map((record) => ({
      key: record.key,
      createdAt: record.createdAt,
      prId: record.result.prId,
      platform: record.event.platform,
      repoFullName: record.event.repoFullName,
      title: record.event.title,
      author: record.event.author,
      sourceBranch: record.event.sourceBranch,
      targetBranch: record.event.targetBranch,
      score: record.result.score,
      issueCount: record.result.issues.length,
      summary: record.result.summary
    }));

const findReviewByPrId = (prId: string): StoredReview | undefined =>
  Array.from(reviewStore.values())
    .reverse()
    .find((record) => record.result.prId === prId || record.event.id === prId);

const createStats = (): ReviewStats => {
  const issuesByCategory: ReviewStats["issuesByCategory"] = {
    security: 0,
    performance: 0,
    bug: 0,
    smell: 0,
    style: 0
  };

  const reviews = Array.from(reviewStore.values());
  let totalScore = 0;

  for (const record of reviews) {
    totalScore += record.result.score;

    for (const issue of record.result.issues) {
      issuesByCategory[issue.category] += 1;
    }
  }

  return {
    totalReviews: reviews.length,
    avgScore: reviews.length === 0 ? 0 : Number((totalScore / reviews.length).toFixed(1)),
    issuesByCategory
  };
};

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
    !Array.isArray(candidate.files) ||
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
    files: candidate.files
  };
};

const buildReviewEngine = () => async (event: PullRequestEvent, files: FileDiff[]): Promise<ReviewResult> => {
  const result = await runFullReview(event, files);
  saveReview(event, result);
  return result;
};

export const createApp = (): express.Express => {
  const app = express();
  const reviewEngine = buildReviewEngine();

  app.use(cors());
  app.use(morgan("dev"));
  app.use("/api", express.json({ limit: "1mb" }));

  app.use("/webhooks/github", express.raw({ type: "application/json", limit: "2mb" }), createGithubRouter(reviewEngine));
  app.use("/webhooks/gitlab", express.json({ type: "application/json", limit: "2mb" }), createGitlabRouter(reviewEngine));

  app.get("/health", (_request: Request, response: Response) => {
    response.json({ status: "ok", service: "reviewai-dashboard" });
  });

  app.get("/api/reviews", (_request: Request, response: Response) => {
    response.json({ reviews: listRecentReviews() });
  });

  app.get<{ prId: string }>("/api/reviews/:prId", (request: Request, response: Response) => {
    const prId = Array.isArray(request.params.prId) ? request.params.prId[0] : request.params.prId;

    if (typeof prId !== "string") {
      response.status(400).json({ error: "Invalid review id." });
      return;
    }

    const review = findReviewByPrId(prId);

    if (!review) {
      response.status(404).json({ error: "Review not found." });
      return;
    }

    response.json(review);
  });

  app.get("/api/stats", (_request: Request, response: Response) => {
    response.json(createStats());
  });

  app.post("/api/review", async (request: Request, response: Response) => {
    const reviewInput = parseReviewInput(request.body);

    if (!reviewInput) {
      response.status(400).json({ error: "Invalid review payload." });
      return;
    }

    const result = await reviewEngine(reviewInput, reviewInput.files);

    response.json({
      input: reviewInput,
      result
    });
  });

  app.use(express.static(publicDirectory));

  app.get("*", (_request: Request, response: Response) => {
    response.sendFile(path.join(publicDirectory, "index.html"));
  });

  return app;
};

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp();

app.listen(port, host, () => {
  console.log(`ReviewAI dashboard listening on http://localhost:${port}`);
});
