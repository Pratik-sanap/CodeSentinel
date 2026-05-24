import type { ReviewIssue } from "@reviewai/shared";

declare const process: { env: Record<string, string | undefined> };
declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
declare const fetch: (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
  body: unknown;
}>;
declare class TextDecoder {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "openai/gpt-3.5-turbo";

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
console.log(`OpenRouter key loaded: ${openRouterApiKey ? "YES" : "NO"}`);

interface OpenRouterStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
}

interface StreamReadResult {
  done: boolean;
  value?: Uint8Array;
}

interface StreamReader {
  read: () => Promise<StreamReadResult>;
}

interface StreamBody {
  getReader: () => StreamReader;
}

const buildPrompt = (issue: ReviewIssue, codeContext: string): string => [
  "You are CodeSentinel's explainability assistant.",
  "Explain this code review issue in a mentoring tone using the supplied code context.",
  "Use plain English with concise markdown headings.",
  "Include these sections:",
  "1. Why this is a problem and the real-world impact.",
  "2. A concrete before/after code example showing the fix.",
  "3. Relevant documentation references such as OWASP, MDN, or platform docs. Do not claim you fetched them; synthesize likely references.",
  "4. Estimated severity impact in production.",
  "Keep the answer focused, actionable, and specific to the issue.",
  "Issue:",
  `- severity: ${issue.severity}`,
  `- category: ${issue.category}`,
  `- file: ${issue.filename}`,
  `- line: ${issue.line}`,
  `- message: ${issue.message}`,
  `- suggestion: ${issue.suggestion}`,
  "Code context:",
  codeContext
].join("\n");

const buildFallbackExplanation = (issue: ReviewIssue): string => [
  "### Why this is a problem",
  issue.message,
  "",
  "### Suggested fix",
  issue.suggestion,
  "",
  "### Notes",
  "Live AI explanations are unavailable because the OpenRouter API key is not configured in this environment."
].join("\n");

export async function* explainIssue(issue: ReviewIssue, codeContext: string): AsyncGenerator<string, void, void> {
  try {
    console.log("Explaining issue:", issue.message, "context length:", codeContext.length);

    if (!openRouterApiKey) {
      yield buildFallbackExplanation(issue);
      return;
    }

    const prompt = buildPrompt(issue, codeContext);
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "CodeSentinel"
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: true
      })
    });
    console.log("OpenRouter response status:", response.status);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter stream request failed (${response.status} ${response.statusText}): ${errorBody}`);
    }

    const streamBody = response.body as unknown as StreamBody | null;

    if (!streamBody) {
      throw new Error("OpenRouter stream response body is empty.");
    }

    const reader = streamBody.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const processEventBlock = (block: string): string | null => {
      const dataLines = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());

      if (dataLines.length === 0) {
        return null;
      }

      const dataPayload = dataLines.join("\n");

      if (dataPayload === "[DONE]") {
        return "__DONE__";
      }

      let parsedChunk: OpenRouterStreamChunk;

      try {
        parsedChunk = JSON.parse(dataPayload) as OpenRouterStreamChunk;
      } catch {
        return null;
      }

      const textChunk = parsedChunk.choices?.[0]?.delta?.content;
      return typeof textChunk === "string" && textChunk.length > 0 ? textChunk : null;
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(0), { stream: !done });

      while (true) {
        const separatorIndex = buffer.indexOf("\n\n");

        if (separatorIndex === -1) {
          break;
        }

        const eventBlock = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const parsed = processEventBlock(eventBlock);

        if (parsed === "__DONE__") {
          return;
        }

        if (parsed) {
          yield parsed;
        }
      }

      if (done) {
        const trailing = processEventBlock(buffer);

        if (trailing && trailing !== "__DONE__") {
          yield trailing;
        }

        return;
      }
    }
  } catch (error) {
    console.error("explainIssue failed", {
      error,
      issueMessage: issue.message,
      issueFilename: issue.filename,
      issueLine: issue.line,
      contextLength: codeContext.length
    });
    throw error;
  }
}