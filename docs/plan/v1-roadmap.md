# LLM Usage Monitor v1 로드맵

## 요약

- 목표: Codex·Claude Code의 quota와 로컬 토큰을 보여 주는 Windows 트레이 앱을 완성한다.
- 완료 모습: CSWAP처럼 짧은 시선 이동으로 `5h`·`Weekly`를 읽을 수 있는 TUI형 팝오버와 설치 파일이 동작한다.
- 핵심 접근: Phase별 기능 브랜치와 Step별 커밋을 유지하고, 현재 Phase 4에서 TUI형 화면 기준선을 먼저 고정한 뒤 상태·데이터를 점진적으로 연결한다.
- 검증: 각 Step의 가까운 테스트와 Phase 관문, 실제 provider smoke, 패키지 설치·제거 검사를 통과한다.

quota는 주 정보, 로컬 토큰은 보조 정보며 벤더 CLI가 인증을 소유한다. 여기서 TUI형은 실제 터미널 앱이 아니라 Electron renderer 안에서 고정폭 글꼴, 단순 테두리, 조밀한 행과 텍스트 진행 막대로 정보를 표현하는 시각 방향을 뜻한다.

## 진행 규칙

- Phase별 `feat/phase-<n>-<slug>` 브랜치를 사용한다.
- Step 하나를 검증된 커밋 하나로 남긴다.
- Phase 관문을 통과하고 사용자가 확인한 뒤 `main`에 fast-forward 병합한다.
- 자동 테스트는 fake process·fixture를 사용하고 실제 provider smoke는 별도 명령으로만 실행한다.
- Architecture Guard 활성화·정책 변경은 digest를 제시하고 명시적 승인을 받는다.

## Phase 0 — 제품·저장소 기준선

- [x] quota와 로컬 토큰의 범위를 분리한다.
- [x] Codex·Claude 필수, Gemini 선택 범위를 확정한다.
- [x] 인증 무변조·CLI 소유 규칙을 고정한다.
- [x] Git·Agent·벤치마크 기준선을 커밋한다.

## Phase 1 — Electron 기반과 수직 슬라이스

- [x] Step 1.1 — Node 24·pnpm 9·Electron Forge·Vite·React 단일 패키지를 생성한다.
- [x] Step 1.2 — 모듈 경계 초안을 검토받고 Architecture Guard를 활성화한다.
- [x] Step 1.3 — 공통 snapshot 계약과 제한된 IPC를 구현한다.
- [x] Step 1.4 — fake snapshot으로 트레이 팝오버 수직 슬라이스를 완성한다.

### Phase 1 관문

- [x] typecheck·lint·unit·Electron smoke test를 통과한다.
- [x] Architecture Guard `verify`를 통과한다.
- [x] renderer가 Node·filesystem·임의 IPC에 접근할 수 없다.
- [x] 트레이 열기·refresh·hide·quit 흐름을 확인한다.

## Phase 2 — Codex quota

- [x] Step 2.1 — App Server schema와 필요 JSON-RPC 계약을 확정한다.
- [x] Step 2.2 — Codex App Server 프로세스 어댑터를 구현한다.
- [x] Step 2.3 — quota 창과 오류를 공통 snapshot으로 정규화한다.
- [x] Step 2.4 — UI 연결·fake 통합·실제 읽기 전용 smoke를 검증한다.

## Phase 3 — Claude Code quota

- [x] Step 3.1 — Windows PTY에서 `/usage` 자동화 가능성을 검증한다. 현재 환경은 workspace trust prompt로 차단되며 입력 없이 안전하게 중단한다.
- [x] Step 3.2 — Claude PTY 프로세스 어댑터를 구현한다.
- [x] Step 3.3 — 5시간·주간·모델별 창과 오류를 정규화한다.
- [x] Step 3.4 — native PTY를 Electron 개발·패키지 환경에서 검증한다.

승인된 실행 경계는 고정된 빈 앱 전용 probe 폴더와 최초 1회 사용자 직접 trust다. OAuth 직접 호출, permission bypass와 prompt 자동 승인은 사용하지 않는다.

## Phase 4 — 갱신·stale·cache

- [x] Step 4.1 — provider 격리·병렬 갱신·generation 보호를 구현한다.
- [x] Step 4.2 — CSWAP을 참고한 TUI형 화면 기준선을 구현한다.
  - `5h`·`Weekly`를 provider별 첫 행에 두고 사용률, 남은 비율과 reset을 한 화면에서 읽게 한다.
  - 고정폭 글꼴, 평면 목록, 얇은 진행 막대와 제한된 상태색을 사용하며 장식용 차트·그라데이션·애니메이션은 추가하지 않는다.
  - 420×320에서 Codex·Claude의 핵심 quota가 잘리지 않고, 화면이 CSS 미적용 상태로 보이지 않음을 screenshot smoke로 확인한다.
  - 트레이 재도입 전에는 일반 Windows 창으로 시작하고 닫을 때 종료한다. Vite 개발 CSS는 CSP nonce로 허용하며 packaged CSP의 script·style 출처 제한을 유지한다.
- [ ] Step 4.3 — 60초 polling과 `Retry-After`·상한 900초 backoff를 구현한다.
- [ ] Step 4.4 — 민감정보가 없는 atomic stale cache를 구현한다.
- [ ] Step 4.5 — CLI 소유 refresh와 앱 직접 쓰기 금지를 구분해 문서화한다.

### Phase 4 관문

- [ ] TUI형 팝오버에서 `5h`·`Weekly`와 reset이 첫 화면에 식별된다.
- [ ] screenshot smoke와 420×320 overflow 검사를 통과한다.
- [ ] 429·network·timeout·parser failure에서 마지막 정상값이 stale로 유지된다.
- [ ] 재시작 시 sanitized cache를 복구하며 손상된 cache가 앱 시작을 막지 않는다.

## Phase 5 — 로컬 토큰

- [ ] Step 5.1 — streaming·증분 JSONL 엔진을 구현한다.
- [ ] Step 5.2 — Codex 로컬 토큰 스캐너를 구현한다.
- [ ] Step 5.3 — Claude 로컬 토큰 스캐너를 구현한다.
- [ ] Step 5.4 — watch·reconcile·partial 상태를 UI에 연결한다.

## Phase 6 — TUI형 제품 UI 마감과 Windows 상주 동작

- [ ] Step 6.1 — Phase 4의 TUI형 정보 계층과 밀도를 실제 데이터 상태에 맞게 마감한다.
- [ ] Step 6.2 — fresh·stale·오류·로컬 토큰을 텍스트와 제한된 상태색으로 구별한다.
- [ ] Step 6.3 — 트레이 배치·숨김·refresh·자동 시작 opt-in·quit을 완성한다.
- [ ] Step 6.4 — 다크·라이트·키보드·screen reader·Windows 100%·150% 배율을 검증한다.

Phase 6은 새로운 시각 콘셉트로 다시 디자인하는 단계가 아니다. Phase 4에서 승인된 TUI형 기준선을 유지하고 실제 상태, 트레이 상호작용과 접근성을 완성한다.

## Phase 7 — Windows 설치형 v1

- [ ] Step 7.1 — x64 Squirrel·ASAR integrity·native unpack 패키지를 생성한다.
- [ ] Step 7.2 — clean 환경의 설치·실행·자동 시작·제거를 검증한다.
- [ ] Step 7.3 — 아키텍처·보안·테스트·민감정보 최종 관문을 통과한다.
- [ ] Step 7.4 — README·SHA-256·`v0.1.0` 로컬 release candidate를 완성한다.

## v1 제외 범위

Gemini, 다중 계정, 계정 전환, Claude OAuth 직접 fallback, 비용 추정, 차트, 알림, 코드 서명, 자동 업데이트, CI 릴리스와 원격 게시는 후속 로드맵으로 분리한다.
