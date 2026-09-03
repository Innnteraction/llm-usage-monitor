# Phase 5.5 — Antigravity CLI 재개 계획

## 요약

- 목표: 기존 Codex·Claude 화면을 보존하며 Antigravity quota 선택 확장의 공식 수집 경로를 검증한다.
- 완료 모습: 인증정보 직접 접근 없이 CLI가 제공한 quota만 표시하며, 미설치·출력 변경·실패가 다른 provider를 중단시키지 않는다.
- 핵심 접근: 공식 CLI-direct JSON 보고서를 검증하고 승인된 경계 안에서 Terra medium에게 단계별 구현을 위임한다. v1 필수 수용 범위와 로컬 토큰은 확대하지 않는다.
- 검증: 실제 CLI 계약 확인과 fake fixture 검사를 분리한다. Guard·타입·린트·159개 단위/통합·실제 읽기 전용 smoke와 Antigravity 전용 개발 Electron 5개를 통과했다. 설치 파일·Windows 수동 인수는 별도다.

## 기준선과 진행 상태

이 계획은 개발자가 보류했던 provider 작업을 재개할 때 확인된 근거와 다음 승인·검증 순서를 찾기 위한 기록이다. 2026-09-03 사용자 요청으로 검토를 Phase 7보다 앞당겼다.

- [x] UI 후속 변경을 `0d6081d`로 커밋했다. Guard·타입·린트·128개 단위/통합·14개 개발 Electron·gitleaks 검사를 통과했다.
- [x] 로컬 `agy --version`·`--help`로 1.1.23과 print/text 옵션을 확인했다.
- [x] 공식 문서와 Guard impact를 검토했다. 새 provider 경계는 `approval-required` 판정이다.
- [x] 2026-09-03 아래 정책 초안과 공개 계약 확장을 승인받았다.
- [x] `06e54d1`에서 `feat/phase-5-5-antigravity` 브랜치를 만들었다. Phase 6 수동 검사가 남아 있어 main에서 분기하는 원칙의 승인된 예외로 두며, 두 브랜치를 main에 자동 병합하지 않는다.
- [x] 승인된 정책을 활성화하고 초기 진단 파일 두 개에 대한 새 Guard plan을 생성했다. provider 구현 전에 해당 실제 파일 목록으로 별도 plan을 생성한다.
- [x] `.architecture-guard/plans/antigravity-provider.json`으로 구현 경계를 고정하고 새 위반 없이 검증했다. Terra medium의 코드에서 실행기 종료·미설치 오류·quota 미제공·실패 격리를 검토했다.
- [x] 단위/통합 158개와 실제 production provider smoke 1개를 통과했다. 초기 구조 탐색용 코드는 제거하고 별도 smoke 명령에 성공 여부만 남겼다.
- [x] 수집기를 `cbb1de1`로 커밋했다.
- [x] main의 독립 polling·cache에 등록하고 종료 시 실행 중인 Antigravity 조회를 닫는다. 로컬 scanner는 Codex·Claude만 유지한다.
- [x] 세 번째 TUI 카드에 현재 제공된 모델군별 4개 창을 표시하고 긴 제목은 별도 줄로 분리한다. 계정명·로컬 토큰은 추가하지 않으며 empty 응답은 generic 미제공으로 표시한다.
- [x] fake Electron의 세 카드·스크롤·compact·테마·배율 검증을 완료했다. 기본 2개 provider fixture는 보존했다.

## 확인한 수집 경로와 남은 위험

공식 headless 문서는 `/usage`를 CLI가 직접 처리하는 보고서로 설명한다. 더 구체적인 1.1.11 변경 기록(2026-08-07)은 print 모드의 read-only slash command가 JSON도 지원하며 에이전트 턴, quota 소비, 대화 생성 없이 실행된다고 명시한다. 따라서 텍스트 파싱 대신 `agy --print /usage --output-format json --print-timeout 20s`를 사용한다. streaming input이나 일반 모델 prompt로 전환하지 않으며 slash command를 끄는 옵션은 금지한다. [공식 headless 문서](https://antigravity.google/docs/cli/headless/), [공식 변경 기록](https://antigravity.google/changelog)

`/usage`는 모델 구성과 quota를 backend에서 갱신한다. 공식 Models 문서는 Gemini 모델 그룹과 Claude/GPT 모델 그룹 각각의 주간·5시간 잔여 한도를 설명한다. 이는 Antigravity 내부의 모델 구분이지 별도 Gemini CLI provider의 복원이 아니다. 실제 JSON 필드까지 확인한 창만 매핑하고 reset 카운트다운으로 주기를 역산하지 않는다. [공식 quota 문서](https://antigravity.google/docs/cli/commands/usage), [공식 Models 문서](https://antigravity.google/docs/models/)

빈 probe 디렉터리는 프로젝트 설정의 영향을 줄이는 수단이지 전역 환경 격리의 보장이 아니다. 전역 skill은 다른 디렉터리에서도 로드될 수 있고 hooks는 agent 동작에 연결된다. 전역 plugins·hooks를 이 조회에서 확실히 비활성화하는 공식 실행 옵션은 이번 조사에서 찾지 못했다. [공식 plugins 문서](https://antigravity.google/docs/cli/plugins/)

MCP 설정은 전역과 workspace에 각각 존재한다. 이 앱은 해당 파일을 읽거나 수정하지 않으며 startup 영향이 없다고 단정하지 않는다. [공식 MCP 문서](https://antigravity.google/docs/cli/mcp/)

2026-09-03 현재 PC에서 1.1.24의 JSON 조회가 정상 종료되고 `num_turns`가 0임을 확인했다. 응답은 메모리에서만 검사하고 필드 타입·성공 여부만 출력했다. 최초 1.1.23에서 조사 중 1.1.24, 이후 1.1.25가 관측돼 버전 고정 검사가 중단되기도 했다. 앱은 업데이트 명령을 실행하지 않았으며 변경 원인은 확인되지 않았다. 버전 변경을 계약 검증 결과와 함께 기록한다.

이 결과가 모든 전역 startup 동작의 부재를 증명하는 것은 아니다. 공식 CLI-direct 계약과 현재 응답을 근거로 수집을 구현하되 timeout·출력 상한·프로세스 정리를 적용한다. 미인증·장애는 fake process로 검증하고 현재 로그인 상태를 바꿔 시험하지 않는다. 실제 계정·quota 수치·원문은 저장하지 않으며 credential·비공개 backend·PTY로 자동 우회하지 않는다.

## 승인된 정책·공개 계약 범위

2026-09-03 사용자 승인 후 별도 `.architecture-guard/policy-antigravity.draft.json`의 아래 변경을 활성화했다. 기존 위반 수용 없이 baseline 위반 0개를 확인했다.

| 항목 | 승인 요청 |
| --- | --- |
| 새 경계 | `provider-antigravity`: `src/providers/antigravity/**` |
| 유일한 외부 공개 경로 | `src/providers/antigravity/index.ts` |
| 새 허용 방향 | `provider-antigravity → shared`, `providers → provider-antigravity`, `tests → provider-antigravity` |
| 그대로 금지 | provider 간 직접 의존, renderer/preload의 provider·Node 접근, 인증·설정 직접 접근 |
| 공개 타입 | `ProviderId`에 `antigravity`, `ProviderSource`에 `antigravity_cli` 추가; 기존 IPC method 유지 |
| 로컬 집계 | `LocalUsageProviderId`는 Codex·Claude만 유지; Antigravity에서 calculating/no logs를 거짓 표시하지 않음 |

승인용 draft의 canonical SHA-256은 `f097193b98a169061c1d8f96d7faf6d666a5c964f4de813ce70dbbece75e4e91`이다. 이는 비밀키가 아니라 사용자가 검토한 정책 문서의 변경 여부를 확인하는 식별자다. 활성화 후 digest는 `0310ae79a4a82c0a02bc3150faba4c352d5c935eebc95868587e92ae65b25edd`다.

최초 영향 보고서는 `.architecture-guard/reports/antigravity-resume-impact.md`다. 당시 새 경로가 미분류여서 승인 필요 판정이었다. 활성화 후 `.architecture-guard/plans/antigravity-feasibility.json`은 pass이며 초기 대상은 `tests/smoke/antigravity.smoke.test.ts`와 `vitest.antigravity-smoke.config.mts`다. 공개 계약 확장의 역의존은 main·preload·renderer·usage·local-usage와 관련 테스트까지 이어지므로 후속 구현에서 컴파일과 cache·refresh 회귀를 확인한다. 기존 위반 허용이나 baseline 완화는 하지 않았다.

## 승인 후 구현·검증 순서

1. **실행 계약:** 새 빈 probe cwd와 설치 버전에 대해 독립 headless JSON 호출을 검증한다. timeout·출력 상한·자식 프로세스 정리와 `num_turns: 0`을 확인하고, 공식 CLI-direct 계약과 관측 한계를 구분한다. 알려진 계약과 다른 출력이면 중단한다. 미인증 종료는 fake process로 검증한다.
2. **provider:** Terra medium 1명이 어댑터·정규화와 허구 fixture를 구현한다. 숫자 범위·reset·모델별 ID를 검증하고 미설치·미인증·timeout·출력 변경을 공통 오류로 매핑한다. 실제 원문을 fixture로 반입하지 않는다.
3. **연결:** 앞 단계 리뷰 후 main 등록·shared enum·renderer 이름/source 매핑을 순차 연결한다. Codex·Claude 갱신과 로컬 토큰을 보존하고 Antigravity에는 확인된 모델 quota만 표시한다. 세 provider의 스크롤·compact·tooltip 회귀를 검사하며 창 확대나 새 설정 패널을 임의 추가하지 않는다.
4. **관문:** Guard verify → typecheck → lint → 단위/통합 → fake Electron → 별도 실제 읽기 전용 smoke → diff·민감정보 검사. 실제 계정·원문·수치는 출력하지 않는다. 단계별 검토·커밋은 Sol이 맡고 subagent는 추가 agent나 커밋을 만들지 않는다.

Phase 6의 Narrator·네이티브 트레이·혼합 배율 수동 인수와 Phase 7의 설치·업그레이드·제거는 별도로 남는다. Antigravity의 v1 정식 포함 여부는 실제 계약·선택 카드 검증 뒤 확정한다.

## 화면 연결과 배포 범위

Antigravity 카드는 기존 480×360 팝오버의 세 번째 항목이다. 목록만 세로 스크롤하고 헤더·하단 조작부와 토큰 숨김 시 480×304 크기를 유지한다. 전용 표시 설정이나 계정 관리 UI는 추가하지 않았다. 미설치·미인증은 기존 오류 표현을 사용하고 사용자에게 CLI 자체에서 준비하도록 안내한다.

세 카드 화면 검사에서 숨겨진 `.quota-remaining` 접근성 텍스트의 absolute 배치가 문서 높이를 360px에서 440px로 늘리는 문제를 발견했다. `.quota`를 containing block으로 지정해 텍스트가 해당 게이지의 스크롤 영역 안에 머물게 했다. 시각 디자인과 접근성 설명은 유지하며 문서 높이 검사를 완화하지 않았다.

기본 fake fixture는 기존 두 provider를 유지한다. Antigravity 화면 검사는 `LLM_USAGE_MONITOR_E2E_ANTIGRAVITY`를 명시한 별도 fixture로 실행하며 실제 CLI를 시작하지 않는다. 정상 4개 창, 빈 quota, 오류를 구분하고 실제 수치나 계정은 사용하지 않는다.

진행 중인 개발 서버의 `.vite` 산출물을 패키징으로 덮어쓰지 않기 위해 이번 화면 관문은 개발 Electron으로 실행한다. 새 설치 파일과 packaged smoke는 이번 결과에 포함하지 않고 Phase 7의 배포 관문에 남긴다. 기존 설치 파일에 이 변경이 반영됐다고 간주하지 않는다.

### 최종 검증 기록 — 2026-09-03

- [x] 활성 정책 변경 없이 `antigravity-provider.json` Guard verify를 통과했다.
- [x] `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm test` — 26개 파일·159개 테스트 통과.
- [x] `LLM_USAGE_MONITOR_E2E_DEV=1`에서 `corepack pnpm exec playwright test` — Antigravity 5개와 기존 UI·트레이 14개, 총 19개 통과.
- [x] Antigravity의 dark/light × 100%/150% 화면·툴팁 캡처를 허구 값으로 생성했다. 확대 화면에서도 reset 열·footer가 범위 안에 있고 가로 overflow가 없다.
- [x] production provider의 별도 실제 smoke 1개를 통과했다. 실제 값·계정·응답을 저장하지 않았고 종료 후 남은 `agy` 프로세스가 없음을 확인했다.
- [ ] 최신 packaged 앱·설치·업그레이드·제거, Windows Narrator·혼합 배율 모니터의 수동 인수는 후속 관문에 남는다.
