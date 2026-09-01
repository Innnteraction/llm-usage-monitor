# LLM Usage Monitor v1 로드맵

## 요약

이 문서는 Windows 설치형 v1을 Phase별로 구현하는 진행 체크리스트다. 각 Step은 검증과 커밋까지 끝나야 완료로 표시하고, Phase 종료 시 사용자 확인 후 다음 Phase로 이동한다. quota는 주 정보, 로컬 토큰은 보조 정보며 벤더 CLI가 인증을 소유한다.

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
- [ ] Step 3.2 — Claude PTY 프로세스 어댑터를 구현한다.
- [ ] Step 3.3 — 5시간·주간·모델별 창과 오류를 정규화한다.
- [ ] Step 3.4 — native PTY를 Electron 개발·패키지 환경에서 검증한다.

Phase 3은 workspace trust를 변조하지 않는 실행 경계를 별도로 승인하기 전까지 Step 3.1 관문에서 중단한다. OAuth 직접 호출과 permission bypass로 자동 전환하지 않는다.

## Phase 4 — 갱신·stale·cache

- [ ] Step 4.1 — provider 격리·병렬 갱신·generation 보호를 구현한다.
- [ ] Step 4.2 — 60초 polling과 `Retry-After`·상한 900초 backoff를 구현한다.
- [ ] Step 4.3 — 민감정보가 없는 atomic stale cache를 구현한다.
- [ ] Step 4.4 — CLI 소유 refresh와 앱 직접 쓰기 금지를 구분해 문서화한다.

## Phase 5 — 로컬 토큰

- [ ] Step 5.1 — streaming·증분 JSONL 엔진을 구현한다.
- [ ] Step 5.2 — Codex 로컬 토큰 스캐너를 구현한다.
- [ ] Step 5.3 — Claude 로컬 토큰 스캐너를 구현한다.
- [ ] Step 5.4 — watch·reconcile·partial 상태를 UI에 연결한다.

## Phase 6 — 제품 UI와 Windows 상주 동작

- [ ] Step 6.1 — 420×600 quota 중심 카드를 완성한다.
- [ ] Step 6.2 — stale·오류·로컬 토큰 상태를 완성한다.
- [ ] Step 6.3 — 트레이 배치·숨김·refresh·자동 시작 opt-in·quit을 완성한다.
- [ ] Step 6.4 — 다크·라이트·키보드·screen reader 접근성을 검증한다.

## Phase 7 — Windows 설치형 v1

- [ ] Step 7.1 — x64 Squirrel·ASAR integrity·native unpack 패키지를 생성한다.
- [ ] Step 7.2 — clean 환경의 설치·실행·자동 시작·제거를 검증한다.
- [ ] Step 7.3 — 아키텍처·보안·테스트·민감정보 최종 관문을 통과한다.
- [ ] Step 7.4 — README·SHA-256·`v0.1.0` 로컬 release candidate를 완성한다.

## v1 제외 범위

Gemini, 다중 계정, 계정 전환, Claude OAuth 직접 fallback, 비용 추정, 차트, 알림, 코드 서명, 자동 업데이트, CI 릴리스와 원격 게시는 후속 로드맵으로 분리한다.
