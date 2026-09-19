# 네이티브 동일성 복원 P0~P5

## 요약
- 목표: Electron 디자인·동작을 Rust/GPUI로 동일하게 재현한다.
- 완료 모습: 같은 환경·데이터·입력에서 글자 가장자리 안티앨리어싱 외 차이가 없다.
- 핵심 접근: 6d42382에 보존된 Electron 소스를 정본으로 고정한다.
- 검증: 단계별 실행 빌드, 화면·동작 증거, 회귀 테스트와 독립 커밋.

| 단계 | 결과물 | 상태 / 완료 조건 |
| --- | --- | --- |
| P0 기준 고정 | 대응표, 공통 snapshot/고정 시각, Electron 기준 화면 | 진행 중. 기준 캡처와 공통 입력 재현 필요 |
| P1 기본 화면 | 상세/간략 × 라이트/다크 실행 화면 및 비교 | 대기. 배치·크기·문구·콘텐츠 높이 동일 |
| P2 상태·입력 | 실패/갱신/도움말 화면, 마우스·키보드 시나리오 | 대기. 상태와 입력 결과 동일 |
| P3 OS 통합 | 트레이·창·CLI 설정·시작 프로그램 시험 빌드 | 대기. 실제 항상 위, 위치, 재열기, 설정 상태 동일 |
| P4 플랫폼 수용 | Windows/macOS 화면·동작 증거 | 대기. 배율/다중 모니터/Retina 실기 확인 |
| P5 전환 판정 | 성능 보고서, 사용자 검수, 전환·복구 절차 | 대기. 기존 성능 목표 또는 별도 합의 및 최종 검수 |

각 단계는 구현 → 검증 → 결과 문서 → 커밋으로 마감한다. 미검증 단계는 완료로 표시하지 않으며 독립적인 다음 작업은 계속 진행한다. 기존 M4는 동일성 복원 진행 중, M5는 최종 수용 대기다. main 병합·배포 전환은 P5 수용 전 수행하지 않는다.

## P0 대응표
| 사용자 관찰 항목 | Electron 정본 | 검증 시나리오 / 담당 단계 |
| --- | --- | --- |
| 글꼴·색·간격·아이콘 | renderer/styles.css, icons.tsx | 상세/간략, light/dark, 동일 OS·배율 / P1 |
| 제목 갱신·버튼 | Header.tsx | 제목 클릭, 중복 갱신 방지, 400ms 점 변화 / P2 |
| 표시 quota 선택 | selectors.ts | Codex weekly, Claude 5h/weekly/Fable, AGY 정해진 ID / P1 |
| 추가 제한 | ProviderCard.tsx | 확장/축소, reserve 제외, 긴 라벨 / P2 |
| 로컬 토큰 | LocalUsageView.tsx | input/output/cache, partial, 날짜, no logs / P1·P2 |
| 오류·stale·미제공 | selectors.ts, QuotaMeter.tsx | 실패 코드, 이전 값, 30분 stale, reset pending / P2 |
| compact 셀과 오류 확장 | CompactQuotaTable.tsx | provider 아이콘, 셀, 클릭 오류 표시 / P1·P2 |
| 도움말 | HelpTrigger.tsx, presentation.ts | hover/focus/click, 창 이탈, 스크롤, 경계 보정 / P2 |
| 테마·단축키 | useUsageMonitor.ts | 시스템 초기값, 2단계 토글, Ctrl/Meta+Shift+C/L/P / P2 |
| 동적 높이 | useWindowAutoResize.ts, application.ts | 480px 폭, 내용 변경, 작업영역 clamp / P1·P3 |
| 드래그·pin·Escape·blur | application.ts | pin 시 항상 위, pin 상태 Escape는 도움말만 닫음 / P3 |
| 트레이·종료·시작 프로그램 | trayMenu.ts, main/platform | 메뉴 순서·체크 상태·실패 복구 / P3 |
| CLI 설정·계정 전환 | claudeSetup.ts, antigravitySetup.ts | 기존 사용자 클릭 경로, 인증 직접 접근 금지 / P3 |
| 외부 상태 링크 | App.tsx, ipc.ts | http/https 허용·오류 표시 / P3 |
| 설정 수명 | useUsageMonitor.ts, application.ts | compact/theme 세션 상태, pin 저장, 재생성 / P3 |

## 기준과 구현의 충돌

정본 CompactQuotaTable.tsx는 Codex 5h를 무조건 Unlimited/∞로 표시한다. 이는 AGENTS.md의 벤더 미제공 quota를 무제한으로 표시하지 않는 규칙과 충돌한다. 해당 표현은 그대로 이식하지 않는다. 제공된 값은 표시하고 미제공은 미제공으로 유지한다. 이 차이는 P4 완전 동일 판정의 명시적 차단 항목이며 임의로 예외 승인 처리하지 않는다.

## 실행 기록

- `node scripts/capture-native-reference.mjs`: 현재 Electron fake provider를 실행하고 snapshot.json, 4개 PNG, metrics.json을 `.work/parity-reference`에 저장한다. 네이티브는 `--demo-snapshot=<snapshot.json>`으로 같은 snapshot과 updatedAt 시각을 사용한다. fixture가 잘못되면 exit 2이며 실제 수집으로 전환하지 않는다.
- 최초 Electron 캡처: Target crashed. 재시도 로그에서 GPU 프로세스 종료와 startup-failed 확인.
- `pnpm package`: Vite main/preload/renderer 빌드는 성공. 기존 사용 중인 out/.../app.asar 잠금 때문에 패키징은 EBUSY 실패. 사용자의 실행 중인 앱을 종료하지 않았다.
- 승인된 기존 아키텍처 baseline은 유지한다. Rust UI→정규화 타입, app→UI/core/shell 경계 안에서 진행한다. 신규 native UI presentation/icon 모듈을 계획에 포함했고 영향 검사 통과. Electron 제품 소스는 수정하지 않는다.

P0 자동 검증: 아키텍처 verify와 Rust 17개 테스트 통과. `--snapshot-only`는 정본 createFakeUsageStore를 2026-09-19T12:00:00Z에 실행하여 공통 JSON을 생성한다. GUI 캡처는 재시도 후에도 페이지 종료/타임아웃이 발생하여 기준 PNG는 아직 확보하지 못했다. P0는 완료로 판정하지 않고 입력·기준 계약만 먼저 커밋한다.
