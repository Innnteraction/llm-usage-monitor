# Phase 5.5 — Antigravity CLI 재개 계획

## 요약

- 목표: 기존 Codex·Claude 화면을 보존하며 Antigravity quota 선택 확장의 공식 수집 경로를 검증한다.
- 완료 모습: 인증정보 직접 접근 없이 CLI가 제공한 quota만 표시하며, 미설치·출력 변경·실패가 다른 provider를 중단시키지 않는다.
- 핵심 접근: 공식 headless 보고서를 우선 조사하고 정책 승인 후 Terra medium에게 단계별 구현을 위임한다. v1 필수 수용 범위와 로컬 토큰은 확대하지 않는다.
- 검증: 실제 CLI 계약 확인과 fake fixture 검사를 분리하고 Guard·타입·린트·통합·Electron·민감정보 관문을 통과한다. 현재는 정책 승인 대기이며 실계정 smoke는 미실행이다.

## 기준선과 진행 상태

이 계획은 개발자가 보류했던 provider 작업을 재개할 때 확인된 근거와 다음 승인·검증 순서를 찾기 위한 기록이다. 2026-09-03 사용자 요청으로 검토를 Phase 7보다 앞당겼다.

- [x] UI 후속 변경을 `0d6081d`로 커밋했다. Guard·타입·린트·128개 단위/통합·14개 개발 Electron·gitleaks 검사를 통과했다.
- [x] 로컬 `agy --version`·`--help`로 1.1.23과 print/text 옵션을 확인했다.
- [x] 공식 문서와 Guard impact를 검토했다. 새 provider 경계는 `approval-required` 판정이다.
- [ ] 아래 정책 초안과 공개 계약 확장을 승인받는다.
- [ ] 승인 후 `0d6081d`를 포함한 현재 커밋에서 `feat/phase-5-5-antigravity` 브랜치를 만든다. Phase 6 수동 검사가 남아 있으므로 이번에는 main에서 분기하는 원칙의 명시적 예외로 두며, 두 브랜치를 main에 자동 병합하지 않는다.
- [ ] 승인된 정책을 활성화하고 실제 파일 목록으로 새 Guard plan을 생성한 뒤 구현한다.

## 확인한 수집 경로와 남은 위험

공식 headless 문서는 `/usage`를 CLI가 직접 처리하는 text report로 설명한다. streaming input에 넣지 않고 독립 `agy --print /usage` 호출로 실행하는 경로를 우선 검증한다. 일반 print prompt와 혼동하지 않으며, slash command 처리를 끄는 옵션은 사용하지 않는다. 미인증 headless의 실패 계약도 확인 대상이다. [공식 headless 문서](https://antigravity.google/docs/cli/headless/)

`/usage`는 모델 구성과 quota를 backend에서 갱신한다. 공식 quota 안내는 모델별 잔여량을 설명하지만 고정 5시간·주간 창을 보장하지 않는다. 출력에서 창 의미를 확인하지 못하면 `other`를 사용하고 reset 카운트다운으로 주기를 역산하지 않는다. [공식 quota 문서](https://antigravity.google/docs/cli/commands/usage)

빈 probe 디렉터리는 프로젝트 설정의 영향을 줄이는 수단이지 전역 환경 격리의 보장이 아니다. 전역 skill은 다른 디렉터리에서도 로드될 수 있고 hooks는 agent 동작에 연결된다. 전역 plugins·hooks를 이 조회에서 확실히 비활성화하는 공식 실행 옵션은 이번 조사에서 찾지 못했다. [공식 plugins 문서](https://antigravity.google/docs/cli/plugins/)

MCP 설정은 전역과 workspace에 각각 존재한다. 이 앱은 해당 파일을 읽거나 수정하지 않으며 startup 영향이 없다고 단정하지 않는다. [공식 MCP 문서](https://antigravity.google/docs/cli/mcp/)

문서는 CLI 직접 보고서 경로를 뒷받침하지만 현재 PC의 실제 응답, 로그인 상태, startup 동작과 모델 요청 부재를 대신 검증하지 않는다. 그래서 현재 Step 5.5.1은 완료가 아니다. 실제 출력은 메모리에서만 검사하고 계정·quota 수치·원문을 로그나 저장소에 남기지 않는다. 안전성을 확인하지 못하면 중단하며 credential·비공개 backend·PTY로 자동 우회하지 않는다.

## 정책·공개 계약 승인 요청

활성 정책과 baseline은 변경하지 않았다. 별도 `.architecture-guard/policy-antigravity.draft.json`에 다음 차이만 둔다.

| 항목 | 승인 요청 |
| --- | --- |
| 새 경계 | `provider-antigravity`: `src/providers/antigravity/**` |
| 유일한 외부 공개 경로 | `src/providers/antigravity/index.ts` |
| 새 허용 방향 | `provider-antigravity → shared`, `providers → provider-antigravity`, `tests → provider-antigravity` |
| 그대로 금지 | provider 간 직접 의존, renderer/preload의 provider·Node 접근, 인증·설정 직접 접근 |
| 공개 타입 | `ProviderId`에 `antigravity`, `ProviderSource`에 `antigravity_cli` 추가; 기존 IPC method 유지 |
| 로컬 집계 | `LocalUsageProviderId`는 Codex·Claude만 유지; Antigravity에서 calculating/no logs를 거짓 표시하지 않음 |

승인용 draft의 canonical SHA-256은 `f097193b98a169061c1d8f96d7faf6d666a5c964f4de813ce70dbbece75e4e91`이다. 이는 비밀키가 아니라 사용자가 검토한 정책 문서의 변경 여부를 확인하는 식별자다. 활성 정책 digest는 `1638370e436107db9446b17a94e715528e8a5fdbec63b1e5a3856b2e655483b0`로 유지된다.

영향 보고서는 `.architecture-guard/reports/antigravity-resume-impact.md`다. 현재 새 경로가 미분류여서 승인 필요 판정이며 기존 위반은 없다. 계약의 역의존은 main·preload·renderer·usage·local-usage와 관련 테스트까지 이어지므로 컴파일과 cache·refresh 회귀도 확인해야 한다. 기존 위반 허용이나 baseline 완화는 요청하지 않는다.

## 승인 후 구현·검증 순서

1. **실행 계약:** 고정된 빈 probe cwd와 설치 버전에 대해 독립 headless 호출을 검증한다. timeout·출력 상한·자식 프로세스 정리, 미인증 종료, 모델 turn/도구 동작 부재를 확인한다. 전역 startup 위험이 해소되지 않으면 이 단계에서 멈춘다.
2. **provider:** Terra medium 1명이 어댑터·정규화와 허구 fixture를 구현한다. 숫자 범위·reset·모델별 ID를 검증하고 미설치·미인증·timeout·출력 변경을 공통 오류로 매핑한다. 실제 원문을 fixture로 반입하지 않는다.
3. **연결:** 앞 단계 리뷰 후 main 등록·shared enum·renderer 이름/source 매핑을 순차 연결한다. Codex·Claude 갱신과 로컬 토큰을 보존하고 Antigravity에는 확인된 모델 quota만 표시한다. 세 provider의 스크롤·compact·tooltip 회귀를 검사하며 창 확대나 새 설정 패널을 임의 추가하지 않는다.
4. **관문:** Guard verify → typecheck → lint → 단위/통합 → fake Electron → 별도 실제 읽기 전용 smoke → diff·민감정보 검사. 실제 계정·원문·수치는 출력하지 않는다. 단계별 검토·커밋은 Sol이 맡고 subagent는 추가 agent나 커밋을 만들지 않는다.

Phase 6의 Narrator·네이티브 트레이·혼합 배율 수동 인수와 Phase 7의 설치·업그레이드·제거는 별도로 남는다. Antigravity의 v1 정식 포함 여부는 실제 계약·선택 카드 검증 뒤 확정한다.
