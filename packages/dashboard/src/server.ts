import cors from "cors";
import express, { type Request, type Response } from "express";
import dotenv from "dotenv";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getMergeRecommendation, runFullReview, type MergeRecommendation } from "@reviewai/core";
import { createGithubRouter } from "@reviewai/github-adapter";
import { createGitlabRouter } from "@reviewai/gitlab-adapter";
import type { FileDiff, PullRequestEvent, ReviewInput, ReviewIssue, ReviewResult } from "@reviewai/shared";

interface StoredReview {
  key: string;
  createdAt: string;
  event: PullRequestEvent;
  files: FileDiff[];
  result: ReviewResult;
  mergeRecommendation: MergeRecommendation;
}

interface DemoSeedReview {
  event: PullRequestEvent;
  files: FileDiff[];
  result: ReviewResult;
}

const sanitizeDemoTitle = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const sanitizeDemoRepo = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9/_-]/g, "")
    .replace(/\/{2,}/g, "/")
    .trim();

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
  criticalIssueCount: number;
  summary: string;
}

interface ReviewStats {
  totalReviews: number;
  avgScore: number;
  issuesByCategory: Record<ReviewIssue["category"], number>;
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDirectory, "../../../.env") });
const publicDirectory = path.resolve(currentDirectory, "../public");
const reviewStore = new Map<string, StoredReview>();
let demoFeedTimer: ReturnType<typeof setInterval> | null = null;
let demoFeedCounter = 0;

const reviewKey = (event: PullRequestEvent): string => `${event.platform}:${event.repoFullName}:${event.id}`;

const saveReview = (event: PullRequestEvent, files: FileDiff[], result: ReviewResult): StoredReview => {
  const record: StoredReview = {
    key: reviewKey(event),
    createdAt: new Date().toISOString(),
    event,
    files,
    result,
    mergeRecommendation: getMergeRecommendation(result)
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
      criticalIssueCount: record.result.issues.filter((issue) => issue.severity === "critical").length,
      summary: record.result.summary
    }));

const findReviewByPrId = (prId: string): StoredReview | undefined =>
  Array.from(reviewStore.values())
    .reverse()
    .find((record) => record.result.prId === prId || record.event.id === prId || record.key === prId);

const pickCycle = <T>(values: readonly [T, ...T[]], index: number): T => values[index % values.length]!;

const createDemoSeedReviews = (): DemoSeedReview[] => {
  const seeds: DemoSeedReview[] = [
    {
      event: {
        id: "demo-101",
        title: "Harden auth token handling",
        description: "Replace hard-coded token paths and tighten validation.",
        author: "demo-bot",
        sourceBranch: "demo/auth-hardening",
        targetBranch: "main",
        platform: "github",
        diffUrl: "https://example.com/demo-101.diff",
        repoFullName: "acme/codesentinel"
      },
      files: [
        {
          filename: "src/auth.ts",
          patch: "-12: const token = process.env.API_KEY\n+12: const token = readSecret('api-key')",
          additions: 1,
          deletions: 1,
          language: "typescript",
          changes: [
            { type: "delete", oldLineNumber: 12, content: "const token = process.env.API_KEY" },
            { type: "add", newLineNumber: 12, content: "const token = readSecret('api-key')" }
          ]
        }
      ],
      result: {
        prId: "demo-101",
        summary: "Improves secret handling and reduces the risk of leaking credentials in logs.",
        issues: [
          {
            severity: "critical",
            category: "security",
            line: 12,
            message: "Credentials are still read from an environment path that can be logged or copied too easily.",
            suggestion: "Move the value behind a secret manager wrapper and avoid echoing it in debug output.",
            filename: "src/auth.ts"
          }
        ],
        score: 42,
        processingMs: 1280
      }
    },
    {
      event: {
        id: "demo-102",
        title: "Trim API payloads before sending",
        description: "Reduces network overhead for list endpoints.",
        author: "demo-bot",
        sourceBranch: "demo/api-payloads",
        targetBranch: "main",
        platform: "gitlab",
        diffUrl: "https://example.com/demo-102.diff",
        repoFullName: "acme/platform-api"
      },
      files: [
        {
          filename: "src/routes/projects.ts",
          patch: "-81: return response.json(items)\n+81: return response.json(items.slice(0, 20))",
          additions: 1,
          deletions: 1,
          language: "typescript",
          changes: [
            { type: "delete", oldLineNumber: 81, content: "return response.json(items)" },
            { type: "add", newLineNumber: 81, content: "return response.json(items.slice(0, 20))" }
          ]
        }
      ],
      result: {
        prId: "demo-102",
        summary: "A small performance improvement that lowers response size for high-traffic list views.",
        issues: [
          {
            severity: "warning",
            category: "performance",
            line: 81,
            message: "This endpoint still returns more data than most UI consumers need.",
            suggestion: "Cap the payload and add pagination metadata so clients can request more on demand.",
            filename: "src/routes/projects.ts"
          }
        ],
        score: 74,
        processingMs: 940
      }
    },
    {
      event: {
        id: "demo-103",
        title: "Refactor logging helper",
        description: "Swap noisy log formatting for a shared utility.",
        author: "demo-bot",
        sourceBranch: "demo/logging-refactor",
        targetBranch: "main",
        platform: "github",
        diffUrl: "https://example.com/demo-103.diff",
        repoFullName: "acme/codesentinel"
      },
      files: [
        {
          filename: "src/logging.ts",
          patch: "-5: console.log('debug', payload)\n+5: logger.debug({ payload })",
          additions: 1,
          deletions: 1,
          language: "typescript",
          changes: [
            { type: "delete", oldLineNumber: 5, content: "console.log('debug', payload)" },
            { type: "add", newLineNumber: 5, content: "logger.debug({ payload })" }
          ]
        }
      ],
      result: {
        prId: "demo-103",
        summary: "Clean refactor with a lower-noise logging path and no merge risk.",
        issues: [
          {
            severity: "suggestion",
            category: "style",
            line: 5,
            message: "The logger wrapper can be simplified further.",
            suggestion: "Consider extracting a shared helper for the debug payload shape.",
            filename: "src/logging.ts"
          }
        ],
        score: 88,
        processingMs: 620
      }
    },
    {
      event: {
        id: "demo-104",
        title: "Guard payment retry loop",
        description: "Prevent duplicate processing during retries.",
        author: "demo-bot",
        sourceBranch: "demo/payment-guard",
        targetBranch: "main",
        platform: "gitlab",
        diffUrl: "https://example.com/demo-104.diff",
        repoFullName: "acme/billing"
      },
      files: [
        {
          filename: "src/payments/retry.ts",
          patch: "-30: await processPayment(orderId)\n+30: if (!alreadyProcessed(orderId)) {\n+31:   await processPayment(orderId)\n+32: }",
          additions: 3,
          deletions: 1,
          language: "typescript",
          changes: [
            { type: "delete", oldLineNumber: 30, content: "await processPayment(orderId)" },
            { type: "add", newLineNumber: 30, content: "if (!alreadyProcessed(orderId)) {" },
            { type: "add", newLineNumber: 31, content: "  await processPayment(orderId)" },
            { type: "add", newLineNumber: 32, content: "}" }
          ]
        }
      ],
      result: {
        prId: "demo-104",
        summary: "Introduces a guard around payment retry handling to avoid duplicate charges.",
        issues: [
          {
            severity: "critical",
            category: "bug",
            line: 30,
            message: "Retry logic could still double-submit a payment when the guard state is stale.",
            suggestion: "Move the check and payment write into a single atomic transaction or idempotency boundary.",
            filename: "src/payments/retry.ts"
          }
        ],
        score: 53,
        processingMs: 1430
      }
    },
    {
      event: {
        id: "demo-105",
        title: "Improve cache key naming",
        description: "Clarify cache key ownership for future contributors.",
        author: "demo-bot",
        sourceBranch: "demo/cache-keys",
        targetBranch: "main",
        platform: "github",
        diffUrl: "https://example.com/demo-105.diff",
        repoFullName: "acme/platform-api"
      },
      files: [
        {
          filename: "src/cache.ts",
          patch: "-18: const key = `${userId}:${scope}`\n+18: const key = buildCacheKey(userId, scope)",
          additions: 1,
          deletions: 1,
          language: "typescript",
          changes: [
            { type: "delete", oldLineNumber: 18, content: "const key = `${userId}:${scope}`" },
            { type: "add", newLineNumber: 18, content: "const key = buildCacheKey(userId, scope)" }
          ]
        }
      ],
      result: {
        prId: "demo-105",
        summary: "A straightforward cleanup that improves readability and future maintenance.",
        issues: [
          {
            severity: "suggestion",
            category: "smell",
            line: 18,
            message: "The inline key template is a little hard to scan.",
            suggestion: "Wrap the cache key shape in a named helper so future changes stay consistent.",
            filename: "src/cache.ts"
          }
        ],
        score: 91,
        processingMs: 510
      }
    }
  ];

  return seeds;
};

const seedDemoStore = (): number => {
  const seeds = createDemoSeedReviews();

  reviewStore.clear();
  demoFeedCounter = 0;

  for (const seed of seeds) {
    saveReview(
      {
        ...seed.event,
        title: sanitizeDemoTitle(seed.event.title),
        repoFullName: sanitizeDemoRepo(seed.event.repoFullName)
      },
      seed.files,
      seed.result
    );
  }

  if (demoFeedTimer !== null) {
    clearInterval(demoFeedTimer);
  }

  demoFeedTimer = setInterval(() => {
    const index = demoFeedCounter++;
    const reviewNumber = 106 + index;
    const platform: PullRequestEvent["platform"] = index % 2 === 0 ? "github" : "gitlab";
    const scoreOptions = [47, 63, 79, 86, 92] as const;
    const titleOptions = [
      "Stabilize webhook retries",
      "Reduce bundle startup cost",
      "Tighten cache invalidation",
      "Guard file upload parsing",
      "Normalize audit event payloads"
    ] as const;
    const repoOptions = ["acme/codesentinel", "acme/platform-api", "acme/billing"] as const;
    const score = pickCycle(scoreOptions, index);
    const critical = score < 60;
    const title = sanitizeDemoTitle(pickCycle(titleOptions, index));
    const repoFullName = sanitizeDemoRepo(pickCycle(repoOptions, index));

    saveReview(
      {
        id: `demo-${reviewNumber}`,
        title,
        description: "Automatically generated live demo review.",
        author: "demo-bot",
        sourceBranch: `demo/live-${reviewNumber}`,
        targetBranch: "main",
        platform,
        diffUrl: `https://example.com/demo-${reviewNumber}.diff`,
        repoFullName
      },
      [
        {
          filename: "src/live-demo.ts",
          patch: `-${reviewNumber}: const status = 'static'\n+${reviewNumber}: const status = 'live'`,
          additions: 1,
          deletions: 1,
          language: "typescript",
          changes: [
            { type: "delete", oldLineNumber: reviewNumber, content: "const status = 'static'" },
            { type: "add", newLineNumber: reviewNumber, content: "const status = 'live'" }
          ]
        }
      ],
      {
        prId: `demo-${reviewNumber}`,
        summary: critical
          ? "Live demo review surfaced a blocking regression that needs attention."
          : "Live demo review is healthy enough to keep moving without blocking the merge.",
        issues: [
          {
            severity: critical ? "critical" : "warning",
            category: critical ? "bug" : "style",
            line: reviewNumber,
            message: critical
              ? "This live demo snapshot still shows a blocking risk that should be fixed first."
              : "This live demo snapshot looks healthy, but there is still a small cleanup to consider.",
            suggestion: critical
              ? "Resolve the gating issue before merging and rerun the review engine."
              : "Keep the implementation as-is and watch the trend for the next review.",
            filename: "src/live-demo.ts"
          }
        ],
        score,
        processingMs: 700 + index * 45
      }
    );
  }, 12_000);

  return seeds.length;
};

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
  saveReview(event, files, result);
  return result;
};

export const createApp = (): express.Express => {
  const app = express();
  const reviewEngine = buildReviewEngine();

  app.use(cors());
  app.use(morgan("dev"));
  app.use("/api", express.json({ limit: "1mb" }));

  app.use((request: Request, response: Response, next) => {
    if (request.path === "/" || request.path === "/index.html" || request.path.endsWith(".js") || request.path.endsWith(".css")) {
      response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("Expires", "0");
    }

    next();
  });

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

  app.get<{ prId: string; issueIndex: string }>("/api/reviews/:prId/explain/:issueIndex", async (req: Request, res: Response) => {
    console.log('Explain called, store size:', reviewStore.size);
    console.log('All keys:', Array.from(reviewStore.keys()).slice(0, 3));
    console.log('Raw param:', req.params.prId);

    try {
      const rawId = decodeURIComponent(String(req.params.prId));
      const index = Number.parseInt(String(req.params.issueIndex), 10);

      let stored = reviewStore.get(rawId);

      if (!stored) {
        for (const [key, value] of reviewStore.entries()) {
          if (value.result.prId === rawId || value.event.id === rawId || key.endsWith(rawId) || key.includes(rawId)) {
            stored = value;
            break;
          }
        }
      }

      if (!stored) {
        console.log("Available keys:", Array.from(reviewStore.keys()));
        console.log("Looking for:", rawId);
        return res.status(404).json({ error: "Review not found" });
      }

      const issue = stored.result.issues[index];
      if (!issue) return res.status(404).json({ error: "Issue not found" });

      const prompt = `You are a senior code reviewer. Explain this issue clearly:
Issue: ${issue.message}
File: ${issue.filename} line ${issue.line}  
Category: ${issue.category} (${issue.severity})

Explain: 1) Why this is a problem 2) Real-world impact 3) How to fix it with a code example.`;

      console.log('OPENROUTER_API_KEY present:', !!process.env.OPENROUTER_API_KEY);
      console.log('OPENROUTER_API_KEY starts with:', process.env.OPENROUTER_API_KEY?.slice(0, 10));

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "CodeSentinel"
        },
        body: JSON.stringify({
          model: "openai/gpt-3.5-turbo",
          messages: [{ role: "user", content: prompt }],
          stream: false
        })
      });

      const rawText = await response.text();
      console.log('OpenRouter raw response:', response.status, rawText.slice(0, 200));
      const data = JSON.parse(rawText);
      if (!response.ok) {
        console.error("OpenRouter error:", data);
        return res.status(500).json({ error: "AI call failed" });
      }
      res.json({ explanation: data.choices[0].message.content });
    } catch (err) {
      console.error("Explain route error:", err);
      res.status(500).json({ error: String(err) });
    }
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
      result,
      mergeRecommendation: getMergeRecommendation(result)
    });
  });

  app.post("/api/demo/seed", (_request: Request, response: Response) => {
    const seeded = seedDemoStore();
    response.json({ ok: true, seeded });
  });

  app.use(express.static(publicDirectory));

  app.get(/.*/, (_request: Request, response: Response) => {
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
