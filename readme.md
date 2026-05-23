# ReviewAI

ReviewAI is a TypeScript monorepo for automated pull request review. It combines a shared review engine, platform adapters for GitHub and GitLab, and a dashboard service for local testing and API access.

## What It Does

- Parses pull request diffs into structured file-level changes
- Scores code quality and risk using the shared review engine
- Supports GitHub and GitLab webhook payloads
- Exposes a small dashboard API for health checks and manual review requests
- Posts GitHub review comments and summary reviews from webhook events

## Repository Layout

- `packages/shared` - shared types and utilities used across the monorepo
- `packages/core` - diff parsing, review heuristics, scoring, and analysis orchestration
- `packages/github-adapter` - GitHub webhook handling and review publishing
- `packages/gitlab-adapter` - GitLab webhook handling and payload mapping
- `packages/dashboard` - Express dashboard server and static frontend assets

## Requirements

- Node.js 18+ recommended
- pnpm 9 via Corepack
- GitHub App or token credentials for posting review comments
- Gemini API key for the AI-powered review path in `packages/core`

## Getting Started

1. Install dependencies:

```bash
corepack pnpm install
```

2. Start the dashboard in development mode:

```bash
corepack pnpm dev
```

3. Build the full workspace:

```bash
corepack pnpm build
```

4. Run the typecheck:

```bash
corepack pnpm typecheck
```

5. Run tests:

```bash
corepack pnpm test
```

## Scripts

- `corepack pnpm build` - build all workspace packages
- `corepack pnpm dev` - run the dashboard service
- `corepack pnpm lint` - lint the repository
- `corepack pnpm test` - run the test suite
- `corepack pnpm typecheck` - run TypeScript across the workspace
- `corepack pnpm format` - format files with Prettier

## Dashboard API

The dashboard service listens on `PORT` and serves both API routes and static assets.

- `GET /api/health` - health check
- `POST /api/review` - analyze a review payload directly
- `POST /api/webhooks/github` - review a GitHub webhook payload
- `POST /api/webhooks/gitlab` - review a GitLab webhook payload

## GitHub Webhook Flow

The GitHub adapter expects a raw JSON webhook body and validates the `X-Hub-Signature-256` header using `GITHUB_APP_SECRET`.

When a `pull_request` event arrives with an action of `opened`, `synchronize`, or `reopened`, the handler:

1. Loads the changed files through the GitHub REST API
2. Converts the payload into the shared `PullRequestEvent` shape
3. Builds file diffs for the review engine
4. Runs the review engine on the diff set
5. Posts inline review comments and a summary review back to GitHub

## Environment Variables

- `PORT` - dashboard port, defaults to `3000`
- `GEMINI_API_KEY` - required for the AI review engine in `packages/core`
- `GITHUB_APP_SECRET` - required to verify GitHub webhook signatures
- `GITHUB_APP_TOKEN` - GitHub token used for posting review comments
- `GITHUB_TOKEN` - alternate GitHub token fallback
- `GITHUB_PERSONAL_ACCESS_TOKEN` - alternate GitHub token fallback

## Core Review Engine

The shared review engine focuses on diff-driven analysis. It parses added and removed lines, applies heuristic rules, computes a score, and generates a markdown summary.

The main data flow is:

1. Parse the provider payload into a `PullRequestEvent`
2. Convert changed files into `FileDiff` objects
3. Analyze each diff for issues
4. Score the result and format a human-readable summary

## Development Notes

- The workspace uses ESM and NodeNext TypeScript settings.
- The GitHub handler relies on raw request bodies for signature verification.
- The GitHub adapter uses Octokit for REST API calls and retry handling around rate limits.
- The existing tests cover diff parsing and scoring behavior in `packages/core`.

## Contributing

If you extend the review engine or add another provider, keep the provider-specific mapping in an adapter package and reuse the shared review types wherever possible.