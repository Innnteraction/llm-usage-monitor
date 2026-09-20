import type { ProviderId, ServiceHealthIndicator, VendorServiceStatus } from "../shared/index";

export const CLAUDE_STATUS_URL = "https://status.claude.com/api/v2/summary.json";
export const CLAUDE_FALLBACK_STATUS_URL = "https://status.anthropic.com/api/v2/summary.json";
export const CLAUDE_STATUS_PAGE_URL = "https://status.claude.com";

export const OPENAI_STATUS_URL = "https://status.openai.com/api/v2/summary.json";
export const OPENAI_STATUS_PAGE_URL = "https://status.openai.com";

export const GOOGLE_CLOUD_INCIDENTS_URL = "https://status.cloud.google.com/incidents.json";
export const ANTIGRAVITY_STATUS_PAGE_URL = "https://status.cloud.google.com";

export const FETCH_TIMEOUT_MS = 5000;

interface StatuspageSummary {
  status?: {
    indicator?: string;
    description?: string;
  };
  components?: Array<{
    name?: string;
    status?: string;
  }>;
  incidents?: Array<{
    name?: string;
    impact?: string;
    status?: string;
  }>;
}

interface GoogleIncident {
  id?: string;
  begin?: string;
  end?: string;
  external_desc?: string;
  service_name?: string;
  severity?: string;
}

export interface FetchStatusOptions {
  fetchFn?: typeof fetch;
  clock?: () => Date;
  timeoutMs?: number;
}

function mapIndicator(raw?: string): ServiceHealthIndicator {
  switch (raw?.toLowerCase()) {
    case "none":
    case "operational":
      return "operational";
    case "minor":
    case "degraded_performance":
      return "minor";
    case "major":
    case "partial_outage":
      return "major";
    case "critical":
    case "major_outage":
      return "critical";
    default:
      return "unknown";
  }
}

function combineSignals(
  overallIndicator: ServiceHealthIndicator,
  componentIndicator: ServiceHealthIndicator,
): ServiceHealthIndicator {
  const ranks: Record<ServiceHealthIndicator, number> = {
    unknown: 0,
    operational: 1,
    minor: 2,
    major: 3,
    critical: 4,
  };
  return ranks[componentIndicator] > ranks[overallIndicator] ? componentIndicator : overallIndicator;
}

export function getSimulatedIncident(
  providerId: ProviderId,
  clock: () => Date,
): VendorServiceStatus | null {
  const mockTarget = process.env.LLM_USAGE_MONITOR_MOCK_INCIDENT?.trim().toLowerCase();
  if (!mockTarget) return null;

  const matches =
    mockTarget === "1" ||
    mockTarget === "true" ||
    mockTarget === "all" ||
    mockTarget === providerId;

  if (!matches) return null;

  const nowIso = clock().toISOString();

  switch (providerId) {
    case "claude":
      return {
        indicator: "minor",
        description: "Elevated error rates on Claude Code (Simulated)",
        statusPageUrl: CLAUDE_STATUS_PAGE_URL,
        incidentTitle: "Claude Code service incident reported (Simulated)",
        checkedAt: nowIso,
      };
    case "codex":
      return {
        indicator: "major",
        description: "Codex API service outage (Simulated)",
        statusPageUrl: OPENAI_STATUS_PAGE_URL,
        incidentTitle: "Codex API Outage (Simulated)",
        checkedAt: nowIso,
      };
    case "antigravity":
      return {
        indicator: "critical",
        description: "Google Cloud AI incident (Simulated)",
        statusPageUrl: ANTIGRAVITY_STATUS_PAGE_URL,
        incidentTitle: "Antigravity service degraded (Simulated)",
        checkedAt: nowIso,
      };
  }
}

export async function fetchClaudeStatus(
  signal?: AbortSignal,
  options: FetchStatusOptions = {},
): Promise<VendorServiceStatus> {
  const fetchFn = options.fetchFn ?? fetch;
  const clock = options.clock ?? (() => new Date());
  const nowIso = clock().toISOString();

  const simulated = getSimulatedIncident("claude", clock);
  if (simulated) return simulated;

  const urls = [CLAUDE_STATUS_URL, CLAUDE_FALLBACK_STATUS_URL];
  for (const url of urls) {
    try {
      const response = await fetchFn(url, {
        signal: signal ?? AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;

      const data = (await response.json()) as StatuspageSummary;
      let indicator = mapIndicator(data.status?.indicator);

      const relevantComponents = data.components?.filter((comp) => {
        const name = comp.name?.toLowerCase() ?? "";
        return name.includes("claude code") || name.includes("claude api");
      });

      let worstCompIndicator: ServiceHealthIndicator = "operational";
      if (relevantComponents && relevantComponents.length > 0) {
        for (const comp of relevantComponents) {
          const compInd = mapIndicator(comp.status);
          worstCompIndicator = combineSignals(worstCompIndicator, compInd);
        }
      }
      indicator = combineSignals(indicator, worstCompIndicator);

      const activeIncident = data.incidents?.find(
        (inc) => inc.status !== "resolved" && inc.status !== "completed",
      );

      return {
        indicator,
        description: data.status?.description ?? (indicator === "operational" ? "All Systems Operational" : "Service incident reported"),
        statusPageUrl: CLAUDE_STATUS_PAGE_URL,
        incidentTitle: activeIncident?.name,
        checkedAt: nowIso,
      };
    } catch {
      // try fallback url or return unknown
    }
  }

  return {
    indicator: "unknown",
    description: "Status page temporarily unreachable",
    statusPageUrl: CLAUDE_STATUS_PAGE_URL,
    checkedAt: nowIso,
  };
}

export async function fetchCodexStatus(
  signal?: AbortSignal,
  options: FetchStatusOptions = {},
): Promise<VendorServiceStatus> {
  const fetchFn = options.fetchFn ?? fetch;
  const clock = options.clock ?? (() => new Date());
  const nowIso = clock().toISOString();

  const simulated = getSimulatedIncident("codex", clock);
  if (simulated) return simulated;

  try {
    const response = await fetchFn(OPENAI_STATUS_URL, {
      signal: signal ?? AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as StatuspageSummary;
    let indicator = mapIndicator(data.status?.indicator);

    const relevantComponents = data.components?.filter((comp) => {
      const name = comp.name?.toLowerCase() ?? "";
      return name.includes("codex") || name.includes("api") || name.includes("login");
    });

    let worstCompIndicator: ServiceHealthIndicator = "operational";
    if (relevantComponents && relevantComponents.length > 0) {
      for (const comp of relevantComponents) {
        const compInd = mapIndicator(comp.status);
        worstCompIndicator = combineSignals(worstCompIndicator, compInd);
      }
    }
    indicator = combineSignals(indicator, worstCompIndicator);

    const activeIncident = data.incidents?.find(
      (inc) => inc.status !== "resolved" && inc.status !== "completed",
    );

    return {
      indicator,
      description: data.status?.description ?? (indicator === "operational" ? "All Systems Operational" : "Service incident reported"),
      statusPageUrl: OPENAI_STATUS_PAGE_URL,
      incidentTitle: activeIncident?.name,
      checkedAt: nowIso,
    };
  } catch {
    return {
      indicator: "unknown",
      description: "Status page temporarily unreachable",
      statusPageUrl: OPENAI_STATUS_PAGE_URL,
      checkedAt: nowIso,
    };
  }
}

export async function fetchAntigravityStatus(
  signal?: AbortSignal,
  options: FetchStatusOptions = {},
): Promise<VendorServiceStatus> {
  const fetchFn = options.fetchFn ?? fetch;
  const clock = options.clock ?? (() => new Date());
  const nowIso = clock().toISOString();

  const simulated = getSimulatedIncident("antigravity", clock);
  if (simulated) return simulated;

  try {
    const response = await fetchFn(GOOGLE_CLOUD_INCIDENTS_URL, {
      signal: signal ?? AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });

    let indicator: ServiceHealthIndicator = "operational";
    let incidentTitle: string | undefined;

    if (response.ok) {
      const incidents = (await response.json()) as GoogleIncident[];
      if (Array.isArray(incidents)) {
        const activeAiIncidents = incidents.filter((inc) => {
          if (inc.end) return false;
          const text = `${inc.service_name ?? ""} ${inc.external_desc ?? ""}`.toLowerCase();
          return (
            text.includes("gemini") ||
            text.includes("vertex") ||
            text.includes("ai platform") ||
            text.includes("antigravity")
          );
        });

        if (activeAiIncidents.length > 0) {
          const first = activeAiIncidents[0];
          indicator = first?.severity === "high" ? "critical" : "minor";
          incidentTitle = first?.external_desc;
        }
      }
    }

    return {
      indicator,
      description: indicator === "operational" ? "All Systems Operational" : "Google Cloud AI incident reported",
      statusPageUrl: ANTIGRAVITY_STATUS_PAGE_URL,
      incidentTitle,
      checkedAt: nowIso,
    };
  } catch {
    return {
      indicator: "unknown",
      description: "Service status check unavailable",
      statusPageUrl: ANTIGRAVITY_STATUS_PAGE_URL,
      checkedAt: nowIso,
    };
  }
}

export async function fetchVendorServiceStatus(
  providerId: ProviderId,
  signal?: AbortSignal,
  options: FetchStatusOptions = {},
): Promise<VendorServiceStatus> {
  switch (providerId) {
    case "claude":
      return fetchClaudeStatus(signal, options);
    case "codex":
      return fetchCodexStatus(signal, options);
    case "antigravity":
      return fetchAntigravityStatus(signal, options);
  }
}
