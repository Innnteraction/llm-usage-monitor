# LLM Usage Monitor v1 로드맵

## 요약

- 목표: Codex·Claude Code의 quota와 로컬 토큰을 보여 주고 Antigravity quota를 선택적으로 추가할 수 있는 Windows 트레이 앱을 완성한다.
- 완료 모습: CSWAP처럼 짧은 시선 이동으로 `5h`·`Weekly`를 읽고 각 provider 아래에서 이 PC의 로컬 토큰 합계를 보조 정보로 확인할 수 있는 TUI형 팝오버와 설치 파일이 동작한다.
- 핵심 접근: Phase별 기능 브랜치와 Step별 커밋을 유지하고, quota·로컬 토큰·선택 provider를 분리된 경계와 검증 관문으로 점진적으로 연결한다.
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
- [x] Codex·Claude 필수, Antigravity 선택 범위를 확정한다.
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

기본 실행 경계는 고정된 빈 앱 전용 probe 폴더와 최초 1회 사용자 직접 trust다. 구독 OAuth token과 credential은 직접 읽거나 비공개 usage API에 중계하지 않으며 permission bypass와 prompt 자동 승인을 사용하지 않는다.

## Phase 4 — 갱신·stale·cache

- [x] Step 4.1 — provider 격리·병렬 갱신·generation 보호를 구현한다.
- [x] Step 4.2 — CSWAP을 참고한 TUI형 화면 기준선을 구현한다.
  - `5h`·`Weekly`를 provider별 첫 행에 두고 사용률, 남은 비율과 reset을 한 화면에서 읽게 한다.
  - 고정폭 글꼴, 평면 목록, 얇은 진행 막대와 제한된 상태색을 사용하며 장식용 차트·그라데이션·애니메이션은 추가하지 않는다.
  - 420×320에서 Codex·Claude의 핵심 quota가 잘리지 않고, 화면이 CSS 미적용 상태로 보이지 않음을 screenshot smoke로 확인한다.
  - 트레이 재도입 전에는 일반 Windows 창으로 시작하고 닫을 때 종료한다. Vite 개발 CSS는 CSP nonce로 허용하며 packaged CSP의 script·style 출처 제한을 유지한다.
  - Codex는 계정 `7d`를 기본 표시하고 Spark `5h`·`7d`는 후속 옵션용으로 보존·접는다. Claude는 `5h`·`7d`와 CLI가 제공한 Fable 주간 창을 표시하며, Fable이 없으면 미제공 상태를 표시한다.
  - provider 이름 옆에 현재 구독 계정을 표시하고 갱신 시각은 AM/PM 형식으로 통일한다. 계정 식별자는 로그·오류·stale cache에 저장하지 않는다.
- [x] Step 4.3 — 60초 polling과 `Retry-After`·상한 900초 backoff를 구현한다.
  - provider별 timer를 독립적으로 유지하고 성공 시 60초로 복귀한다.
  - 실패 시 60·120·240·480·900초로 늘리며 미래의 `retryAt`이 있으면 그 시각을 우선한다.
  - 진행 중인 provider에 반복 refresh가 들어오면 현재 요청 뒤의 후속 실행 한 번으로 합친다.
- [x] Step 4.4 — 민감정보가 없는 atomic stale cache를 구현한다.
  - 마지막 정상 quota를 실패 시 stale로 유지하고 재시작 시 앱 전용 userData에서 복구한다.
  - cache는 schema version을 검증하고 임시 파일을 완전히 쓴 뒤 rename한다.
  - 계정 식별자와 과거 오류 메시지는 저장하지 않으며 손상·구버전 cache는 앱 시작을 막지 않고 폐기한다.
- [x] Step 4.5 — CLI 소유 refresh와 앱 직접 쓰기 금지를 구분해 문서화한다.
  - 앱 코드의 vendor credential 직접 접근은 금지하고 정적 계약 테스트로 검사한다.
  - 벤더 CLI 자체 refresh는 인증 소유자의 동작으로 허용하며 파일 동일성 검사는 opt-in 직접 읽기 fallback에만 적용한다.

### Phase 4 관문

- [x] TUI형 팝오버에서 Codex `7d`, Claude `5h`·`7d`와 reset이 첫 화면에 식별되며 Fable 제공 여부를 숨기지 않는다.
- [x] screenshot smoke와 420×320 overflow 검사를 통과한다.
- [x] 429·network·timeout·parser failure에서 마지막 정상값이 stale로 유지된다.
- [x] 재시작 시 sanitized cache를 복구하며 손상된 cache가 앱 시작을 막지 않는다.

## Phase 4.5 — 트레이·Claude 온보딩·간이 배포

Phase 5에 앞서 실제 Windows 환경에서 먼저 사용해 볼 수 있는 미리보기 관문이다. Phase 6의 상주 동작과 Phase 7의 설치 검증 일부를 앞당겨 확인하지만, 해당 Phase 전체를 완료한 것으로 간주하지 않는다.

- [x] Step 4.5.1 — Phase 4 기준선을 `main`에 병합하고 미리보기 브랜치·Guard 계획을 고정한다.
- [x] Step 4.5.2 — 현재 TUI renderer를 트레이 팝오버 수명주기에 다시 연결한다.
- [x] Step 4.5.3 — Claude CLI 로그인과 전용 probe 폴더 준비를 사용자 주도 흐름으로 안내한다.
- [x] Step 4.5.4 — quota bar 기반 아이콘과 unsigned Windows x64 Squirrel 설치 파일을 만든다.
- [x] Step 4.5.5 — 트레이 화면, provider smoke와 설치·실행·제거 관문을 검증한다.
- [x] Step 4.5.6 — Anthropic 공식 인증 경계를 재검토하고 구독 OAuth usage 경로를 제외한다. Claude CLI가 Fable을 제공하지 않으면 미제공 상태로 표시한다.

### Phase 4.5 관문

- [x] 첫 설정 이후 앱이 트레이에서 조용히 시작하고 클릭 시 420×320 팝오버를 표시한다.
- [x] Claude 로그인·workspace trust 선택은 보이는 Claude CLI에서만 사용자가 직접 수행한다.
- [x] Claude Code CLI 계정과 인증 종류만 표시하며 Claude Desktop credential은 검사하지 않는다.
- [x] 전용 아이콘이 실행 파일·트레이·Setup.exe에 적용된다.
- [x] fake 계정 스크린샷과 실제 provider 읽기 전용 smoke가 민감정보 없이 통과한다.
- [x] unsigned x64 설치 파일의 설치·실행·제거와 SHA-256 산출이 재현된다.
- [x] Claude 구독 credential을 직접 읽거나 비공개 usage API에 중계하는 경로가 없고 결정 근거가 문서화된다.

## Phase 5 — 로컬 토큰

Phase 5는 계정 전체 quota와 독립적으로 현재 장치에 보존된 Codex·Claude 로그 전체의 토큰을 집계한다. 벤더 로그가 삭제되면 합계도 줄어들 수 있으며, 앱 준비 후 백그라운드에서 자동으로 계산해 quota 갱신과 팝오버 표시를 지연시키지 않는다. 프롬프트·응답·스레드 이름·원본 경로는 IPC·로그·cache에 포함하지 않는다.

- [x] Step 5.1 — 공통 streaming·checkpoint 엔진을 구현한다.
  - 구현 전에 `local-usage → shared`, `main → local-usage` 경계의 Architecture Guard draft와 impact digest를 제시하고 승인을 받는다.
  - 256 KiB 비동기 청크로 JSONL을 읽고 LF·CRLF로 끝난 완전한 행만 처리한다. 한 행은 16 MiB로 제한하며 초과·손상·읽기 실패는 전체 집계를 버리지 않고 `partial`로 기록한다.
  - JSON parse 전에 필요한 event 표식을 선별하고 청크 사이에서 event loop에 양보한다. v1에서는 worker thread를 도입하지 않는다.
  - 파일별 익명화된 상대 식별자, 파일 identity, 크기, 수정 시각, byte offset과 처리 경계 hash를 checkpoint로 관리한다. truncate·교체·in-place rewrite는 해당 파일만 다시 계산한다.
  - 개행 없이 끝난 마지막 행은 다음 scan까지 보존하고 offset을 전진시키지 않는다. 삭제된 파일의 기여분은 reconcile에서 합계와 index에서 제거한다.
  - quota snapshot cache와 분리된 `userData/local-usage-index-v1.json`을 atomic write한다. 원본 경로·message ID·본문은 저장하지 않고 손상된 index는 폐기한 뒤 전체 재스캔한다.
  - 모든 토큰 필드는 0 이상의 safe integer로 검증하고 합산 과정에서도 overflow를 거부한다.
- [x] Step 5.2 — Codex 로컬 토큰 스캐너를 구현한다.
  - `~/.codex/sessions/**/*.jsonl`에서 `event_msg → token_count → total_token_usage`만 읽는다.
  - input·output·cached token은 0 이상의 safe integer인지, `total = input + output`인지, cache 계열이 input을 넘지 않는지 검증한다.
  - 파일 안의 누적 벡터는 성분별 양의 delta만 합산한다. 값이 감소하면 재계산·rollback으로 보고 그 delta를 0으로 처리하되 이후 증가분은 계속 반영한다.
  - 중복 집계를 피하기 위해 `last_token_usage`는 사용하지 않는다. cache read·write는 input의 부분집합으로 표시하고 total에 다시 더하지 않는다.
- [ ] Step 5.3 — Claude 로컬 토큰 스캐너를 구현한다.
  - `~/.claude/projects/**/*.jsonl`에서 최상위 assistant event의 `message.id`와 `message.usage`만 읽는다.
  - 스트리밍 중 같은 message가 반복되거나 파일 사이에서 중복돼도 익명화된 message ID를 기준으로 하나만 집계하고, 각 토큰 성분의 최댓값을 최종 usage로 선택한다.
  - 최상위 usage만 사용하고 `iterations` 같은 중첩 usage는 다시 합산하지 않는다.
  - input은 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, total은 input과 output의 합으로 정의한다. cache creation의 하위 breakdown은 다시 더하지 않는다.
- [ ] Step 5.4 — watch·reconcile·독립 상태 병합을 UI에 연결한다.
  - `fs.watch`는 750 ms debounce 신호로만 사용하고 60초 metadata reconcile을 진실 원천으로 둔다. provider별 scanner는 진행 중 scan 하나와 후속 scan 하나만 허용하며 앱 종료 시 watch·stream을 중단한다.
  - `UsageStore`에 로컬 usage 전용 merge 경로를 추가한다. quota·stale 갱신은 로컬 usage를 보존하고, 로컬 갱신은 quota·계정·오류 상태를 보존한다.
  - 기존 refresh가 quota와 로컬 scan을 함께 요청하게 하되 공개 IPC method는 늘리지 않는다. quota snapshot cache에서는 `localUsage`를 제외하고 scanner index만 영속 상태의 소유자로 둔다.
  - quota 아래에 `tokens this PC`, total, input·output, cache read·write, 관측 시작일을 한 줄의 보조 정보로 표시한다. `calculating`, `no local logs`, `partial`을 구분하고 quota의 시각적 우선순위와 420×320 크기를 유지한다.
  - `LocalTokenUsage`에 선택적 `observedFrom`을 추가한다. `scannedFileCount`는 현재 정상적으로 index된 파일 수로 정의하며 값이 없으면 계산 중, 0이고 partial이 아니면 로그 없음, partial이면 확인된 부분 합계를 뜻한다.

### Phase 5 관문

- [ ] UTF-8 청크 경계, CRLF, 7.5 MiB 초과 정상 행, 16 MiB 초과 행, 미완성 마지막 행, malformed·읽기 잠김, abort, truncate·교체·삭제 fixture를 통과한다.
- [ ] Codex 누적값 감소·반복·누락·잘못된 값과 이후 양의 delta를 검증한다.
- [ ] Claude 스트리밍 중복·파일 간 중복·중첩 iterations·cache 계산식을 검증한다.
- [ ] quota와 scanner가 어느 순서로 완료돼도 서로 덮어쓰지 않고 stale quota에서도 로컬 usage가 유지된다.
- [ ] checkpoint atomic write·손상 복구를 검증하고 path·message ID·본문·계정 정보가 index·IPC·로그에 없음을 확인한다.
- [ ] Electron smoke에서 calculating·ready·partial·no logs, 420×320·150% 배율과 refresh·tray 반응성을 확인한다.
- [ ] 실제 로그 smoke는 수치·계정·경로를 출력하지 않고 성공 여부와 0 이상 계약만 확인한다. production 코드에 vendor 로그 root 대상 write·rename·delete가 없음을 정적으로 검사한다.
- [ ] Architecture Guard `verify`, typecheck, lint, unit·integration·Electron smoke, `git diff --check`와 민감정보 검사를 통과한다.
- [ ] Antigravity 로컬 토큰은 Phase 5에 포함하지 않는다.

## Phase 5.5 — Antigravity (`agy`) 선택 provider

Phase 5의 공통 수집 기반을 완료한 뒤 선택적으로 진행한다. 이전 소비자용 CLI에 대한 호환 계층을 두지 않고, Google이 제공하는 Antigravity CLI의 `agy` 실행 파일만 대상으로 한다.

- [ ] Step 5.5.1 — Windows에 설치된 `agy` 버전·로그인 상태와 격리 PTY의 `/usage` 실행 가능성을 확인한다.
  - 고정된 빈 앱 전용 probe 폴더에서 공식 `agy`만 실행한다.
  - `/usage` 또는 `/quota`가 agent 작업이나 모델 prompt를 만들지 않고 quota 화면만 여는지 실제 환경에서 검증한다.
  - 안정적으로 자동화할 수 없으면 이 Phase를 중단하고 내부 API나 credential 직접 읽기로 전환하지 않는다.
- [ ] Step 5.5.2 — Antigravity PTY 어댑터와 quota 파서를 구현한다.
  - CLI가 제공한 모델 그룹별 `5h`·`Weekly`, 사용률·남은 비율과 reset만 정규화한다.
  - 계정 이메일과 plan tier는 CLI가 공식 출력으로 제공할 때만 메모리 UI에 전달하고 로그·오류·stale cache에는 저장하지 않는다.
  - 알 수 없는 모델 그룹과 출력 변경은 값을 추정하지 않고 명시적 `unsupported_output`으로 처리한다.
- [ ] Step 5.5.3 — 인증·설정 무변조 경계를 고정한다.
  - OS keyring, credential, token과 Antigravity 설정 파일을 앱이 직접 읽거나 쓰지 않는다.
  - quota backend나 비공개 endpoint를 직접 호출하지 않고 로그인·refresh·logout은 `agy`에 맡긴다.
  - 공식 statusline JSON은 향후 사용자 opt-in 대안으로만 검토하며 앱이 `statusLine.command`를 자동 설정하지 않는다.
- [ ] Step 5.5.4 — 선택 provider 카드와 fake·실제 smoke를 연결한다.
  - 공개 `ProviderId`·schema 변경은 Architecture Guard impact plan과 사용자 승인을 거쳐 `antigravity`로만 추가한다.
  - `agy` 미설치·미인증·timeout·출력 변경을 다른 provider와 격리하고 마지막 정상값을 stale로 유지한다.
  - 실제 smoke는 계정과 quota 수치를 출력하거나 fixture에 저장하지 않고 성공 여부만 확인한다.

### Phase 5.5 관문

- [ ] Antigravity 카드에서 CLI가 제공한 모델 그룹별 `5h`·`Weekly`와 reset을 추정 없이 표시한다.
- [ ] `agy` 장애가 Codex·Claude와 로컬 토큰 집계를 중단시키지 않는다.
- [ ] 앱 코드에 Antigravity credential·keyring·설정 파일 직접 접근이나 비공개 quota API 호출이 없다.
- [ ] 실제 `/usage` smoke가 agent 작업과 모델 prompt를 생성하지 않았음을 확인한다.
- [ ] Antigravity 로컬 토큰은 안정된 공식 집계 계약이 확인되기 전까지 제공하지 않는다.

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

Antigravity 로컬 토큰, 다중 계정, 계정 전환, 비용 추정, 차트, 알림, 코드 서명, 자동 업데이트, CI 릴리스와 원격 게시는 후속 로드맵으로 분리한다. Claude 구독 OAuth credential 재사용은 후속 기능이 아니라 공식 지원 또는 서면 허가 전까지 금지된 경계다.
