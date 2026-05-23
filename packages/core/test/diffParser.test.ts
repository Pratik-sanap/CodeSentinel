import { describe, expect, it } from "vitest";

import { parseDiff } from "../src/diffParser.js";

describe("parseDiff", () => {
  it("parses file diffs, language, and changed lines with line numbers", () => {
    const result = parseDiff([
      "diff --git a/src/example.ts b/src/example.ts",
      "index 1111111..2222222 100644",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,4 +1,5 @@",
      " const keep = true",
      "-console.log('old')",
      "+console.log('new')",
      "+const added = 1",
      " return keep"
    ].join("\n"));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filename: "src/example.ts",
      language: "typescript",
      additions: 2,
      deletions: 1,
      patch: "-2: console.log('old')\n+2: console.log('new')\n+3: const added = 1"
    });
    expect(result[0]?.changes).toEqual([
      { type: "delete", oldLineNumber: 2, content: "console.log('old')" },
      { type: "add", newLineNumber: 2, content: "console.log('new')" },
      { type: "add", newLineNumber: 3, content: "const added = 1" }
    ]);
  });

  it("filters binary, lock, and generated files", () => {
    const result = parseDiff([
      "diff --git a/package-lock.json b/package-lock.json",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@ -1 +1 @@",
      "-{",
      "+{",
      "diff --git a/assets/image.png b/assets/image.png",
      "Binary files a/assets/image.png and b/assets/image.png differ",
      "diff --git a/dist/generated.js b/dist/generated.js",
      "--- a/dist/generated.js",
      "+++ b/dist/generated.js",
      "@@ -1 +1 @@",
      "-const a = 1",
      "+const a = 2",
      "diff --git a/src/real.py b/src/real.py",
      "--- a/src/real.py",
      "+++ b/src/real.py",
      "@@ -1 +1 @@",
      "-print('old')",
      "+print('new')"
    ].join("\n"));

    expect(result).toHaveLength(1);
    expect(result[0]?.filename).toBe("src/real.py");
    expect(result[0]?.language).toBe("python");
  });

  it("throws on malformed diffs", () => {
    expect(() => parseDiff("@@ -1 +1 @@\n+missing file header")).toThrow(/missing file header/i);
  });
});