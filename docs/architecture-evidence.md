<!-- 이 파일은 render-architecture-evidence.py가 생성합니다. 직접 수정하지 마십시오. -->

# 기계 생성 아키텍처 증거

> 정적 분석 결과를 결정적으로 렌더링한 기계 증거다. 평가·권장안이 아니며 런타임 실행 빈도를 나타내지 않는다.

<a id="evidence-snapshot"></a>

## 1. Snapshot과 capability

| 항목 | 값 |
| --- | --- |
| schema version | 1.0.0 |
| source digest | c9a86333cb89f43c1fe3afb6eb63d6e0fd3a77a88f4ff02ccda59e21f10d3774 |
| Git commit | a909896e5079cd3934bbb2b29633c09fdb86b351 |
| dirty | false |
| 선택 scope | production |
| 분석 module | 62 |
| 제외 module | 33 |
| 추출 symbol | 445 |
| entrypoint 관측 | 60 |
| 정규화된 분석 entrypoint | 21 |
| 미포함 nested TypeScript project | 0 |
| 일차 경계 전략 | directory |

capability: architecture-static-summary, call-candidates, entrypoint-discovery, git-change-coupling, module-graph, module-scope-classification, symbol-index, typescript-compiler-api

<a id="evidence-coverage"></a>

## 2. Coverage와 edge 처리 단계

| 단계 | 결과 | 기계적 정의 |
| --- | --- | --- |
| 원시 edge 관측 | 5,925 | 정적 분석기가 기록한 전체 관계 관측 |
| 구조 의존 edge 관측 | 5,442 | 원시 관측 중 imports·calls·registers |
| package-root 내부 재분류 관측 | 0 | 구조 의존 관측 중 알려진 내부 module prefix와 일치한 부분집합 |
| 정규화된 module dependency | 85 | 내부 source·target 확인, self-edge 제외, source·target·type·resolution 중복 제거 |
| 경계 내부 module dependency | 52 | source와 target의 일차 경계가 같은 정규화 관계 |
| 경계 간 module dependency | 33 | source와 target의 일차 경계가 다른 정규화 관계 |
| 경계 쌍 집계 행 | 9 | source 경계·target 경계·confidence별 집계 행 |

`원시 관측 5,925 → 의존 유형 선별 5,442 → 내부 판정·self-edge 제외·중복 제거 → module dependency 85`

내부 재분류 관측은 구조 의존 관측의 부분집합이므로 별도 graph 크기로 더하거나 빼지 않는다.

| 관계 유형 | 원시 관측 | 정규화된 내부 module dependency |
| --- | --- | --- |
| calls | 5,139 | 20 |
| contains | 445 | 0 |
| exports | 38 | 0 |
| imports | 245 | 65 |
| registers | 58 | 0 |

<a id="evidence-boundaries"></a>

## 3. 경계별 구조 집계

| 경계 | module | 내부 dependency | inbound | outbound |
| --- | --- | --- | --- | --- |
| src/providers | 15 | 19 | 6 | 6 |
| (analysis-root-files) | 10 | 0 | 0 | 0 |
| src/local-usage | 10 | 13 | 1 | 3 |
| src/main | 10 | 11 | 0 | 16 |
| src/renderer | 9 | 8 | 0 | 3 |
| src/usage | 4 | 0 | 4 | 4 |
| src/shared | 3 | 1 | 22 | 0 |
| src/preload | 1 | 0 | 0 | 1 |

<a id="evidence-module-hubs"></a>

### Module dependency hub

| module | import fan-in | import fan-out | 합계 |
| --- | --- | --- | --- |
| src/shared/index.ts | 20 | 0 | 20 |
| src/main/application.ts | 1 | 11 | 12 |
| src/local-usage/types.ts | 5 | 1 | 6 |
| src/local-usage/claude/scanner.ts | 0 | 5 | 5 |
| src/local-usage/codex/scanner.ts | 0 | 5 | 5 |
| src/renderer/App.tsx | 0 | 5 | 5 |
| src/providers/claude/normalize.ts | 1 | 3 | 4 |
| src/providers/codex/normalize.ts | 1 | 3 | 4 |
| src/providers/codex/provider.ts | 0 | 4 | 4 |
| src/providers/codex/protocol.ts | 3 | 0 | 3 |
| src/local-usage/checkpointStore.ts | 2 | 1 | 3 |
| src/providers/claude/ptyProbe.ts | 2 | 1 | 3 |
| src/providers/codex/appServerClient.ts | 2 | 1 | 3 |
| src/renderer/components/HelpTrigger.tsx | 2 | 1 | 3 |
| src/main/claudeSetup.ts | 1 | 2 | 3 |
| src/renderer/components/Footer.tsx | 1 | 2 | 3 |
| src/providers/antigravity/provider.ts | 0 | 3 | 3 |
| src/providers/claude/provider.ts | 0 | 3 | 3 |
| src/local-usage/streamJsonl.ts | 2 | 0 | 2 |
| src/providers/claude/usageParser.ts | 2 | 0 | 2 |
| src/providers/index.ts | 2 | 0 | 2 |
| src/renderer/presentation.ts | 2 | 0 | 2 |
| src/local-usage/claude/parser.ts | 1 | 1 | 2 |
| src/local-usage/codex/parser.ts | 1 | 1 | 2 |
| src/main/fakeUsage.ts | 1 | 1 | 2 |

fan-in·fan-out은 정규화된 `imports` 관계만 센다.

<a id="evidence-boundary-dependencies"></a>

## 4. 현재 경계 dependency

```mermaid
flowchart LR
  b0["src/local-usage<br/>modules=10"]
  b1["src/main<br/>modules=10"]
  b2["src/preload<br/>modules=1"]
  b3["src/providers<br/>modules=15"]
  b4["src/renderer<br/>modules=9"]
  b5["src/shared<br/>modules=3"]
  b6["src/usage<br/>modules=4"]
  b1 -->|"6 · confirmed"| b3
  b3 -->|"6 · confirmed"| b5
  b1 -->|"5 · confirmed"| b5
  b1 -->|"4 · confirmed"| b6
  b6 -->|"4 · confirmed"| b5
  b0 -->|"3 · confirmed"| b5
  b4 -->|"3 · confirmed"| b5
  b1 -->|"1 · confirmed"| b0
  b2 -->|"1 · confirmed"| b5
```

상위 9개 집계 행만 표시했다. 실선은 confirmed, 점선은 uncertain이며 수치는 정규화된 module dependency 수다.

| source 경계 | target 경계 | confidence | module dependency |
| --- | --- | --- | --- |
| src/main | src/providers | confirmed | 6 |
| src/providers | src/shared | confirmed | 6 |
| src/main | src/shared | confirmed | 5 |
| src/main | src/usage | confirmed | 4 |
| src/usage | src/shared | confirmed | 4 |
| src/local-usage | src/shared | confirmed | 3 |
| src/renderer | src/shared | confirmed | 3 |
| src/main | src/local-usage | confirmed | 1 |
| src/preload | src/shared | confirmed | 1 |

<a id="evidence-cycles"></a>

## 5. 강결합 순환군

강결합 순환군이 관찰되지 않았다.

<a id="evidence-entrypoints"></a>

## 6. Entrypoint 정적 도달 범위

| entrypoint | 종류 | resolution | 도달 module | 도달 경계 | 계산 기준 |
| --- | --- | --- | --- | --- | --- |
| src/main/application.ts#startApplication | worker | candidate | 25 | 5 | module-dependency-closure |
| src/main/application.ts#startApplication.trackBackground | http | candidate | 25 | 5 | module-dependency-closure |
| src/renderer/App.tsx#App | worker | candidate | 9 | 2 | module-dependency-closure |
| src/local-usage/claude/scanner.ts#ClaudeLocalUsageScanner.watch | worker | candidate | 6 | 2 | module-dependency-closure |
| src/local-usage/codex/scanner.ts#CodexLocalUsageScanner.watch | worker | candidate | 6 | 2 | module-dependency-closure |
| src/providers/antigravity/provider.ts#AntigravityQuotaProvider.fetchQuota | http | candidate | 4 | 2 | module-dependency-closure |
| src/usage/localUsageCoordinator.ts#createLocalUsageCoordinator.dirty | http | candidate | 3 | 2 | module-dependency-closure |
| src/usage/localUsageCoordinator.ts#createLocalUsageCoordinator.request | http | candidate | 3 | 2 | module-dependency-closure |
| src/main/fakeUsage.ts#createFakeUsageStore.subscribe | http | candidate | 2 | 2 | module-dependency-closure |
| src/preload/index.ts#subscribe | worker | candidate | 2 | 2 | module-dependency-closure |
| src/providers/codex/appServerClient.ts#CodexAppServerClient.close.finish | http | candidate | 2 | 1 | module-dependency-closure |
| src/providers/codex/appServerClient.ts#CodexAppServerClient.receiveLine | http | candidate | 2 | 1 | module-dependency-closure |
| src/providers/codex/appServerClient.ts#CodexAppServerClient.request | http | candidate | 2 | 1 | module-dependency-closure |
| src/providers/codex/appServerClient.ts#createNodeTransport.onStdout | worker | candidate | 2 | 1 | module-dependency-closure |
| src/usage/poller.ts#createUsagePoller.clearTimer | http | candidate | 2 | 2 | module-dependency-closure |
| src/usage/poller.ts#createUsagePoller.refreshProvider | http | candidate | 2 | 2 | module-dependency-closure |
| src/usage/poller.ts#createUsagePoller.scheduleNext | http | candidate | 2 | 2 | module-dependency-closure |
| src/usage/store.ts#createUsageStore.startRefresh | http | candidate | 2 | 2 | module-dependency-closure |
| src/usage/store.ts#createUsageStore.subscribe | http | candidate | 2 | 2 | module-dependency-closure |
| src/providers/antigravity/processRunner.ts#AntigravityCliRunner.runCommand | worker | candidate | 1 | 1 | module-dependency-closure |
| src/providers/claude/usageParser.ts#parseClaudeUsageScreen | http | candidate | 1 | 1 | module-dependency-closure |

이 수치는 module dependency closure이며 실제 요청 trace가 아니다.

<a id="evidence-change-coupling"></a>

## 7. Git change coupling

| 항목 | 값 |
| --- | --- |
| 상태 | available |
| 사유 | 해당 없음 |
| 분석 commit | 50 |
| 제외 bulk commit | 0 |
| shallow | false |

```mermaid
flowchart LR
  c0["(analysis-root-files)"]
  c1["src/local-usage"]
  c2["src/main"]
  c3["src/preload"]
  c4["src/providers"]
  c5["src/renderer"]
  c6["src/shared"]
  c7["src/usage"]
  c2 ---|"commits=21 · J=0.600"| c5
  c5 ---|"commits=9 · J=0.360"| c6
  c0 ---|"commits=9 · J=0.257"| c2
  c2 ---|"commits=7 · J=0.212"| c6
  c3 ---|"commits=6 · J=0.240"| c5
  c2 ---|"commits=6 · J=0.194"| c3
  c0 ---|"commits=6 · J=0.188"| c5
  c2 ---|"commits=6 · J=0.150"| c4
  c3 ---|"commits=5 · J=0.500"| c6
  c2 ---|"commits=5 · J=0.152"| c7
  c4 ---|"commits=5 · J=0.143"| c5
  c0 ---|"commits=4 · J=0.167"| c4
  c5 ---|"commits=4 · J=0.143"| c7
  c4 ---|"commits=3 · J=0.143"| c6
  c0 ---|"commits=2 · J=0.118"| c3
  c0 ---|"commits=2 · J=0.100"| c6
  c4 ---|"commits=2 · J=0.100"| c7
  c1 ---|"commits=1 · J=0.077"| c6
  c6 ---|"commits=1 · J=0.067"| c7
  c0 ---|"commits=1 · J=0.053"| c7
```

상위 20개 경계 쌍만 표시했다. 이 관계는 설계 위반의 증명이 아니라 추가 조사 신호다.

<a id="evidence-read-set"></a>

## 8. 우선 read set

| path | symbol·line | 선정 이유 |
| --- | --- | --- |
| src/local-usage/checkpointStore.ts |  | dependency-hub |
| src/local-usage/claude/scanner.ts | ClaudeLocalUsageScanner.watch:326-337 | dependency-hub,entrypoint:worker:src/local-usage |
| src/local-usage/codex/scanner.ts |  | dependency-hub |
| src/local-usage/types.ts |  | dependency-hub |
| src/main/application.ts | startApplication.trackBackground:345-352 | dependency-hub,entrypoint:http:src/main,entrypoint:worker:src/main |
| src/main/claudeSetup.ts |  | dependency-hub |
| src/preload/index.ts | subscribe:33-44 | entrypoint:worker:src/preload |
| src/providers/antigravity/provider.ts | AntigravityQuotaProvider.fetchQuota:91-127 | entrypoint:http:src/providers |
| src/providers/claude/normalize.ts |  | dependency-hub |
| src/providers/claude/ptyProbe.ts |  | dependency-hub |
| src/providers/codex/appServerClient.ts | createNodeTransport.onStdout:94-96 | dependency-hub,entrypoint:worker:src/providers |
| src/providers/codex/normalize.ts |  | dependency-hub |
| src/providers/codex/protocol.ts |  | dependency-hub |
| src/providers/codex/provider.ts |  | dependency-hub |
| src/renderer/App.tsx | App:671-995 | dependency-hub,entrypoint:worker:src/renderer |
| src/renderer/components/HelpTrigger.tsx |  | dependency-hub |
| src/shared/index.ts |  | dependency-hub |
| src/usage/localUsageCoordinator.ts | createLocalUsageCoordinator.dirty:89-100 | entrypoint:http:src/usage |

<a id="evidence-diagnostics"></a>

## 9. Capability 제한과 diagnostics

| 수준 | 코드 | 메시지 |
| --- | --- | --- |
| info | non-production-excluded | 기본 구조 집계에서 test·fixture·example module 33개를 제외했습니다. |

## 해석 원칙

- 정적 dependency, 순환, fan-in/out과 change coupling은 조사 우선순위이며 설계 위반의 단독 증거가 아니다.
- Context, Container, 데이터 소유권, 품질 목표와 목표 아키텍처는 이 문서가 생성하지 않는다.
- 평가는 동일 source digest의 인간 검토 문서에서 이 문서의 anchor를 참조해 작성한다.
