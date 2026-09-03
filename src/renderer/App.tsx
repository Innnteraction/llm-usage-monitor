import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type {
  AppSnapshot,
  ClaudeSetupAction,
  LocalTokenUsage,
  ProviderSnapshot,
  QuotaWindow,
} from "../shared/index";
import {
  formatQuotaCountdown,
  formatCompactCountdown,
  formatCompactWindowLabel,
  formatResetAt,
  isResetPending,
  placeTooltip,
} from "./presentation";

const authKindNames = {
  subscription: "subscription",
  api_key: "API key",
  enterprise: "enterprise",
  unknown: "unknown auth",
} as const;

const providerNames: Record<ProviderSnapshot["providerId"], string> = {
  codex: "Codex",
  claude: "Claude Code",
  antigravity: "Antigravity",
};

const compactProviderNames: Record<ProviderSnapshot["providerId"], string> = {
  codex: "Codex",
  claude: "Claude",
  antigravity: "Antigravity",
};

const sourceNames: Record<QuotaWindow["source"], string> = {
  codex_app_server: "Codex App Server",
  claude_cli: "Claude CLI",
  antigravity_cli: "Antigravity CLI",
  local_fixture: "Local fixture",
};

const usageTone = (usedPercent?: number): "low" | "medium" | "high" => {
  if (usedPercent !== undefined && usedPercent >= 90) {
    return "high";
  }
  if (usedPercent !== undefined && usedPercent >= 70) {
    return "medium";
  }
  return "low";
};

const formatUpdatedAt = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  (target.closest("input, textarea, select, [contenteditable=true]") !== null ||
    target.closest("[contenteditable]") !== null);

const providerErrorHelp: Record<NonNullable<ProviderSnapshot["error"]>["code"], string> = {
  not_installed: "CLI가 설치되지 않았습니다.",
  not_authenticated: "CLI 로그인이 필요합니다.",
  workspace_trust_required: "전용 폴더 trust 확인이 필요합니다.",
  unsupported_output: "CLI 출력 형식을 해석하지 못했습니다.",
  rate_limited: "요청 한도에 도달했습니다.",
  network: "네트워크 연결을 확인합니다.",
  timeout: "CLI 응답 시간이 초과했습니다.",
  process_failed: "CLI 실행에 실패했습니다.",
  unavailable: "현재 quota를 제공하지 않습니다.",
  unexpected: "예상하지 못한 오류가 발생했습니다.",
};

export const formatLocalTokens = (value: number): string => {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
};

const exactLocalTokens = (value: number): string =>
  new Intl.NumberFormat("en-US").format(value);
const formatLocalShortDate = (value: string): string =>
  new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" }).format(
    new Date(value),
  );
const formatLocalDate = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
const formatLocalCalculatedAt = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

const HelpTrigger = ({
  id,
  label,
  value,
  description,
  tone = "neutral",
  className,
  testId,
  activeHelp,
  onActiveHelpChange,
}: {
  id: string;
  label: string;
  value?: string;
  description: ReactNode;
  tone?: "neutral" | "input" | "output" | "cache" | "partial";
  className?: string;
  testId?: string;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}) => {
  const tooltipId = `${id}-tooltip`;
  const isOpen = activeHelp === id;
  const helpRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const activeHelpRef = useRef<string | undefined>(undefined);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>();
  useEffect(() => {
    activeHelpRef.current = activeHelp;
  }, [activeHelp]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current || !tooltipRef.current) return;

    const updatePosition = (closeWhenHidden = false): void => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const tooltipElement = tooltipRef.current;
      if (!anchor || !tooltipElement) return;
      const providerList = document.querySelector<HTMLElement>(".provider-list");
      const listBounds = providerList?.getBoundingClientRect();
      if (
        closeWhenHidden &&
        providerList?.contains(buttonRef.current) &&
        listBounds &&
        (anchor.bottom <= listBounds.top || anchor.top >= listBounds.bottom)
      ) {
        onActiveHelpChange(undefined);
        return;
      }
      const previousMaxHeight = tooltipElement.style.maxHeight;
      tooltipElement.style.maxHeight = "none";
      const tooltipBounds = tooltipElement.getBoundingClientRect();
      const tooltipStyle = getComputedStyle(tooltipElement);
      const naturalHeight = Math.max(
        tooltipBounds.height,
        tooltipElement.scrollHeight +
          Number.parseFloat(tooltipStyle.borderTopWidth) +
          Number.parseFloat(tooltipStyle.borderBottomWidth),
      );
      tooltipElement.style.maxHeight = previousMaxHeight;
      const footerTop = document.querySelector<HTMLElement>(".app-footer")?.getBoundingClientRect().top;
      let next = placeTooltip({
        anchor,
        tooltip: { width: tooltipBounds.width, height: naturalHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        footerTop,
      });
      const overlapsAnotherTrigger = next.placement === "below" &&
        [...document.querySelectorAll<HTMLElement>(".local-token-trigger")].some(
          (trigger) => {
            if (trigger === buttonRef.current) return false;
            const bounds = trigger.getBoundingClientRect();
            return bounds.left < next.left + tooltipBounds.width &&
              bounds.right > next.left &&
              bounds.top < next.top + naturalHeight &&
              bounds.bottom > next.top;
          },
        );
      if (overlapsAnotherTrigger) {
        next = placeTooltip({
          anchor,
          tooltip: { width: tooltipBounds.width, height: naturalHeight },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          footerTop,
          preferAbove: true,
        });
      }
      setTooltipStyle({ left: next.left, top: next.top, maxHeight: next.maxHeight });
    };

    updatePosition();
    const providerList = document.querySelector<HTMLElement>(".provider-list");
    const closeIfScrolledOut = (): void => updatePosition(true);
    providerList?.addEventListener("scroll", closeIfScrolledOut, true);
    const reposition = (): void => updatePosition();
    window.addEventListener("resize", reposition);
    const observer = new ResizeObserver(reposition);
    observer.observe(buttonRef.current);
    observer.observe(tooltipRef.current);
    return () => {
      providerList?.removeEventListener("scroll", closeIfScrolledOut, true);
      window.removeEventListener("resize", reposition);
      observer.disconnect();
    };
  }, [description, isOpen, onActiveHelpChange]);
  const show = (): void => {
    window.clearTimeout(closeTimer.current);
    onActiveHelpChange(id);
  };
  const closeLater = (): void => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      if (
        activeHelpRef.current === id &&
        !helpRef.current?.contains(document.activeElement) &&
        !helpRef.current?.matches(":hover")
      ) {
        onActiveHelpChange(undefined);
      }
    }, 400);
  };
  return (
    <span
      ref={helpRef}
      className={`local-token-help tone-${tone}${className ? ` ${className}` : ""}`}
      onMouseEnter={show}
      onMouseLeave={closeLater}
    >
      <button
        ref={buttonRef}
        type="button"
        className="local-token-trigger"
        data-testid={testId}
        aria-describedby={isOpen ? tooltipId : undefined}
        onClick={show}
        onFocus={show}
        onBlur={closeLater}
      >
        <span>{label}</span>
        {value ? <strong>{value}</strong> : null}
      </button>
      {isOpen ? (
        <span
          ref={tooltipRef}
          id={tooltipId}
          className="local-token-tooltip"
          role="tooltip"
          style={tooltipStyle}
        >
          {description}
        </span>
      ) : null}
    </span>
  );
};

const LocalUsage = ({
  providerId,
  usage,
  activeHelp,
  onActiveHelpChange,
}: {
  providerId: ProviderSnapshot["providerId"];
  usage: LocalTokenUsage | undefined;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}) => {
  if (!usage) return <span className="local-usage">this PC calculating</span>;
  if (usage.scannedFileCount === 0 && !usage.partial)
    return <span className="local-usage">this PC no local logs</span>;
  const id = (kind: string): string => `${providerId}-local-${kind}`;
  const observed = usage.observedFrom
    ? formatLocalShortDate(usage.observedFrom)
    : "unavailable";
  const help = (
    kind: string,
    label: string,
    value: string | undefined,
    description: string,
    tone?: "neutral" | "input" | "output" | "cache" | "partial",
  ) => (
    <HelpTrigger
      id={id(kind)}
      label={label}
      value={value}
      description={description}
      tone={tone}
      testId={id(kind)}
      activeHelp={activeHelp}
      onActiveHelpChange={onActiveHelpChange}
    />
  );
  return (
    <div className="local-usage" aria-label="이 PC 로컬 토큰 세부 정보">
      <div className="local-usage-row">
        {help(
          "scope",
          "this PC",
          undefined,
          "이 PC에 현재 남아 있는 로그 전체의 누적 토큰입니다. 계정 전체 값이나 5h/7d quota 기간 값이 아닙니다.",
        )}
        {help(
          "total",
          "total",
          formatLocalTokens(usage.totalTokens),
          `축약 전 합계: ${exactLocalTokens(usage.totalTokens)} tokens. total = input + output이며 cache 토큰을 다시 더하지 않습니다. K=1,000, M=1,000,000, B=1,000,000,000입니다.`,
        )}
        {help(
          "since",
          "since",
          observed,
          usage.observedFrom
            ? `로컬 로그에서 관측한 가장 이른 이벤트 날짜: ${formatLocalDate(usage.observedFrom)}. quota reset 또는 구독 시작일이 아니며, 그 이후 로그가 완전하다는 보장도 아닙니다. 계산 시각: ${formatLocalCalculatedAt(usage.calculatedAt)}.`
            : `가장 이른 관측 이벤트 날짜가 제공되지 않았습니다. 계산 시각: ${formatLocalCalculatedAt(usage.calculatedAt)}.`,
        )}
        {usage.partial
          ? help(
              "partial",
              "partial",
              String(usage.failedFileCount),
              `확인된 부분 합계입니다. 읽기 또는 일부 레코드 처리에 문제가 있는 파일은 ${exactLocalTokens(usage.failedFileCount)}개입니다. 다음 스캔에서 상태를 다시 확인합니다.`,
              "partial",
            )
          : null}
      </div>
      <div className="local-usage-row">
        {help(
          "input",
          "input",
          formatLocalTokens(usage.inputTokens),
          `정확한 input: ${exactLocalTokens(usage.inputTokens)} tokens. 모델에 전달한 입력 토큰이며 cache 토큰이 포함됩니다.`,
          "input",
        )}
        {help(
          "output",
          "output",
          formatLocalTokens(usage.outputTokens),
          `정확한 output: ${exactLocalTokens(usage.outputTokens)} tokens. 모델이 생성한 출력 토큰입니다.`,
          "output",
        )}
        {help(
          "cache-read",
          "cache read",
          usage.cacheReadTokens === undefined ? "--" : formatLocalTokens(usage.cacheReadTokens),
          usage.cacheReadTokens === undefined ? "cache read 값이 제공되지 않았습니다." : `정확한 cache read: ${exactLocalTokens(usage.cacheReadTokens)} tokens. 재사용한 cache 입력 토큰이며 input에 이미 포함되므로 total에 다시 더하지 않습니다.`,
          "cache",
        )}
        {help(
          "cache-write",
          "cache write",
          usage.cacheWriteTokens === undefined ? "--" : formatLocalTokens(usage.cacheWriteTokens),
          usage.cacheWriteTokens === undefined ? "cache write 값이 제공되지 않았습니다." : `정확한 cache write: ${exactLocalTokens(usage.cacheWriteTokens)} tokens. cache에 새로 기록한 입력 토큰이며 input에 이미 포함되므로 total에 다시 더하지 않습니다.`,
          "cache",
        )}
      </div>
    </div>
  );
};

const selectDisplayWindows = (provider: ProviderSnapshot): QuotaWindow[] => {
  if (provider.providerId === "antigravity") {
    return selectWindowsById(provider.quotaWindows, [
      "agy-gemini-5h",
      "agy-gemini-weekly",
    ]);
  }
  const find = (kind: QuotaWindow["kind"]) =>
    provider.quotaWindows.find((window) => window.kind === kind);

  if (provider.providerId === "codex") {
    const weekly = find("weekly");
    return weekly ? [weekly] : [];
  }

  const primary = [find("five_hour"), find("weekly")].filter(
    (window): window is QuotaWindow => Boolean(window),
  );
  if (provider.providerId !== "claude") {
    return primary;
  }
  const fable = provider.quotaWindows.find(
    (window) =>
      window.kind === "model_weekly" && /\bfable\b/i.test(window.label),
  );
  return fable ? [...primary, fable] : primary;
};

const selectWindowsById = (
  windows: QuotaWindow[],
  ids: readonly string[],
): QuotaWindow[] =>
  ids.flatMap((id) => {
    const window = windows.find((candidate) => candidate.id === id);
    return window ? [window] : [];
  });

const hasFableWindow = (provider: ProviderSnapshot): boolean =>
  provider.quotaWindows.some(
    (window) =>
      window.kind === "model_weekly" && /\bfable\b/i.test(window.label),
  );

const missingCoreLabels = (provider: ProviderSnapshot): string[] => {
  if (provider.providerId === "antigravity") return [];
  const expectedKinds: QuotaWindow["kind"][] =
    provider.providerId === "codex" ? ["weekly"] : ["five_hour", "weekly"];
  const displayedKinds = new Set(
    selectDisplayWindows(provider).map((window) => window.kind),
  );
  return expectedKinds
    .filter((kind) => !displayedKinds.has(kind))
    .map((kind) => (kind === "weekly" ? "7d" : "5h"));
};

const selectAdditionalWindows = (
  provider: ProviderSnapshot,
  displayed: QuotaWindow[],
): QuotaWindow[] => {
  const displayedIds = new Set(displayed.map(({ id }) => id));
  const seenIds = new Set<string>();
  return provider.quotaWindows.filter((window) => {
    if (displayedIds.has(window.id) || seenIds.has(window.id)) {
      return false;
    }
    seenIds.add(window.id);
    if (
      provider.providerId === "codex" &&
      window.kind === "model_weekly" &&
      window.label.trim().toLowerCase() === "gpt-reserve weekly"
    ) {
      return false;
    }
    if (provider.providerId !== "codex") return true;
    return (
      window.kind === "model_weekly" ||
      (window.kind === "other" && window.id.startsWith("codex-limit-"))
    );
  });
};

const Quota = ({
  providerId,
  window,
  displayLabel,
  now,
  activeHelp,
  onActiveHelpChange,
}: {
  providerId: ProviderSnapshot["providerId"];
  window: QuotaWindow;
  displayLabel?: string;
  now: number;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}) => {
  const used = window.usedPercent;
  const unavailable = used === undefined || window.status === "unavailable";
  const remaining = used === undefined ? undefined : 100 - used;
  const tone = usageTone(used);
  const resetPending = isResetPending(window.resetsAt, now);
  const identity = displayLabel ? `${window.label}: ` : "";
  const label = displayLabel ?? (window.kind === "weekly"
      ? "7d"
      : window.kind === "model_weekly"
        ? window.label.replace(/\s+Weekly$/i, "")
        : window.label);

  return (
    <section className={`quota${unavailable ? " quota-not-provided" : ""}`}>
      <strong className="quota-label">{label}</strong>
      {unavailable ? (
        <span className="quota-not-provided-text">not provided</span>
      ) : (
        <>
          <progress
            className={`quota-meter tone-${tone}`}
            max={100}
            value={used}
            aria-label={`${window.label} 사용률`}
          />
          <HelpTrigger
            id={`${providerId}-${window.id}-usage`}
            label={`${used}%`}
            description={`${identity}사용률 ${used}%, 남은 비율 ${remaining}%입니다.`}
            className={`quota-value tone-${tone}`}
            testId={`${providerId}-${window.kind}-value`}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
          <HelpTrigger
            id={`${providerId}-${window.id}-reset`}
            label={
              resetPending
                ? "reset pending"
                : `resets ${formatQuotaCountdown(window.resetsAt, now)}`
            }
            description={
              resetPending
                ? `${identity}reset 확인 대기: 로컬 reset 시각은 ${formatResetAt(window.resetsAt!)}이며 마지막 quota 수치를 유지한 채 다음 provider 갱신을 기다립니다.`
                : window.resetsAt
                  ? `${identity}로컬 reset 시각: ${formatResetAt(window.resetsAt)}.`
                  : `${identity}reset 시각이 제공되지 않았습니다.`
            }
            className="quota-reset"
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        </>
      )}
      {!unavailable && remaining !== undefined ? (
        <span className="quota-remaining">{`${remaining}% remaining`}</span>
      ) : null}
    </section>
  );
};

const CompactQuotaTable = ({
  providers,
  now,
}: {
  providers: ProviderSnapshot[];
  now: number;
}) => {
  return (
    <div className="compact-table" role="table" aria-label="간이 사용량 요약">
      {providers.map((provider) => {
        const windows = selectDisplayWindows(provider);
        const weeklyWindow =
          provider.providerId === "antigravity"
            ? provider.quotaWindows.find((w) => w.id === "agy-gemini-weekly") ??
              provider.quotaWindows.find((w) => w.kind === "weekly")
            : provider.quotaWindows.find((w) => w.kind === "weekly");
        const weeklyUsed = weeklyWindow?.usedPercent;
        const weeklyTone = usageTone(weeklyUsed);

        const usedPercents = windows.map((w) =>
          w.usedPercent !== undefined ? `${w.usedPercent}%` : "--",
        );
        const windowLabels = windows.map((w) => formatCompactWindowLabel(w));
        const resets = windows.map((w) =>
          formatCompactCountdown(w.resetsAt, now),
        );

        return (
          <div key={provider.providerId} className="compact-row" role="row">
            <span className="compact-name">
              <span
                className={`status-dot status-${provider.status}`}
                aria-hidden="true"
              >
                ●
              </span>
              {compactProviderNames[provider.providerId]}
            </span>
            <div className="compact-gauge-cell">
              {weeklyUsed === undefined || weeklyWindow?.status === "unavailable" ? (
                <span className="quota-not-provided-text">--</span>
              ) : (
                <progress
                  className={`quota-meter tone-${weeklyTone}`}
                  max={100}
                  value={weeklyUsed}
                  title={`주간 한도 (${formatCompactCountdown(weeklyWindow?.resetsAt, now)}): ${weeklyUsed}%`}
                />
              )}
            </div>
            <span className="compact-percent">
              {usedPercents.length > 0 ? usedPercents.join("/") : "--"}
            </span>
            <span className="compact-window">
              {windowLabels.length > 0 ? windowLabels.join("/") : "--"}
            </span>
            <span className="compact-reset">
              {resets.length > 0 ? resets.join("/") : "--"}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const ProviderCard = ({
  provider,
  index,
  onOpenClaudeSetup,
  now,
  activeHelp,
  onActiveHelpChange,
  tokensVisible,
}: {
  provider: ProviderSnapshot;
  index: number;
  onOpenClaudeSetup(action: ClaudeSetupAction): void;
  now: number;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
  tokensVisible: boolean;
}) => {
  const sources = [
    ...new Set(provider.quotaWindows.map(({ source }) => sourceNames[source])),
  ];
  if (provider.providerId === "antigravity" && sources.length === 0) {
    sources.push("Antigravity CLI");
  }
  const primaryWindows = selectDisplayWindows(provider);
  const missingCores = missingCoreLabels(provider);
  const additionalWindows = selectAdditionalWindows(provider, primaryWindows);
  const additionalWindowCount = additionalWindows.length;
  const [additionalExpanded, setAdditionalExpanded] = useState(false);
  const additionalId = `${provider.providerId}-additional-limits`;
  const setupAction =
    provider.providerId !== "claude"
      ? undefined
      : provider.error?.code === "not_authenticated"
        ? "login"
        : provider.error?.code === "workspace_trust_required"
          ? "trust_probe"
          : undefined;
  return (
    <article className="provider-card">
      <header>
        <span className="provider-index">{index + 1}</span>
        <div className="provider-title">
          <h2>{providerNames[provider.providerId]}</h2>
          {provider.accountLabel ? (
            <HelpTrigger
              id={`${provider.providerId}-account`}
              label={provider.accountLabel}
              className="account-label"
              description={`현재 ${providerNames[provider.providerId]} CLI가 제공한 계정 식별자: ${provider.accountLabel}. 이 값은 이 화면의 메모리에만 유지됩니다.`}
              activeHelp={activeHelp}
              onActiveHelpChange={onActiveHelpChange}
            />
          ) : null}
          {provider.providerId === "claude" && provider.authKind ? (
            <span className="account-client">
              CLI/{authKindNames[provider.authKind]}
            </span>
          ) : null}
        </div>
        <span className={`status status-${provider.status}`}>
          <span aria-hidden="true">●</span> {provider.status}
        </span>
      </header>
      {provider.error ? (
        <div className="provider-error-row" role="status">
          <p className="provider-error">
            {providerErrorHelp[provider.error.code]}
            {provider.status === "stale"
              ? ` 마지막 성공 ${formatUpdatedAt(provider.lastSuccessfulAt ?? provider.fetchedAt)}.`
              : ""}
          </p>
          {setupAction ? (
            <button
              type="button"
              className="setup-action"
              onClick={() => onOpenClaudeSetup(setupAction)}
            >
              {setupAction === "login" ? "sign in" : "prepare folder"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="quota-grid">
        {primaryWindows.map((window) => (
          <Quota
            key={window.id}
            providerId={provider.providerId}
            window={window}
            displayLabel={
              provider.providerId === "antigravity"
                ? window.id === "agy-gemini-weekly"
                  ? "7d"
                  : "5h"
                : undefined
            }
            now={now}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        ))}
        {missingCores.map((label) => (
          <p className="quota-unavailable" key={`missing-${label}`}>
            <strong>{label}</strong>
            <span>not provided</span>
          </p>
        ))}
        {provider.providerId === "antigravity" && provider.quotaWindows.length === 0 ? (
          <p className="quota-unavailable">
            <strong>Quota</strong>
            <span>not provided</span>
          </p>
        ) : null}
        {provider.providerId === "claude" && !hasFableWindow(provider) ? (
          <p className="quota-unavailable">
            <strong>Fable</strong>
            <span>not provided by Claude CLI</span>
          </p>
        ) : null}
      </div>
      {additionalWindowCount > 0 ? (
        <div className="additional-limits">
          <button
            type="button"
            aria-controls={additionalId}
            aria-expanded={additionalExpanded}
            onClick={() => setAdditionalExpanded((expanded) => !expanded)}
          >
            +{additionalWindowCount} additional limits
          </button>
          {additionalExpanded ? (
            <div id={additionalId} className="additional-quota-grid">
              {provider.providerId === "antigravity" ? (
                <AntigravityAdditionalQuotas
                  providerId={provider.providerId}
                  windows={additionalWindows}
                  now={now}
                  activeHelp={activeHelp}
                  onActiveHelpChange={onActiveHelpChange}
                />
              ) : additionalWindows.map((window) => (
                <div className="additional-quota" key={window.id}>
                  <h3>{window.label}</h3>
                  <Quota
                    providerId={provider.providerId}
                    window={window}
                    now={now}
                    activeHelp={activeHelp}
                    onActiveHelpChange={onActiveHelpChange}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <footer>
        {tokensVisible && provider.providerId !== "antigravity" ? (
          <LocalUsage
            providerId={provider.providerId}
            usage={provider.localUsage}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        ) : null}
        <span>source {sources.join(", ")}</span>
        <span>
          updated{" "}
          {formatUpdatedAt(
            provider.status === "stale"
              ? (provider.lastSuccessfulAt ?? provider.fetchedAt)
              : provider.fetchedAt,
          )}
        </span>
      </footer>
    </article>
  );
};

const AntigravityAdditionalQuotas = ({
  providerId,
  windows,
  now,
  activeHelp,
  onActiveHelpChange,
}: {
  providerId: ProviderSnapshot["providerId"];
  windows: QuotaWindow[];
  now: number;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}) => {
  const sharedWindows = selectWindowsById(windows, [
    "agy-claude-gpt-5h",
    "agy-claude-gpt-weekly",
  ]);
  const sharedIds = new Set(sharedWindows.map(({ id }) => id));
  return (
    <>
      {sharedWindows.length > 0 ? (
        <div className="additional-quota-group">
          <h3>Claude/GPT</h3>
          <div className="additional-quota-rows">
            {sharedWindows.map((window) => (
              <Quota
                key={window.id}
                providerId={providerId}
                window={window}
                displayLabel={
                  window.id === "agy-claude-gpt-weekly" ? "7d" : "5h"
                }
                now={now}
                activeHelp={activeHelp}
                onActiveHelpChange={onActiveHelpChange}
              />
            ))}
          </div>
        </div>
      ) : null}
      {windows.filter(({ id }) => !sharedIds.has(id)).map((window) => (
        <div className="additional-quota" key={window.id}>
          <h3>{window.label}</h3>
          <Quota
            providerId={providerId}
            window={window}
            now={now}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        </div>
      ))}
    </>
  );
};

export const App = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [error, setError] = useState(false);
  const [activeHelp, setActiveHelp] = useState<string>();
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [compactMode, setCompactMode] = useState(false);
  const [tokensVisible, setTokensVisible] = useState(false);
  const [tokenVisibilityPending, setTokenVisibilityPending] = useState(false);
  const [displayError, setDisplayError] = useState("");
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [themeOverride, setThemeOverride] = useState<"light" | "dark">();
  const previousSnapshot = useRef<AppSnapshot | undefined>(undefined);
  const tokenVisibilityInFlight = useRef(false);
  const appShellRef = useRef<HTMLElement>(null);
  const providerListRef = useRef<HTMLElement>(null);
  const providerListContentRef = useRef<HTMLDivElement>(null);
  const appHeaderRef = useRef<HTMLElement>(null);
  const appFooterRef = useRef<HTMLElement>(null);
  const resizeFrame = useRef<number | undefined>(undefined);
  const lastWindowSizeRequest = useRef<string | undefined>(undefined);
  const effectiveTheme = themeOverride ?? systemTheme;

  const toggleCompactMode = useCallback((): void => {
    setActiveHelp(undefined);
    setCompactMode((prev) => !prev);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (): void => {
      if (!themeOverride) setSystemTheme(media.matches ? "dark" : "light");
    };
    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [themeOverride]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  const toggleTokenVisibility = useCallback((): void => {
    if (tokenVisibilityInFlight.current) return;
    const visible = !tokensVisible;
    tokenVisibilityInFlight.current = true;
    setTokenVisibilityPending(true);
    setDisplayError("");
    setActiveHelp(undefined);
    setTokensVisible(visible);
  }, [tokensVisible]);

  useLayoutEffect(() => {
    const shell = appShellRef.current;
    const providerList = providerListRef.current;
    const content = providerListContentRef.current;
    const header = appHeaderRef.current;
    const footer = appFooterRef.current;
    if (!shell || !providerList || !content || !header || !footer) return;
    let active = true;

    const requestSize = (): void => {
      if (resizeFrame.current !== undefined) {
        window.cancelAnimationFrame(resizeFrame.current);
      }
      resizeFrame.current = window.requestAnimationFrame(() => {
        const shellBounds = shell.getBoundingClientRect();
        const listBounds = providerList.getBoundingClientRect();
        const footerBounds = footer.getBoundingClientRect();
        const shellStyle = getComputedStyle(shell);
        const contentHeight = Math.min(
          4096,
          Math.ceil(
            listBounds.top - shellBounds.top +
              content.scrollHeight +
              footerBounds.height +
              Number.parseFloat(shellStyle.paddingBottom) +
              4,
          ),
        );
        const requestKey = `${compactMode}:${tokensVisible}:${contentHeight}`;
        if (lastWindowSizeRequest.current === requestKey) return;
        lastWindowSizeRequest.current = requestKey;
        void window.usageMonitor
          .setTokensVisible(tokensVisible, contentHeight)
          .catch(() => {
            if (active) setDisplayError("창 높이를 변경하지 못했습니다.");
          })
          .finally(() => {
            if (active) {
              tokenVisibilityInFlight.current = false;
              setTokenVisibilityPending(false);
            }
          });
      });
    };

    requestSize();
    const observer = new ResizeObserver(requestSize);
    observer.observe(content);
    observer.observe(header);
    observer.observe(footer);
    return () => {
      active = false;
      if (resizeFrame.current !== undefined) {
        window.cancelAnimationFrame(resizeFrame.current);
      }
      observer.disconnect();
    };
  }, [compactMode, displayError, error, tokensVisible]);

  useEffect(() => {
    const updateClock = (): void => setNow(Date.now());
    const handleWindowFocus = (): void => {
      updateClock();
      setActiveHelp(undefined);
    };
    const timer = window.setInterval(updateClock, 30_000);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  useEffect(() => {
    const closeHelp = (): void => setActiveHelp(undefined);
    window.addEventListener("blur", closeHelp);
    document.addEventListener("visibilitychange", closeHelp);
    return () => {
      window.removeEventListener("blur", closeHelp);
      document.removeEventListener("visibilitychange", closeHelp);
    };
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setActiveHelp(undefined);
        return;
      }
      if (
        event.repeat ||
        event.isComposing ||
        isEditableTarget(event.target) ||
        !event.ctrlKey ||
        !event.shiftKey ||
        event.altKey ||
        event.metaKey
      ) {
        return;
      }
      if (event.code === "KeyC") {
        event.preventDefault();
        toggleCompactMode();
      } else if (event.code === "KeyT") {
        event.preventDefault();
        toggleTokenVisibility();
      } else if (event.code === "KeyL") {
        event.preventDefault();
        setActiveHelp(undefined);
        setThemeOverride(effectiveTheme === "dark" ? "light" : "dark");
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [effectiveTheme, toggleCompactMode, toggleTokenVisibility]);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.usageMonitor.subscribe((next) => {
      if (active) {
        setSnapshot(next);
        const previous = previousSnapshot.current;
        if (previous?.refreshing.length && !next.refreshing.length) {
          setNotice(
            next.providers.some((provider) => provider.error)
              ? "사용량 갱신 실패: 마지막 값을 유지합니다."
              : "사용량 갱신 완료.",
          );
        }
        if (!next.providers.some((provider) => provider.error)) setError(false);
        previousSnapshot.current = next;
      }
    });
    void window.usageMonitor
      .getState()
      .then((next) => {
        if (active) {
          setSnapshot(next);
          previousSnapshot.current = next;
          setNotice("사용량을 불러왔습니다.");
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setNotice("사용량을 불러오지 못했습니다.");
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const refresh = (): void => {
    setError(false);
    setNotice("");
    void window.usageMonitor.refresh().catch(() => setError(true));
  };

  const toggleTheme = (): void => {
    setActiveHelp(undefined);
    setThemeOverride(effectiveTheme === "dark" ? "light" : "dark");
  };

  const openClaudeSetup = (action: ClaudeSetupAction): void => {
    setError(false);
    void window.usageMonitor
      .openClaudeSetup(action)
      .then(({ opened }) => {
        if (!opened) {
          setError(true);
        }
      })
      .catch(() => setError(true));
  };

  return (
    <main ref={appShellRef} className="app-shell">
      <header ref={appHeaderRef} className="app-header">
        <h1>watching quota providers</h1>
        <button
          type="button"
          onClick={refresh}
          disabled={!snapshot || snapshot.refreshing.length > 0}
        >
          {snapshot?.refreshing.length ? "refreshing..." : "refresh"}
        </button>
      </header>

      {error ? (
        <p className="error-banner" role="alert">
          사용량을 갱신하지 못했습니다. 마지막 값을 유지합니다.
        </p>
      ) : null}

      {displayError ? (
        <p className="display-error" role="alert">
          {displayError}
        </p>
      ) : null}

      <p className="update-notice" role="status" aria-live="polite">
        {notice}
      </p>

      <section ref={providerListRef} className="provider-list">
        <div ref={providerListContentRef} className="provider-list-content">
          {snapshot ? (
            compactMode ? (
              <CompactQuotaTable providers={snapshot.providers} now={now} />
            ) : (
              snapshot.providers.map((provider, index) => (
                <ProviderCard
                  key={provider.providerId}
                  provider={provider}
                  index={index}
                  onOpenClaudeSetup={openClaudeSetup}
                  now={now}
                  activeHelp={activeHelp}
                  onActiveHelpChange={setActiveHelp}
                  tokensVisible={tokensVisible}
                />
              ))
            )
          ) : (
            <p className="loading">사용량을 불러오는 중…</p>
          )}
        </div>
      </section>

      <footer ref={appFooterRef} className="app-footer">
        <p className="scope-note">
          <span>quota: account · tokens: this PC</span>
          <span>Claude Desktop: not inspected</span>
        </p>
        <div className="footer-help">
          <div className="footer-controls">
            <button
              type="button"
              className="display-toggle compact-toggle"
              aria-label={compactMode ? "상세 모드로 펼치기" : "간이 모드로 접기"}
              aria-pressed={compactMode}
              aria-keyshortcuts="Control+Shift+C"
              title={compactMode ? "상세 모드로 펼치기 (Ctrl+Shift+C)" : "간이 모드로 접기 (Ctrl+Shift+C)"}
              onClick={toggleCompactMode}
            >
              <span aria-hidden="true">{compactMode ? "⊞" : "⊟"}</span>
            </button>
            <button
              type="button"
              className="display-toggle token-toggle"
              aria-label="Tokens"
              aria-pressed={tokensVisible}
              aria-keyshortcuts="Control+Shift+T"
              title={`Tokens: ${tokensVisible ? "on" : "off"} (Ctrl+Shift+T)`}
              onClick={toggleTokenVisibility}
              disabled={tokenVisibilityPending}
            >
              <span aria-hidden="true">◎</span>
            </button>
            <button
              type="button"
              className="display-toggle theme-toggle"
              aria-label="Dark theme"
              aria-pressed={effectiveTheme === "dark"}
              aria-keyshortcuts="Control+Shift+L"
              title={`${effectiveTheme === "dark" ? "Dark" : "Light"} theme (Ctrl+Shift+L)`}
              onClick={toggleTheme}
            >
              <span aria-hidden="true">{effectiveTheme === "dark" ? "☾" : "☼"}</span>
            </button>
            <HelpTrigger
              id="keyboard-help"
              label="?"
              className="help-trigger-toggle"
              testId="keyboard-help-trigger"
              description={
                <div className="help-content">
                  <h3 className="help-heading">단축키 안내</h3>
                  <ul className="help-shortcuts">
                    <li className="help-shortcut-row">
                      <span className="help-keys">
                        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>
                      </span>
                      <span className="help-desc">간이 모드 접기 / 펼치기</span>
                    </li>
                    <li className="help-shortcut-row">
                      <span className="help-keys">
                        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>
                      </span>
                      <span className="help-desc">로컬 토큰 사용량 토글</span>
                    </li>
                    <li className="help-shortcut-row">
                      <span className="help-keys">
                        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>
                      </span>
                      <span className="help-desc">다크 / 라이트 테마 전환</span>
                    </li>
                    <li className="help-shortcut-row">
                      <span className="help-keys">
                        <kbd>Esc</kbd>
                      </span>
                      <span className="help-desc">팝오버 닫기 (트레이 상주)</span>
                    </li>
                  </ul>
                  <h3 className="help-heading">조작 안내</h3>
                  <ul className="help-notes">
                    <li>항목 호버/포커스: 상세 사용량 안내</li>
                    <li>트레이 우클릭: 자동 실행, 새로고침, 종료</li>
                  </ul>
                </div>
              }
              activeHelp={activeHelp}
              onActiveHelpChange={setActiveHelp}
            />
          </div>
        </div>
      </footer>
    </main>
  );
};
