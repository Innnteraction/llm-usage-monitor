<!-- 이 파일은 render-architecture-evidence.py가 생성합니다. 직접 수정하지 마십시오. -->

# 기계 생성 아키텍처 증거

> 정적 분석 결과를 결정적으로 렌더링한 기계 증거다. 평가·권장안이 아니며 런타임 실행 빈도를 나타내지 않는다.

<a id="evidence-snapshot"></a>

## 1. Snapshot과 capability

| 항목 | 값 |
| --- | --- |
| schema version | 1.0.0 |
| source digest | f599a3e87e20d72887ba5e857ab4b0c2fa662deab512bc6acd99fe05e4ca050c |
| Git commit | 7b7f099a90aeffa9af7a1fedd7e8c1ddda4aac10 |
| dirty | true |
| 선택 scope | production |
| 분석 module | 138 |
| 제외 module | 48 |
| 추출 symbol | 977 |
| entrypoint 관측 | 101 |
| 정규화된 분석 entrypoint | 39 |
| 미포함 nested TypeScript project | 0 |
| 일차 경계 전략 | package |

capability: architecture-static-summary, call-candidates, cargo-metadata, entrypoint-discovery, git-change-coupling, module-graph, module-scope-classification, source-inventory, symbol-index, typescript-compiler-api

<a id="evidence-coverage"></a>

## 2. Coverage와 edge 처리 단계

| 단계 | 결과 | 기계적 정의 |
| --- | --- | --- |
| 원시 edge 관측 | 14,208 | 정적 분석기가 기록한 전체 관계 관측 |
| 구조 의존 edge 관측 | 13,174 | 원시 관측 중 imports·calls·registers |
| package-root 내부 재분류 관측 | 0 | 구조 의존 관측 중 알려진 내부 module prefix와 일치한 부분집합 |
| 정규화된 module dependency | 299 | 내부 source·target 확인, self-edge 제외, source·target·type·resolution 중복 제거 |
| 경계 내부 module dependency | 299 | source와 target의 일차 경계가 같은 정규화 관계 |
| 경계 간 module dependency | 0 | source와 target의 일차 경계가 다른 정규화 관계 |
| 경계 쌍 집계 행 | 0 | source 경계·target 경계·confidence별 집계 행 |

`원시 관측 14,208 → 의존 유형 선별 13,174 → 내부 판정·self-edge 제외·중복 제거 → module dependency 299`

내부 재분류 관측은 구조 의존 관측의 부분집합이므로 별도 graph 크기로 더하거나 빼지 않는다.

| 관계 유형 | 원시 관측 | 정규화된 내부 module dependency |
| --- | --- | --- |
| calls | 12,467 | 137 |
| contains | 977 | 0 |
| exports | 57 | 0 |
| imports | 614 | 162 |
| registers | 93 | 0 |

<a id="evidence-boundaries"></a>

## 3. 경계별 구조 집계

| 경계 | module | 내부 dependency | inbound | outbound |
| --- | --- | --- | --- | --- |
| apps/node | 95 | 157 | 0 | 0 |
| apps/rust | 37 | 142 | 0 | 0 |
| . | 6 | 0 | 0 | 0 |

<a id="evidence-module-hubs"></a>

### Module dependency hub

| module | import fan-in | import fan-out | 합계 |
| --- | --- | --- | --- |
| apps/node/src/shared/index.ts | 36 | 0 | 36 |
| apps/node/src/main/application.ts | 1 | 12 | 13 |
| apps/rust/src/ui/mod.rs | 1 | 10 | 11 |
| apps/node/src/renderer/selectors.ts | 7 | 1 | 8 |
| apps/node/src/renderer/components/ProviderCard.tsx | 1 | 6 | 7 |
| apps/node/src/renderer/App.tsx | 0 | 7 | 7 |
| apps/rust/src/core/types.rs | 6 | 0 | 6 |
| apps/rust/src/ui/theme.rs | 6 | 0 | 6 |
| apps/node/src/local-usage/types.ts | 5 | 1 | 6 |
| apps/node/src/renderer/components/HelpTrigger.tsx | 5 | 1 | 6 |
| apps/node/src/main/platform/index.ts | 4 | 2 | 6 |
| apps/node/src/renderer/components/QuotaMeter.tsx | 2 | 4 | 6 |
| apps/node/src/renderer/components/CompactQuotaTable.tsx | 1 | 5 | 6 |
| apps/rust/src/core/local_usage/mod.rs | 1 | 5 | 6 |
| apps/node/src/core/UsageMonitorCore.ts | 0 | 6 | 6 |
| apps/rust/src/core/mod.rs | 1 | 4 | 5 |
| apps/node/src/local-usage/claude/scanner.ts | 0 | 5 | 5 |
| apps/node/src/local-usage/codex/scanner.ts | 0 | 5 | 5 |
| apps/node/src/local-usage/checkpointStore.ts | 2 | 2 | 4 |
| apps/node/src/providers/claude/ptyProbe.ts | 2 | 2 | 4 |
| apps/node/src/providers/codex/appServerClient.ts | 2 | 2 | 4 |
| apps/node/src/main/claudeSetup.ts | 1 | 3 | 4 |
| apps/node/src/providers/claude/normalize.ts | 1 | 3 | 4 |
| apps/node/src/providers/codex/normalize.ts | 1 | 3 | 4 |
| apps/node/src/renderer/components/AntigravityAdditionalQuotas.tsx | 1 | 3 | 4 |

fan-in·fan-out은 정규화된 `imports` 관계만 센다.

<a id="evidence-boundary-dependencies"></a>

## 4. 현재 경계 dependency

경계 간 dependency가 관찰되지 않았다.

| source 경계 | target 경계 | confidence | module dependency |
| --- | --- | --- | --- |

<a id="evidence-cycles"></a>

## 5. 강결합 순환군

| 순환군 | confidence | 경계 교차 | module 수 | 경계 | 대표 module |
| --- | --- | --- | --- | --- | --- |
| SCC-01 | candidate | 아니오 | 15 | apps/rust | apps/rust/src/core/engine.rs, apps/rust/src/core/engine/cache.rs, apps/rust/src/core/engine/jobs.rs, apps/rust/src/core/vendor_health.rs, apps/rust/src/shell/desktop.rs |
| SCC-02 | candidate | 아니오 | 4 | apps/rust | apps/rust/src/providers/antigravity.rs, apps/rust/src/providers/claude.rs, apps/rust/src/providers/codex.rs, apps/rust/src/providers/mod.rs |
| SCC-03 | candidate | 아니오 | 3 | apps/rust | apps/rust/src/core/local_usage/claude.rs, apps/rust/src/core/local_usage/codex.rs, apps/rust/src/core/local_usage/mod.rs |

<a id="evidence-entrypoints"></a>

## 6. Entrypoint 정적 도달 범위

| entrypoint | 종류 | resolution | 도달 module | 도달 경계 | 계산 기준 |
| --- | --- | --- | --- | --- | --- |
| apps/node/src/main/application.ts#startApplication | worker | candidate | 43 | 1 | module-dependency-closure |
| apps/node/src/main/application.ts#startApplication.createMainWindow | worker | candidate | 43 | 1 | module-dependency-closure |
| apps/rust/tools/test_collector.rs#test-collector | cli | resolved | 32 | 1 | module-dependency-closure |
| apps/rust/src/lib.rs#llm_usage_monitor_core | library | resolved | 31 | 1 | module-dependency-closure |
| apps/node/src/core/UsageMonitorCore.ts#UsageMonitorCore.initSubscriptions | worker | candidate | 28 | 1 | module-dependency-closure |
| apps/node/src/core/UsageMonitorCore.ts#UsageMonitorCore.subscribe | worker | candidate | 28 | 1 | module-dependency-closure |
| apps/node/src/core/UsageMonitorCore.ts#UsageMonitorCore.trackBackground | http | candidate | 28 | 1 | module-dependency-closure |
| apps/rust/src/bin/main.rs#llm-usage-monitor | cli | resolved | 23 | 1 | module-dependency-closure |
| apps/rust/src/bin/main.rs#main | cli | resolved | 23 | 1 | module-dependency-closure |
| apps/rust/tools/benchmark.rs#benchmark-native | cli | resolved | 21 | 1 | module-dependency-closure |
| apps/rust/tools/cache_fixture.rs#cache-fixture | cli | resolved | 21 | 1 | module-dependency-closure |
| apps/node/src/providers/antigravity/provider.ts#AntigravityQuotaProvider.fetchQuota | http | candidate | 7 | 1 | module-dependency-closure |
| apps/node/src/local-usage/claude/scanner.ts#ClaudeLocalUsageScanner.watch | worker | candidate | 6 | 1 | module-dependency-closure |
| apps/node/src/local-usage/codex/scanner.ts#CodexLocalUsageScanner.watch | worker | candidate | 6 | 1 | module-dependency-closure |
| apps/node/src/providers/codex/appServerClient.ts#CodexAppServerClient.close.finish | http | candidate | 6 | 1 | module-dependency-closure |
| apps/node/src/providers/codex/appServerClient.ts#CodexAppServerClient.receiveLine | http | candidate | 6 | 1 | module-dependency-closure |
| apps/node/src/providers/codex/appServerClient.ts#CodexAppServerClient.request | http | candidate | 6 | 1 | module-dependency-closure |
| apps/node/src/providers/codex/appServerClient.ts#createNodeTransport.onStdout | worker | candidate | 6 | 1 | module-dependency-closure |
| apps/node/src/providers/antigravity/processRunner.ts#AntigravityCliRunner.runCommand | worker | candidate | 5 | 1 | module-dependency-closure |
| apps/node/src/renderer/hooks/useUsageMonitor.ts#useUsageMonitor | worker | candidate | 5 | 1 | module-dependency-closure |
| apps/node/src/usage/localUsageCoordinator.ts#createLocalUsageCoordinator.dirty | http | candidate | 3 | 1 | module-dependency-closure |
| apps/node/src/usage/localUsageCoordinator.ts#createLocalUsageCoordinator.request | http | candidate | 3 | 1 | module-dependency-closure |
| apps/node/src/usage/vendorHealthPoller.ts#createVendorHealthPoller.request | http | candidate | 3 | 1 | module-dependency-closure |
| apps/node/scripts/test-architecture.mjs | http | candidate | 2 | 1 | module-dependency-closure |
| apps/node/src/core/fakeUsage.ts#createFakeUsageStore.subscribe | http | candidate | 2 | 1 | module-dependency-closure |
| apps/node/src/preload/index.ts#subscribe | worker | candidate | 2 | 1 | module-dependency-closure |
| apps/node/src/usage/poller.ts#createUsagePoller.clearTimer | http | candidate | 2 | 1 | module-dependency-closure |
| apps/node/src/usage/poller.ts#createUsagePoller.refreshProvider | http | candidate | 2 | 1 | module-dependency-closure |
| apps/node/src/usage/poller.ts#createUsagePoller.scheduleNext | http | candidate | 2 | 1 | module-dependency-closure |
| apps/node/src/usage/store.ts#createUsageStore.setTaskRefreshing | http | candidate | 2 | 1 | module-dependency-closure |
| apps/node/src/usage/store.ts#createUsageStore.startRefresh | http | candidate | 2 | 1 | module-dependency-closure |
| apps/node/src/usage/store.ts#createUsageStore.subscribe | http | candidate | 2 | 1 | module-dependency-closure |
| apps/node/scripts/check-architecture.mjs#checkArchitecture.visit | http | candidate | 1 | 1 | module-dependency-closure |
| apps/node/scripts/dev.mjs#runDev | worker | candidate | 1 | 1 | module-dependency-closure |
| apps/node/src/main/runtime.ts#registerRendererDiagnostics | worker | candidate | 1 | 1 | module-dependency-closure |
| apps/node/src/main/runtime.ts#registerRuntimeDiagnostics | worker | candidate | 1 | 1 | module-dependency-closure |
| apps/node/src/providers/claude/usageParser.ts#parseClaudeUsageScreen | http | candidate | 1 | 1 | module-dependency-closure |
| scripts/deploy.mjs | worker | candidate | 1 | 1 | module-dependency-closure |
| scripts/diagnostics/benchmark-variants.mjs | worker | candidate | 1 | 1 | module-dependency-closure |

이 수치는 module dependency closure이며 실제 요청 trace가 아니다.

<a id="evidence-change-coupling"></a>

## 7. Git change coupling

| 항목 | 값 |
| --- | --- |
| 상태 | available |
| 사유 | 해당 없음 |
| 분석 commit | 4 |
| 제외 bulk commit | 0 |
| shallow | false |

```mermaid
flowchart LR
  c0["."]
  c1["apps/node"]
  c2["apps/rust"]
  c1 ---|"commits=1 · J=0.500"| c2
  c0 ---|"commits=1 · J=0.333"| c2
  c0 ---|"commits=1 · J=0.250"| c1
```

상위 3개 경계 쌍만 표시했다. 이 관계는 설계 위반의 증명이 아니라 추가 조사 신호다.

<a id="evidence-read-set"></a>

## 8. 우선 read set

| path | symbol·line | 선정 이유 |
| --- | --- | --- |
| apps/node/src/core/UsageMonitorCore.ts | UsageMonitorCore.trackBackground:226-233 | dependency-hub,entrypoint:http:apps/node |
| apps/node/src/local-usage/types.ts |  | dependency-hub |
| apps/node/src/main/application.ts |  | dependency-hub |
| apps/node/src/main/platform/index.ts |  | dependency-hub |
| apps/node/src/preload/index.ts | subscribe:37-48 | entrypoint:worker:apps/node |
| apps/node/src/renderer/App.tsx |  | dependency-hub |
| apps/node/src/renderer/components/CompactQuotaTable.tsx |  | dependency-hub |
| apps/node/src/renderer/components/HelpTrigger.tsx |  | dependency-hub |
| apps/node/src/renderer/components/ProviderCard.tsx |  | dependency-hub |
| apps/node/src/renderer/components/QuotaMeter.tsx |  | dependency-hub |
| apps/node/src/renderer/selectors.ts |  | dependency-hub |
| apps/node/src/shared/index.ts |  | dependency-hub |
| apps/rust/src/core/engine.rs |  | dependency-cycle |
| apps/rust/src/core/local_usage/claude.rs |  | dependency-cycle |
| apps/rust/src/core/local_usage/mod.rs |  | dependency-cycle,dependency-hub |
| apps/rust/src/core/types.rs |  | dependency-hub |
| apps/rust/src/lib.rs |  | entrypoint:library:apps/rust |
| apps/rust/src/providers/antigravity.rs |  | dependency-cycle |
| apps/rust/src/providers/claude.rs |  | dependency-cycle |
| apps/rust/src/ui/mod.rs |  | dependency-cycle,dependency-hub |
| apps/rust/src/ui/theme.rs |  | dependency-hub |
| apps/rust/tools/test_collector.rs |  | entrypoint:cli:apps/rust |
| scripts/deploy.mjs |  | entrypoint:worker:. |

<a id="evidence-diagnostics"></a>

## 9. Capability 제한과 diagnostics

| 수준 | 코드 | 메시지 |
| --- | --- | --- |
| error | source-rust-std-source-unavailable | rust-src를 찾지 못해 rust-analyzer sysroot 로딩을 시작하지 않았습니다. |
| info | non-production-excluded | 기본 구조 집계에서 test·fixture·example module 48개를 제외했습니다. |

## 해석 원칙

- 정적 dependency, 순환, fan-in/out과 change coupling은 조사 우선순위이며 설계 위반의 단독 증거가 아니다.
- Context, Container, 데이터 소유권, 품질 목표와 목표 아키텍처는 이 문서가 생성하지 않는다.
- 평가는 동일 source digest의 인간 검토 문서에서 이 문서의 anchor를 참조해 작성한다.
