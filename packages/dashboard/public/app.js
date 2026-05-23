const form = document.getElementById("review-form");
const statusText = document.getElementById("status-text");
const resultList = document.getElementById("result-list");
const riskScore = document.getElementById("risk-score");
const runDemo = document.getElementById("run-demo");

const renderEmptyState = () => {
  resultList.innerHTML = `
    <article class="result-item">
      <strong>No findings yet</strong>
      <div class="result-meta">Run the analysis to populate this panel.</div>
    </article>
  `;
  riskScore.textContent = "--";
};

const renderResults = (payload) => {
  const issues = payload?.result?.issues ?? [];
  const summary = payload?.result?.summary ?? "No summary returned.";
  const score = payload?.result?.score ?? 0;

  statusText.textContent = summary;
  riskScore.textContent = String(score);

  if (issues.length === 0) {
    resultList.innerHTML = `
      <article class="result-item">
        <strong>Clean run</strong>
        <div class="result-meta">${summary}</div>
      </article>
    `;
    return;
  }

  resultList.innerHTML = issues
    .map(
      (issue) => `
        <article class="result-item">
          <strong>${issue.message}</strong>
          <span class="badge ${issue.severity}">${issue.severity}</span>
          <div class="result-meta">
            <span>${issue.filename}</span>
            <span>Line ${issue.line}</span>
            <span>${issue.category}</span>
          </div>
          <div class="result-meta">${issue.suggestion}</div>
        </article>
      `
    )
    .join("");
};

const runAnalysis = async () => {
  const formData = new FormData(form);
  const payload = {
    id: "demo-pr-1",
    title: String(formData.get("title") ?? "Refactor API route"),
    description: "Local dashboard review demo.",
    author: "dashboard-demo",
    sourceBranch: "feature/reviewai-demo",
    targetBranch: "main",
    platform: formData.get("provider"),
    diffUrl: "https://example.com/diff/demo",
    repoFullName: String(formData.get("repository") ?? "acme/reviewai-demo"),
    files: [
      {
        filename: "src/api.ts",
        patch: String(formData.get("diff") ?? ""),
        additions: 3,
        deletions: 0,
        language: "typescript"
      }
    ]
  };

  statusText.textContent = "Analyzing diff...";

  const response = await fetch("/api/review", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  renderResults(data);
};

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void runAnalysis();
});

runDemo?.addEventListener("click", () => {
  void runAnalysis();
});

renderEmptyState();
