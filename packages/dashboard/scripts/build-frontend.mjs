import { build, context } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..");
const isWatchMode = process.argv.includes("--watch");

const buildOptions = {
  absWorkingDir: projectRoot,
  entryPoints: ["src/frontend/main.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  jsxImportSource: "react",
  outfile: "public/app.js",
  sourcemap: true,
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  loader: {
    ".ts": "ts",
    ".tsx": "tsx"
  },
  logLevel: "info"
};

if (isWatchMode) {
  const buildContext = await context(buildOptions);
  await buildContext.watch();
  console.log("Watching dashboard frontend bundle...");
} else {
  await build(buildOptions);
}