# 공유 캐시 교차 검증 — 2026-09-20

## 확인한 결과

Node/Rust가 quota와 증분 토큰 인덱스를 양방향으로 재사용한다. Rust는 느린 provider가 끝나기 전에 캐시와 빠른 결과를 전달한다. Windows release와 Electron 패키지를 만들었다. 실계정 CLI/API 수집과 디자인의 최종 일치는 이번 자동 검증 결과에 포함하지 않는다.

| 검사 | 결과 |
|---|---|
| Node 전체 unit/integration | 36 files, 264 tests 통과 |
| 공통 fixture 교차 검사 | 2 tests 통과, Node→Rust→Node quota·토큰 검증 |
| Rust lib/main | 29 + 2 tests 통과; 마지막 cache 변경 후 engine 4개 재검증 통과 |
| 타입·lint | pnpm typecheck, pnpm lint 통과 |
| 아키텍처 | 신규 위반·stale baseline 없음, 기존 승인 baseline 유지 |
| 민감정보 | 커밋 전 staged 전체 검토와 gitleaks 수행 |
| Rust Windows | release 빌드 및 --demo-progress 정상 종료·시작 진단 확인 |
| Electron Windows | Forge API로 별도 출력 폴더 패키징 성공 |
| Electron 자동 UI 실행 | 시작 검사 timeout, 통과 아님. 아래 제한 참고 |

교차 검사는 정상 quota 복구 시 stale·마지막 성공 시각 보존, 계정명/장애 본문 제외, Codex 누적 양수 증가분, Claude 캐시 포함 input·파일 간 중복 제거, unchanged 재사용, 이어쓰기·UTF-8 분할·같은 크기 수정·truncate·삭제·안전 정수 초과를 포함한다. 알 수 없는 quota/index 버전, 손상 quota, 디렉터리 대신 파일이 있어 쓰기 실패하는 경우와 임시 파일 쓰기 중 fixture 프로세스 강제 종료도 확인했다.

Node가 잠근 동안 Rust 실행 거부, Rust가 잠근 동안 Node 거부, 소유 프로세스 종료 후 재획득을 확인했다. 강제 종료 후 quota 본 파일은 이전 완성본과 byte 단위로 같았다. 이는 프로세스 종료 검증이며 전원 손실 내구성 검증은 아니다.

Rust의 unchanged 테스트는 재파싱되면 panic하는 파서를 넣어 재사용을 확인한다. 교차 검사에서는 Node가 Rust의 checkpoint를 읽을 때 기존 JSONL 행이 JSON.parse에 전달되지 않는 것을 확인한다. Rust 중앙 상태 테스트는 1.2초 걸리는 Claude fixture가 끝나기 전 700ms 안에 stale 캐시·정상 Codex·실패 AGY를 각각 관측한다. 실패 시 이전 값 유지, 정상 미제공 시 삭제, backoff와 갱신 후속 1회 상태도 검사한다. 실제 인증 만료/429/CLI 실패는 기존 허구 provider 테스트를 사용하며 인증 파일에는 접근하지 않았다.

## 시작 측정

Windows release, `--demo --demo-progress --show --quit-after=3 --startup-timing` 1회 측정이다. 로그는 Git 제외 `.work/parity-captures/shared-cache-startup.log`에 있다.

| main 이후 단계 | 누적 시간 |
|---|---:|
| runtime 준비 | 0.32ms |
| GPUI platform 준비 | 573.42ms |
| 첫 Render 호출 | 630.89ms |
| 첫 수집 결과 UI 상태 반영 | 653.18ms |
| 전체 수집 완료 반영 | 약 1.30s |

추가 진단 이름은 `cache-first-applied`, `first-measured-applied`, `collection-complete`다. UI 이벤트 루프에 도착하기 전에 더 새 결과로 합쳐진 중간 상태는 실제 반영 시각으로 기록하지 않는다. 이번 cold demo에는 재시작 캐시가 없으므로 cache-first-applied 값은 없다. 캐시 선반영은 별도 중앙 상태 테스트로 확인했다. 실계정 속도·OS cold start·Node와의 배수 비교 결과로 해석하지 않는다. GPUI 초기화 자체의 약 0.57초는 이번 변경으로 제거되지 않는다.

## 실행 산출물과 재현 명령

프로젝트 루트 PowerShell에서 실행한다. 두 앱의 실제 모드를 동시에 실행하면 새 실행이 거부되므로 기존 앱은 트레이 메뉴로 종료한 뒤 전환한다.

```powershell
# Rust 실제 실행: 데이터는 백그라운드에서 수집
.\target\release\llm-usage-monitor.exe
# 시작과 동시에 창 열기
.\target\release\llm-usage-monitor.exe --show
# 실제 계정 없이 결과 도착 순서 확인
.\target\release\llm-usage-monitor.exe --demo --demo-progress --show
# 새 Electron 패키지
& '.\out\shared-cache\LLM Usage Monitor-win32-x64\LLM Usage Monitor.exe'
```

Rust exe는 Node 개발 환경이나 Rust 도구 없이 실행한다. Electron은 위 exe가 들어 있는 패키지 디렉터리 전체가 필요하다.

```powershell
# 개발 환경에서 자동 검증 재현
pnpm typecheck
pnpm test
pnpm lint
pnpm test:shared-cache
cargo test --lib --bin llm-usage-monitor
cargo build --release --bin llm-usage-monitor
# 기본 out 경로가 사용 중일 때 사용한 기존 Forge API
node -e 'require("@electron-forge/core").api.package({dir:process.cwd(),outDir:"out/shared-cache"}).catch(error=>{console.error(error);process.exitCode=1})'
```

기본 `pnpm package`는 기존 실행 중인 앱의 `resources/app.asar` 잠금(EBUSY)으로 실패했다. 기존 프로세스를 종료하지 않고 `out/shared-cache`에 패키징했다. 기존 기본 out 산출물이 새 버전이라고 간주하면 안 된다.

새 Electron 패키지의 기존 Playwright `runtime ... startup 1` 검사는 30초 timeout, 디버그 재시도도 20초 timeout이었다. main 시작 로그와 Node/Chromium DevTools 연결까지 확인했으나 UI 시작 검사가 완료되지 않았다. 원인은 확정하지 않았으며 수동 실행 확인이 필요하다. 테스트가 시작한 프로세스는 종료됐다. 새 Electron 패키지의 UI 정상 실행을 검증 완료로 표시하지 않는다.

## 수동 확인과 위험

- Node 실행·정상 종료 → Rust 실행·정상 종료 → Node 실행 순서로 처음 표시되는 quota·토큰·시각과 이후 갱신을 확인한다.
- 디자인·창 드래그·트레이 복귀·상태 링크·자동/수동 갱신 때 cmd 창 노출은 사용자 실화면 확인 항목이다. 캡처는 `.work/parity-captures/`에만 둔다.
- macOS 빌드와 실실행은 이 Windows 환경에서 확인하지 못했다.
- 파일 앞/offset 직전 4KiB를 검증하므로 동일 크기·동일 mtime을 유지하면서 그 구간 밖만 바꾸는 특수 수정은 탐지하지 못한다.
- 최초 v2 인덱스 생성은 전체 재집계다. 이후 변경 없는 로그는 경계 검증만 하고 재파싱하지 않는다.
- 정상 종료는 진행 중 작업과 저장을 기다린다. 느린 벤더 CLI timeout 동안 잠금이 유지될 수 있다. 강제 종료하면 마지막 완성 캐시를 사용한다.
- rechecking은 provider의 진행 중 작업을 나타내므로 토큰 재검증이 먼저 끝나도 해당 provider의 quota/장애 조회가 끝날 때까지 표시될 수 있다.
- 전체 검사 중 기존 AGY 테스트가 PC의 설치 경로를 사용하던 문제가 드러나 fake command를 명시했다. 기존 캡처/fixture 스크립트 lint 7건은 globalThis 참조로 수정했다. 두 스크립트와 UsageMonitorCore.ts는 기존 guard include 밖이므로 의존성을 수동 확인했다. 정책이나 baseline은 확대하지 않았다.

## 후속 수정: Claude 리셋 시각의 9시간 오차

- 원인: Rust 파서가 CLI의 로컬 wall time에서 `(Asia/Seoul)` 표기를 제거한 뒤 UTC 시각으로 생성했다. KST 17:00을 17:00Z로 처리하여 정상 08:00Z보다 9시간 늦어졌다. UI의 UTC 차감 계산 자체는 정상이었다.
- 수정: 기존 Node와 같이 호스트 로컬 시간대로 날짜·시각을 해석한 다음 UTC로 변환한다. 자정·다음 날·연도 경계도 로컬 날짜를 기준으로 처리한다. 새 라이브러리나 인증 접근은 추가하지 않았다.
- 검증: KST 07:54 → 17:00의 남은 시간이 546분(9시간 6분)임을 명시적으로 검증했다. 날짜 포함/시간만/시간대 표기 생략, 자정과 연도 경계, 상대 기간 유지, 잘못된 시간 거부를 포함해 Claude 파서 테스트 4개와 guard가 통과했다.
- 캐시: 이전 버전이 저장한 잘못된 resetsAt은 stale로 남을 수 있다. 수정한 실행 파일로 재시작한 뒤 Claude 수집이 성공하면 새 시각으로 교체된다. Node에서 생성한 정상 캐시와 구별할 수 없으므로 저장된 시각을 일괄 9시간 차감하지 않는다.
- 범위: CLI와 앱이 같은 호스트 로컬 시간대를 사용하는 기존 Node 계약을 따른다. 문자열에 적힌 임의의 다른 IANA 시간대를 별도로 해석하는 기능은 추가하지 않았다. 실계정 수집은 실행하지 않았다.
- 실행 산출물: release 링크 결과를 `target/release/preview/llm-usage-monitor.exe`에 복사하고 SHA-256 일치를 확인했다. 실행 중인 앱이 기존 `target/release/llm-usage-monitor.exe`를 잠가 Cargo의 최종 교체는 실패했다. 기존 앱을 종료한 뒤 preview 실행 파일로 확인한다.
