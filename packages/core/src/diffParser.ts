import type { DiffLine, FileDiff } from "@reviewai/shared";

interface WorkingFileDiff {
  filename: string;
  patchLines: string[];
  additions: number;
  deletions: number;
  language: string;
  changes: DiffLine[];
  skipped: boolean;
  inHunk: boolean;
  oldLineNumber: number;
  newLineNumber: number;
}

const lockFileNames = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-lock.yml",
  "bun.lockb",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock"
]);

const generatedPathPatterns: RegExp[] = [
  /(^|\/)(dist|build|out|coverage|generated|gen|__generated__)(\/|$)/i,
  /\.generated\.[^.\/]+$/i,
  /\.gen\.[^.\/]+$/i,
  /\.min\.[^.\/]+$/i,
  /\.map$/i
];

const languageByExtension: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  java: "java",
  rb: "ruby",
  rs: "rust",
  php: "php",
  cs: "csharp",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  c: "c",
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  scala: "scala",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  xml: "xml",
  dart: "dart",
  lua: "lua",
  r: "r",
  jl: "julia",
  hs: "haskell",
  ex: "elixir",
  exs: "elixir",
  clj: "clojure",
  cljs: "clojure"
};

const diffHeaderPattern = /^diff --git a\/(.+?) b\/(.+)$/;
const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const stripDiffPrefix = (value: string): string => value.replace(/^"|"$/g, "").replace(/^[ab]\//, "");

const detectLanguage = (filename: string): string => {
  const normalizedName = filename.toLowerCase();

  if (normalizedName === "dockerfile") {
    return "dockerfile";
  }

  if (normalizedName === "makefile") {
    return "makefile";
  }

  const extension = normalizedName.includes(".") ? normalizedName.split(".").pop() : "";
  return extension ? languageByExtension[extension] ?? "plaintext" : "plaintext";
};

const isGeneratedFile = (filename: string): boolean => {
  const normalized = filename.toLowerCase();
  if (lockFileNames.has(normalized)) {
    return true;
  }

  return generatedPathPatterns.some((pattern) => pattern.test(normalized));
};

const formatLine = (change: DiffLine): string => {
  const lineNumber = change.type === "add" ? change.newLineNumber : change.oldLineNumber;
  const prefix = change.type === "add" ? "+" : "-";
  return `${prefix}${lineNumber ?? 0}: ${change.content}`;
};

const createWorkingFile = (filename: string): WorkingFileDiff => ({
  filename,
  patchLines: [],
  additions: 0,
  deletions: 0,
  language: detectLanguage(filename),
  changes: [],
  skipped: isGeneratedFile(filename),
  inHunk: false,
  oldLineNumber: 0,
  newLineNumber: 0
});

const finalizeWorkingFile = (file: WorkingFileDiff | null, output: FileDiff[]): void => {
  if (!file || file.skipped || file.changes.length === 0) {
    return;
  }

  output.push({
    filename: file.filename,
    patch: file.patchLines.join("\n"),
    additions: file.additions,
    deletions: file.deletions,
    language: file.language,
    changes: file.changes
  });
};

const parseHunkHeader = (line: string): { oldStart: number; newStart: number } => {
  const match = hunkHeaderPattern.exec(line);
  if (!match) {
    throw new Error(`Malformed diff hunk header: ${line}`);
  }

  return {
    oldStart: Number.parseInt(match[1] ?? "0", 10),
    newStart: Number.parseInt(match[3] ?? "0", 10)
  };
};

export function parseDiff(rawDiff: string): FileDiff[] {
  if (rawDiff.trim().length === 0) {
    return [];
  }

  const lines = rawDiff.replace(/\r\n/g, "\n").split("\n");
  const files: FileDiff[] = [];
  let currentFile: WorkingFileDiff | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      finalizeWorkingFile(currentFile, files);

      const headerMatch = diffHeaderPattern.exec(line);
      if (!headerMatch) {
        throw new Error(`Malformed diff header: ${line}`);
      }

      const filename = stripDiffPrefix(headerMatch[2] ?? headerMatch[1] ?? "");
      if (!filename) {
        throw new Error(`Malformed diff header: ${line}`);
      }

      currentFile = createWorkingFile(filename);
      continue;
    }

    if (!currentFile) {
      if (line.trim().length === 0) {
        continue;
      }

      throw new Error("Malformed diff: missing file header");
    }

    if (currentFile.skipped) {
      continue;
    }

    if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      currentFile.skipped = true;
      currentFile.patchLines = [];
      currentFile.changes = [];
      continue;
    }

    if (line.startsWith("rename to ")) {
      const renamedFile = stripDiffPrefix(line.slice("rename to ".length).trim());
      currentFile.filename = renamedFile;
      currentFile.language = detectLanguage(renamedFile);
      currentFile.skipped = isGeneratedFile(renamedFile);
      continue;
    }

    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ") || line.startsWith("new file mode ") || line.startsWith("deleted file mode ") || line.startsWith("similarity index ") || line.startsWith("rename from ")) {
      continue;
    }

    if (line.startsWith("@@ ")) {
      const { oldStart, newStart } = parseHunkHeader(line);
      currentFile.inHunk = true;
      currentFile.oldLineNumber = oldStart;
      currentFile.newLineNumber = newStart;
      continue;
    }

    if (line === "\\ No newline at end of file") {
      continue;
    }

    if (!currentFile.inHunk) {
      if (line.trim().length === 0) {
        continue;
      }

      throw new Error(`Malformed diff: unexpected content before hunk in ${currentFile.filename}`);
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const content = line.slice(1);
      const change: DiffLine = {
        type: "add",
        newLineNumber: currentFile.newLineNumber,
        content
      };
      currentFile.changes.push(change);
      currentFile.patchLines.push(formatLine(change));
      currentFile.additions += 1;
      currentFile.newLineNumber += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      const content = line.slice(1);
      const change: DiffLine = {
        type: "delete",
        oldLineNumber: currentFile.oldLineNumber,
        content
      };
      currentFile.changes.push(change);
      currentFile.patchLines.push(formatLine(change));
      currentFile.deletions += 1;
      currentFile.oldLineNumber += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      currentFile.oldLineNumber += 1;
      currentFile.newLineNumber += 1;
      continue;
    }

    throw new Error(`Malformed diff content in ${currentFile.filename}: ${line}`);
  }

  finalizeWorkingFile(currentFile, files);

  return files;
}