module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    browser: true
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  ignorePatterns: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  overrides: [
    {
      files: ["packages/dashboard/public/**/*.js"],
      env: {
        browser: true
      }
    }
  ]
};
