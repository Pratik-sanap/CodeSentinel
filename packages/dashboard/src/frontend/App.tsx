import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type Platform = "github" | "gitlab";

interface ReviewListItem {
  key: string;
  createdAt: string;
  prId: string;
  platform: Platform;
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

interface ReviewIssue {
  severity: "critical" | "warning" | "suggestion";
  category: "security" | "performance" | "bug" | "smell" | "style";
  line: number;
  message: string;
  suggestion: string;
  filename: string;
}

interface ReviewDetailResponse {
  key: string;
  createdAt: string;
  event: ReviewListItem;
  result: {
    prId: string;
    summary: string;
    issues: ReviewIssue[];
    score: number;
    processingMs: number;
  };
  mergeRecommendation: {
    verdict: "approve" | "approve-with-changes" | "request-changes" | "block";
    confidence: number;
    blockers: string[];
    quickWins: string[];
    riskAreas: string[];
  };
}

interface ReviewsResponse {
  reviews: ReviewListItem[];
}

interface ScoreTone {
  label: string;
  ring: string;
  fill: string;
  text: string;
  surface: string;
}

const scoreTone = (score: number): ScoreTone => {
  if (score > 80) {
    return {
      label: "Healthy",
      ring: "#22c55e",
      fill: "rgba(34, 197, 94, 0.18)",
      text: "text-emerald-300",
      surface: "from-emerald-500/20 via-emerald-400/10 to-transparent"
    };
  }

  if (score >= 60) {
    return {
      label: "Watch",
      ring: "#f59e0b",
      fill: "rgba(245, 158, 11, 0.18)",
      text: "text-amber-300",
      surface: "from-amber-500/20 via-amber-400/10 to-transparent"
    };
  }

  return {
    label: "Risky",
    ring: "#ef4444",
    fill: "rgba(239, 68, 68, 0.18)",
    text: "text-rose-300",
    surface: "from-rose-500/20 via-rose-400/10 to-transparent"
  };
};

const platformTone: Record<Platform, { label: string; accent: string; bg: string; border: string }> = {
  github: {
    label: "GitHub",
    accent: "text-sky-200",
    bg: "bg-sky-500/10",
    border: "border-sky-400/20"
  },
  gitlab: {
    label: "GitLab",
    accent: "text-orange-200",
    bg: "bg-orange-500/10",
    border: "border-orange-400/20"
  }
};

const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const formatTimeAgo = (value: string): string => {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "just now";
  }

  const diffMs = Date.now() - timestamp;

  if (diffMs < 60_000) {
    return "just now";
  }

  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
};

const fetchReviews = async (signal?: AbortSignal): Promise<ReviewsResponse> => {
  const response = await fetch("/api/reviews", signal ? { signal } : undefined);

  if (!response.ok) {
    throw new Error(`Unable to load reviews (${response.status})`);
  }

  return (await response.json()) as ReviewsResponse;
};

const GitHubMark = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="currentColor">
    <path d="M12 2C6.5 2 2 6.5 2 12c0 4.4 2.9 8.1 6.9 9.5.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.4-1-.9-1.3-.9-1.3-.8-.5.1-.5.1-.5.9.1 1.3.9 1.3.9.8 1.3 2.1.9 2.6.7.1-.6.3-1 .5-1.2-2.2-.3-4.5-1.1-4.5-4.8 0-1 .4-1.9 1-2.6-.1-.3-.4-1.2.1-2.5 0 0 .8-.2 2.6 1 1.6-.4 3.3-.4 4.9 0 1.8-1.2 2.6-1 2.6-1 .5 1.3.2 2.2.1 2.5.6.7 1 1.6 1 2.6 0 3.7-2.3 4.4-4.5 4.7.3.3.5.8.5 1.6v2.4c0 .3.2.6.7.5 4-1.4 6.9-5.1 6.9-9.5 0-5.5-4.5-10-10-10Z" />
  </svg>
);

const GitLabMark = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="currentColor">
    <path d="m22 14.1-.5-1.5-2.2-6.8a.7.7 0 0 0-.7-.5.7.7 0 0 0-.7.5l-1.5 4.6H7.6L6.1 5.8a.7.7 0 0 0-1.4 0L2.5 12.6 2 14.1a.8.8 0 0 0 .3.8l9.6 7.2a.7.7 0 0 0 .9 0l9.6-7.2a.8.8 0 0 0 .3-.8Zm-10 6.4-7.9-5.9.3-1 1.8-5.5 1.8 5.4a.7.7 0 0 0 .7.5h10.8a.7.7 0 0 0 .7-.5l1.8-5.4 1.8 5.5.3 1-7.9 5.9Z" />
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="currentColor">
    <path d="M12 2 4 5.5V11c0 5.2 3.7 9.9 8 11 4.3-1.1 8-5.8 8-11V5.5L12 2Zm0 17.9c-2.9-.9-6-4.5-6-8.9V7.1L12 4.4l6 2.7V11c0 4.4-3.1 8-6 8.9Zm-1-4.9 5-5-1.4-1.4L11 13.7l-1.6-1.6L8 13.5l3 3 6-6L15.6 9l-4.6 5.1Z" />
  </svg>
);

const LogoMark = () => (
  <svg viewBox="0 0 40 40" className="h-11 w-11 shrink-0" aria-hidden="true">
    <defs>
      <linearGradient id="codesentinel-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="55%" stopColor="#34d399" />
        <stop offset="100%" stopColor="#f59e0b" />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="34" height="34" rx="12" fill="rgba(15, 23, 42, 0.85)" stroke="url(#codesentinel-gradient)" />
    <path
      d="M12 23c4.2-1 6.8-4.2 8-9 1.2 4.8 3.8 8 8 9-4.2 1-6.8 4.2-8 9-1.2-4.8-3.8-8-8-9Z"
      fill="url(#codesentinel-gradient)"
      opacity="0.95"
    />
    <circle cx="20" cy="20" r="3" fill="#e2e8f0" />
  </svg>
);

interface GaugeProps {
  score: number;
  size?: number;
  compact?: boolean;
}

const ScoreGauge = ({ score, size = 92, compact = false }: GaugeProps) => {
  const tone = scoreTone(score);
  const strokeWidth = compact ? 7 : 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-label={`Quality score ${score} out of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 drop-shadow-[0_0_18px_rgba(34,197,94,0.15)]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(148, 163, 184, 0.14)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone.ring}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={progress}
          style={{ transition: "stroke-dashoffset 300ms ease, stroke 300ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {!compact ? <span className={`text-xs font-semibold uppercase tracking-[0.28em] ${tone.text}`}>{tone.label}</span> : null}
        <span className={`${compact ? "text-sm" : "mt-1 text-2xl"} font-semibold tracking-tight text-slate-50`}>
          {Math.round(score)}
        </span>
        {!compact && <span className="text-[11px] text-slate-400">quality score</span>}
      </div>
      <span className="sr-only">{score} out of 100</span>
    </div>
  );
};

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  tone: ScoreTone;
  gaugeScore?: number;
}

const MetricCard = ({ label, value, detail, tone, gaugeScore }: MetricCardProps) => (
  <article className={`rounded-3xl border border-white/8 bg-white/[0.04] p-5 shadow-[0_22px_60px_rgba(2,6,23,0.35)] ${tone.surface}`}>
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.26em] text-slate-400">{label}</p>
        <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">{value}</p>
        <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
      </div>
      {typeof gaugeScore === "number" ? (
        <div className="flex shrink-0 items-center justify-end">
          <ScoreGauge score={gaugeScore} size={40} compact />
        </div>
      ) : null}
    </div>
  </article>
);

const PlatformBadge = ({ platform }: { platform: Platform }) => {
  const tone = platformTone[platform];
  const Icon = platform === "github" ? GitHubMark : GitLabMark;

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${tone.bg} ${tone.border} ${tone.accent}`}>
      <Icon />
      {tone.label}
    </span>
  );
};

const ScoreBadge = ({ score }: { score: number }) => {
  const tone = scoreTone(score);

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-slate-950/60 px-3 py-2"
      aria-label={`Quality score ${Math.round(score)} out of 100`}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tone.ring }} aria-hidden="true" />
      <span className="text-sm font-semibold text-slate-100">{Math.round(score)}</span>
    </div>
  );
};

const PlatformPill = ({ platform }: { platform: Platform }) => {
  const tone = platformTone[platform];
  const Icon = platform === "github" ? GitHubMark : GitLabMark;

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${tone.bg} ${tone.border} ${tone.accent}`}>
      <Icon />
      {tone.label}
    </span>
  );
};

const ChartTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ value?: number; payload?: { createdAt: string } }> }) => {
  if (!active || !payload?.length) {
    return null;
  }

  const score = Number(payload[0]?.value ?? 0);
  const createdAt = payload[0]?.payload?.createdAt ?? "";

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/95 px-4 py-3 shadow-2xl backdrop-blur">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Score trend</p>
      <p className="mt-1 text-lg font-semibold text-slate-50">{Math.round(score)}/100</p>
      <p className="text-sm text-slate-400">{formatTimeAgo(createdAt)}</p>
    </div>
  );
};

export default function App() {
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [visibleReviewCount, setVisibleReviewCount] = useState(10);
  const [activeReviewKey, setActiveReviewKey] = useState<string | null>(null);
  const [activeReviewDetail, setActiveReviewDetail] = useState<ReviewDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showExplainModal, setShowExplainModal] = useState(false);
  const [explainTitle, setExplainTitle] = useState("");
  const [explanation, setExplanation] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadReviews = async () => {
      const controller = new AbortController();

      try {
        const response = await fetchReviews(controller.signal);

        if (!isMounted) {
          return;
        }

        setReviews(response.reviews);
        setLastUpdated(new Date().toISOString());
        setError(null);
        setActiveReviewKey((current) => current ?? response.reviews[0]?.key ?? null);
      } catch (loadError) {
        if (!isMounted) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Unable to refresh reviews.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }

      return () => controller.abort();
    };

    void loadReviews();
    const intervalId = window.setInterval(() => {
      void loadReviews();
    }, 10_000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const sortedReviews = useMemo(
    () => [...reviews].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [reviews]
  );

  const activeReview = useMemo(
    () => sortedReviews.find((review) => review.key === activeReviewKey) ?? sortedReviews[0] ?? null,
    [activeReviewKey, sortedReviews]
  );

  const visibleReviews = useMemo(
    () => sortedReviews.slice(0, visibleReviewCount),
    [sortedReviews, visibleReviewCount]
  );

  const mergeVerdictTone = (verdict?: ReviewDetailResponse["mergeRecommendation"]["verdict"]) => {
    if (verdict === "block") {
      return { label: "Blocked", bg: "bg-rose-500/12", border: "border-rose-400/30", text: "text-rose-200", badge: "" };
    }

    if (verdict === "request-changes") {
      return { label: "Request changes", bg: "bg-amber-500/12", border: "border-amber-400/30", text: "text-amber-200", badge: "" };
    }

    if (verdict === "approve-with-changes") {
      return { label: "Approve with changes", bg: "bg-cyan-500/12", border: "border-cyan-400/30", text: "text-cyan-200", badge: "" };
    }

    return {
      label: "Approved",
      bg: "bg-emerald-500/12",
      border: "border-emerald-400/30",
      text: "text-emerald-200",
      badge: "bg-emerald-400/12 border-emerald-300/20 text-emerald-100"
    };
  };

  useEffect(() => {
    if (!activeReview) {
      setActiveReviewDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/reviews/${activeReview.prId}`, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Unable to load review details (${response.status})`);
        }

        const data = (await response.json()) as ReviewDetailResponse;
        setActiveReviewDetail(data);
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }

        setDetailError(fetchError instanceof Error ? fetchError.message : "Unable to load review details.");
      } finally {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [activeReview]);

  const metrics = useMemo(() => {
    const totalReviews = reviews.length;
    const avgQualityScore = totalReviews === 0 ? 0 : Math.round(reviews.reduce((total, review) => total + review.score, 0) / totalReviews);
    const issuesFound = reviews.reduce((total, review) => total + review.issueCount, 0);
    const criticalIssues = reviews.reduce((total, review) => total + review.criticalIssueCount, 0);

    return { totalReviews, avgQualityScore, issuesFound, criticalIssues };
  }, [reviews]);

  const trendData = useMemo(() => {
    return [...reviews]
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .slice(-10)
      .map((review) => ({
        createdAt: review.createdAt,
        label: new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(review.createdAt)),
        score: review.score,
        repo: review.repoFullName
      }));
  }, [reviews]);

  const handleExplain = async (selectedReview: ReviewListItem, issueIndex: number) => {
    setExplanation("Loading...");
    setShowExplainModal(true);
    try {
      console.log('FULL REVIEW OBJECT:', JSON.stringify(selectedReview, null, 2));
      const fullKey =
        [selectedReview.key, selectedReview.prId].find((value) => typeof value === "string" && value.includes("github:")) ??
        selectedReview.key;
      const url = `/api/reviews/${encodeURIComponent(fullKey)}/explain/${issueIndex}`;
      const res = await fetch(url);
      const data = (await res.json()) as { explanation?: string; error?: string };
      if (data.explanation) {
        setExplanation(data.explanation);
      } else {
        setExplanation("Error: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      setExplanation("Failed to connect to server.");
    }
  };

  const handleViewDetailsClick = (review: ReviewListItem) => {
    console.log("View Details clicked", review.prId);
    setActiveReviewKey(review.key);
  };

  const explanationParagraphs = explanation
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.16),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(34,197,94,0.12),_transparent_24%),radial-gradient(circle_at_80%_20%,_rgba(245,158,11,0.14),_transparent_28%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.28] [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:60px_60px] [mask-image:radial-gradient(circle_at_center,black_42%,transparent_84%)]" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-[1520px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="rounded-[32px] border border-white/8 bg-slate-950/70 px-5 py-5 shadow-[0_30px_120px_rgba(2,6,23,0.35)] backdrop-blur-xl sm:px-7 sm:py-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-4">
                <LogoMark />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/90">CodeSentinel</p>
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">AI code reviews, instantly</h1>
                </div>
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400 sm:text-[15px]">
                A polished review cockpit for GitHub and GitLab pull requests, with live quality telemetry, issue trends, and automated guidance Powered by AI.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <PlatformBadge platform="github" />
              <PlatformBadge platform="gitlab" />
              <span className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                Powered by AI
              </span>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Total Reviews"
            value={isLoading ? "…" : formatCompactNumber(metrics.totalReviews)}
            detail="Incoming pull requests processed in the live feed."
            tone={scoreTone(88)}
          />
          <article className={`rounded-3xl border border-white/8 bg-white/[0.04] p-5 shadow-[0_22px_60px_rgba(2,6,23,0.35)] ${scoreTone(metrics.avgQualityScore).surface}`}>
            <div className="flex h-full flex-col">
              <p className="text-xs font-medium uppercase tracking-[0.26em] text-slate-400">Avg Quality Score</p>
              <p className="mt-3 text-[32px] font-semibold leading-none tracking-tight text-slate-50">
                {isLoading ? "…" : metrics.avgQualityScore}
              </p>
              <p className={`mt-2 text-sm font-medium ${scoreTone(metrics.avgQualityScore).text}`}>
                {isLoading ? "" : scoreTone(metrics.avgQualityScore).label}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">Rolling average across the current review window.</p>
            </div>
          </article>
          <MetricCard
            label="Issues Found"
            value={isLoading ? "…" : formatCompactNumber(metrics.issuesFound)}
            detail="Total findings surfaced by the review engine."
            tone={scoreTone(metrics.avgQualityScore)}
          />
          <MetricCard
            label="Critical Issues"
            value={isLoading ? "…" : formatCompactNumber(metrics.criticalIssues)}
            detail="Blocking risks that deserve immediate attention."
            tone={scoreTone(metrics.criticalIssues > 0 ? 55 : 90)}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.88fr)]">
          <div className="space-y-6">
            <article className="overflow-hidden rounded-[30px] border border-white/8 bg-slate-950/70 shadow-[0_30px_90px_rgba(2,6,23,0.28)] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-4 border-b border-white/6 px-5 py-5 sm:px-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Score trend</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-50">Review quality over time</h2>
                </div>
                {lastUpdated ? <span className="text-sm text-slate-400">Updated {formatTimeAgo(lastUpdated)}</span> : null}
              </div>
              <div className="h-[260px] px-3 py-4 sm:px-5">
                {trendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.38} />
                          <stop offset="75%" stopColor="#38bdf8" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" strokeDasharray="3 6" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickCount={6}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="score" stroke="#38bdf8" strokeWidth={3} fill="url(#scoreGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.02] text-sm text-slate-400">
                    Score history will appear here after the first review lands.
                  </div>
                )}
              </div>
            </article>

            <article className="overflow-hidden rounded-[30px] border border-white/8 bg-slate-950/70 shadow-[0_30px_90px_rgba(2,6,23,0.28)] backdrop-blur-xl">
              <div className="flex flex-col gap-3 border-b border-white/6 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Recent reviews</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-50">Live pull request feed</h2>
                </div>
                <p className="text-sm text-slate-400">Polling every 10 seconds</p>
              </div>

              {error ? (
                <div className="border-b border-rose-400/15 bg-rose-500/10 px-5 py-3 text-sm text-rose-200 sm:px-6">{error}</div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/6 text-left">
                  <thead className="bg-white/[0.02] text-xs uppercase tracking-[0.22em] text-slate-400">
                    <tr>
                      <th className="min-w-[140px] px-4 py-4 font-medium sm:px-4">Repo</th>
                      <th className="px-4 py-4 font-medium sm:px-4">Pull Request</th>
                      <th className="px-4 py-4 font-medium sm:px-4">Platform</th>
                      <th className="px-4 py-4 font-medium sm:px-4">Score</th>
                      <th className="px-4 py-4 font-medium sm:px-4">Issues</th>
                      <th className="px-4 py-4 font-medium sm:px-4 text-right">Updated</th>
                      <th className="px-4 py-4 font-medium sm:px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6">
                    {visibleReviews.length > 0 ? (
                      visibleReviews.map((review) => {
                        const tone = scoreTone(review.score);
                        const isActive = activeReview?.key === review.key;

                        return (
                          <tr
                            key={review.key}
                            className={`transition-colors duration-200 ${isActive ? "bg-cyan-500/5" : "hover:bg-white/[0.045]"}`}
                          >
                            <td className="min-w-[140px] px-4 py-[14px] align-top sm:px-4">
                              <div className="max-w-[240px]">
                                <p className="truncate font-medium text-slate-50">{review.repoFullName}</p>
                                <p className="mt-1 text-xs text-slate-400">{review.author}</p>
                              </div>
                            </td>
                            <td className="px-4 py-[14px] align-top sm:px-4">
                              <div className="max-w-[320px]">
                                <p className="font-medium text-slate-50">{review.title}</p>
                                <p className="mt-1 text-xs text-slate-400">
                                  {review.sourceBranch} → {review.targetBranch}
                                </p>
                              </div>
                            </td>
                            <td className="px-4 py-[14px] align-top sm:px-4">
                              <PlatformPill platform={review.platform} />
                            </td>
                            <td className="px-4 py-[14px] align-top sm:px-4">
                              <ScoreBadge score={review.score} />
                            </td>
                            <td className="px-4 py-[14px] align-top sm:px-4">
                              <div>
                                <p className="text-sm font-medium text-slate-100">{review.issueCount} issues</p>
                                <p className={`mt-1 text-xs ${tone.text}`}>{review.criticalIssueCount} critical</p>
                              </div>
                            </td>
                            <td className="px-4 py-[14px] align-top text-right text-sm text-slate-400 opacity-50 sm:px-4">
                              {formatTimeAgo(review.createdAt)}
                            </td>
                            <td className="px-4 py-[14px] align-top text-right sm:px-4">
                              <button
                                type="button"
                                onClick={() => handleViewDetailsClick(review)}
                                className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-100"
                              >
                                View Details
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td className="px-5 py-10 text-center text-sm text-slate-400 sm:px-6" colSpan={7}>
                          {isLoading ? "Loading live review feed..." : "No reviews yet. Push a webhook to populate the dashboard."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 border-t border-white/6 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="text-sm text-slate-400">
                  Showing {Math.min(visibleReviewCount, sortedReviews.length)} of {sortedReviews.length} reviews
                </p>
                {visibleReviewCount < sortedReviews.length ? (
                  <button
                    type="button"
                    onClick={() => setVisibleReviewCount((current) => current + 10)}
                    className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-100"
                  >
                    Show more
                  </button>
                ) : null}
              </div>
            </article>
          </div>

          <aside className="space-y-6">
            <article className="rounded-[30px] border border-white/8 bg-slate-950/70 p-5 shadow-[0_30px_90px_rgba(2,6,23,0.28)] backdrop-blur-xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Selected review</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-50">{activeReview?.title ?? "Choose a review"}</h2>
                </div>
                {activeReview ? <PlatformPill platform={activeReview.platform} /> : null}
              </div>

              {activeReview ? (
                <div className="mt-6 space-y-6">
                  <div className="flex items-center gap-5">
                    <ScoreGauge score={activeReview.score} size={116} />
                    <div>
                      <p className="text-sm text-slate-400">{activeReview.repoFullName}</p>
                      <p className="mt-2 text-sm leading-7 text-slate-300">{activeReview.summary}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-3xl border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-300">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Pull request</span>
                      <span className="font-medium text-slate-100">#{activeReview.prId}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Issues found</span>
                      <span className="font-medium text-slate-100">{activeReview.issueCount}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Critical issues</span>
                      <span className="font-medium text-slate-100">{activeReview.criticalIssueCount}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Branches</span>
                      <span className="max-w-[220px] truncate font-medium text-slate-100">
                        {activeReview.sourceBranch} → {activeReview.targetBranch}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Updated</span>
                      <span className="font-medium text-slate-100">{formatTimeAgo(activeReview.createdAt)}</span>
                    </div>
                  </div>

                  <style>{`.refresh-focus-button:hover { background: rgba(255,255,255,0.1) !important; }`}</style>
                  <button
                    type="button"
                    onClick={() => setActiveReviewKey(activeReview.key)}
                    className="refresh-focus-button"
                    style={{
                      width: "100%",
                      height: "40px",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "8px",
                      background: "rgba(255,255,255,0.05)",
                      color: "white",
                      fontSize: "14px",
                      cursor: "pointer",
                    }}
                  >
                    Refresh focus
                  </button>

                  {activeReviewDetail?.mergeRecommendation ? (
                    <div
                      className={`rounded-[28px] border px-5 py-4 shadow-[0_22px_60px_rgba(2,6,23,0.35)] ${mergeVerdictTone(activeReviewDetail.mergeRecommendation.verdict).bg} ${mergeVerdictTone(activeReviewDetail.mergeRecommendation.verdict).border}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 rounded-2xl border border-white/10 p-2 ${mergeVerdictTone(activeReviewDetail.mergeRecommendation.verdict).text}`}>
                          <ShieldIcon />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Merge readiness</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <span
                              className={`inline-flex items-center rounded-full border px-4 py-2 ${mergeVerdictTone(activeReviewDetail.mergeRecommendation.verdict).badge || "bg-white/[0.04] border-white/10"}`}
                            >
                              <h3
                                className={`text-[18px] font-bold tracking-tight ${mergeVerdictTone(activeReviewDetail.mergeRecommendation.verdict).text}`}
                              >
                                {mergeVerdictTone(activeReviewDetail.mergeRecommendation.verdict).label}
                              </h3>
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-medium text-slate-200">
                              Confidence {activeReviewDetail.mergeRecommendation.confidence}/100
                            </span>
                          </div>
                          {activeReviewDetail.mergeRecommendation.blockers.length > 0 ? (
                            <p className="mt-3 text-sm leading-6 text-slate-200">
                              Blockers: {activeReviewDetail.mergeRecommendation.blockers.join("; ")}
                            </p>
                          ) : null}
                          {activeReviewDetail.mergeRecommendation.quickWins.length > 0 ? (
                            <p className="mt-2 text-sm leading-6 text-slate-300">
                              Quick wins: {activeReviewDetail.mergeRecommendation.quickWins.join("; ")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-400">Issue cards</h3>
                      {detailLoading ? <span className="text-xs text-slate-500">Loading details...</span> : null}
                    </div>

                    {detailError ? <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{detailError}</div> : null}

                    <div className="space-y-3">
                      {(activeReviewDetail?.result.issues ?? []).length > 0 ? (
                        activeReviewDetail?.result.issues.map((issue, index) => (
                          <article key={`${issue.filename}:${issue.line}:${index}`} className="rounded-3xl border border-white/8 bg-white/[0.03] p-6">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">
                                    {issue.severity}
                                  </span>
                                  <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                                    {issue.category}
                                  </span>
                                </div>
                                <p className="text-sm font-medium text-slate-100">{issue.message}</p>
                                <p className="text-xs text-slate-400">
                                  {issue.filename} · line {issue.line}
                                </p>
                                <p className="text-sm leading-6 text-slate-300">{issue.suggestion}</p>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  setExplainTitle(issue.message);
                                  void handleExplain(activeReview, index);
                                }}
                                className="inline-flex shrink-0 items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-400/15"
                              >
                                Explain this ✦
                              </button>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-slate-400">
                          {detailLoading ? "Loading issue details..." : "No issue details available for this review."}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm leading-7 text-slate-400">
                  The selected review detail panel will populate once the dashboard receives data.
                </div>
              )}
            </article>

            <article className="rounded-[30px] border border-white/8 bg-slate-950/70 p-5 shadow-[0_30px_90px_rgba(2,6,23,0.28)] backdrop-blur-xl sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Live signal</p>
              <div className="mt-4 flex items-center gap-4">
                <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Current avg</div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-50">{metrics.avgQualityScore}</div>
                </div>
                <div className="space-y-2 text-sm text-slate-400">
                  <p>Scores above 80 stay in the green band.</p>
                  <p>60-80 is yellow, below 60 is flagged red.</p>
                </div>
              </div>
            </article>
          </aside>
        </section>

        {showExplainModal ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-4 backdrop-blur-sm sm:items-center">
            <div className="w-full max-w-3xl overflow-hidden rounded-[32px] border border-white/10 bg-slate-950 shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
              <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4 sm:px-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Explain this issue</p>
                  <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-50">{explainTitle}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowExplainModal(false);
                    setExplanation("");
                  }}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200 transition hover:bg-white/[0.08]"
                >
                  Close
                </button>
              </div>

              <div className="max-h-[400px] overflow-y-auto px-5 py-5 sm:px-6 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.45)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-500/40">
                <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5 text-sm leading-7 text-slate-200">
                  {explanationParagraphs.length > 0 ? (
                    explanationParagraphs.map((paragraph, index) => (
                      <p key={`${paragraph}-${index}`} className="mb-3 last:mb-0">
                        {paragraph}
                      </p>
                    ))
                  ) : (
                    <p className="mb-3 last:mb-0">{explanation}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}