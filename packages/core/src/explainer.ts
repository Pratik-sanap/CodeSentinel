import { GoogleGenerativeAI } from "@google/generative-ai";

import type { ReviewIssue } from "@reviewai/shared";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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

export async function* explainIssue(issue: ReviewIssue, codeContext: string): AsyncGenerator<string, void, void> {
  const result = await model.generateContentStream(buildPrompt(issue, codeContext));

  for await (const chunk of result.stream) {
    const chunkText = chunk.text();

    if (chunkText.length > 0) {
      yield chunkText;
    }
  }
}