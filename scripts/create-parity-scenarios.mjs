// 수동 검수용 허구 입력. 기준 fixture를 변경하지 않는다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const base = JSON.parse(readFileSync(path.join(root, ".work/parity-reference/snapshot.json"), "utf8"));
const output = path.join(root, ".work/parity-captures/fixtures");
mkdirSync(output, { recursive: true });
const statusPages = { codex: "https://status.openai.com", claude: "https://status.claude.com", antigravity: "https://status.cloud.google.com" };
const scenarios = {
  normal() {},
  animation_stages(snapshot) {
    const stages = [50, 80, 92, 99];
    let index = 0;
    for (const provider of snapshot.providers) {
      for (const quota of provider.quotaWindows) {
        const duration = ["weekly", "model_weekly"].includes(quota.kind) ? 604800_000 : 18000_000;
        const elapsed = stages[index++ % stages.length];
        quota.resetsAt = new Date(Date.parse(snapshot.updatedAt) + duration * (100 - elapsed) / 100).toISOString();
      }
    }
  },
  stale(snapshot) {
    for (const provider of snapshot.providers) {
      provider.status = "stale";
      provider.error = { code: "network_error", message: "Synthetic network failure" };
      provider.lastSuccessfulAt = new Date(Date.parse(snapshot.updatedAt) - 20 * 60_000).toISOString();
      for (const quota of provider.quotaWindows) quota.status = "stale";
    }
  },
  unavailable(snapshot) {
    for (const provider of snapshot.providers) {
      provider.status = "unavailable";
      for (const quota of provider.quotaWindows) {
        quota.status = "unavailable";
        delete quota.usedPercent;
        delete quota.resetsAt;
      }
    }
  },
  setup(snapshot) {
    for (const provider of snapshot.providers) {
      provider.status = "unavailable";
      provider.quotaWindows = [];
      provider.error = { code: provider.providerId === "claude" ? "workspace_trust_required" : "not_authenticated", message: "Synthetic setup required" };
    }
  },
  pending_partial(snapshot) {
    for (const provider of snapshot.providers) {
      for (const quota of provider.quotaWindows) quota.resetsAt = snapshot.updatedAt;
      if (provider.localUsage) {
        provider.localUsage.partial = true;
        provider.localUsage.failedFileCount = 2;
        delete provider.localUsage.cacheReadTokens;
      }
    }
  },
  incident_long(snapshot) {
    for (const provider of snapshot.providers) {
      provider.accountLabel = "synthetic-long-account-for-layout@example.invalid";
      provider.serviceStatus = { indicator: "major", description: "Synthetic service incident", incidentTitle: "Synthetic incident with a long title for wrapping verification", statusPageUrl: statusPages[provider.providerId], checkedAt: snapshot.updatedAt };
    }
  },
};
// 벤더 단독 장애와 정상/unknown 대조군. 인증이나 실제 상태 API를 호출하지 않는다.
for (const providerId of ["codex", "claude", "antigravity"]) {
  for (const indicator of ["minor", "major", "critical", "operational", "unknown"]) {
    scenarios[`incident_${providerId}_${indicator}`] = (snapshot) => {
      for (const provider of snapshot.providers) {
        provider.serviceStatus = {
          indicator: provider.providerId === providerId ? indicator : "operational",
          description: `Synthetic ${indicator} status`,
          ...(provider.providerId === providerId && ["minor", "major", "critical"].includes(indicator)
            ? { incidentTitle: `Synthetic ${providerId} ${indicator} incident` } : {}),
          statusPageUrl: statusPages[provider.providerId],
          checkedAt: snapshot.updatedAt,
        };
      }
    };
  }
}
for (const [name, update] of Object.entries(scenarios)) {
  const snapshot = structuredClone(base);
  update(snapshot);
  writeFileSync(path.join(output, `${name}.json`), JSON.stringify(snapshot, null, 2) + "\n");
}
