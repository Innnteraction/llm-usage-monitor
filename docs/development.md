# 개발 구조와 실행 안내

저장소에는 같은 제품의 Node/Electron과 Rust/GPUI 구현이 있다. 수정할 앱을 먼저
선택하고 해당 폴더에서 작업한다. 아래 명령은 별도 표시가 없으면 저장소 루트에서 실행한다.

| 변경 대상 | 수정 위치 | 가까운 검증 |
| --- | --- | --- |
| Node 수집·저장·Electron·웹 UI | `apps/node/src` | `pnpm test`, `pnpm typecheck`, `pnpm lint` |
| Node 실행·패키징·테스트 설정 | `apps/node`와 `apps/node/scripts` | `pnpm package`, `pnpm test:e2e:runtime` |
| Rust 수집·저장·OS·GPUI | `apps/rust/src` | `cargo test --locked --all-targets` |
| Rust 진단 실행 파일 | `apps/rust/tools` | 해당 `cargo run --locked --bin ...` |
| 공유 캐시·표시 의미 | `docs/shared-cache-contract.md`, `shared/fixtures` | `pnpm test:shared-cache`, 양쪽 표시 단위 테스트 |
| 설치·배포·자동 시작 | `scripts` | `scripts/tests`의 격리 검증, OS 실기 검수 |
| 의존 경계 | `architecture` | `pnpm check:architecture`, `pnpm test:architecture` |

`apps/node/src/shared`는 Node 내부 타입·IPC 계약이다. 저장소의 `shared/fixtures`는
두 언어가 함께 검증하는 허구 데이터이며 실행 코드 공유 패키지가 아니다.
제품의 snapshot·캐시·인증 소유권은 폴더 구조와 무관하게 유지한다.

## Node 개발

Node 24와 pnpm 9.15.9를 준비한다. Rust는 일반 Node 개발·테스트·패키징에 필요 없다.

```sh
pnpm install --frozen-lockfile
pnpm dev
# 웹 UI HMR이 필요한 경우
pnpm dev:hmr
pnpm test
pnpm typecheck
pnpm lint
pnpm check:architecture
pnpm test:architecture
pnpm package
```

루트 명령은 Node 앱 명령으로 전달된다. `apps/node` 안에서는 같은 Node 명령을
직접 실행할 수 있다. 일반 테스트는 unit·integration만 실행한다. 실계정 CLI를
실행하는 smoke 테스트는 `test:smoke:*`, Rust가 필요한 교차 검증은 `test:shared-cache`로
분리돼 있다. E2E는 허구 데이터와 별도 프로필을 사용한다.

## Rust 개발

Rust/Cargo와 플랫폼 C++·SDK 도구를 준비한다. Node 설치 없이 빌드할 수 있다.

```sh
cargo test --locked --all-targets
cargo build --locked --release --bin llm-usage-monitor
cargo run --locked --release --bin llm-usage-monitor -- --demo
cargo run --locked --release --bin benchmark-native
```

루트 Cargo manifest는 workspace이고 실제 crate는 `apps/rust/Cargo.toml`이다.
`apps/rust` 안에서도 Cargo 명령을 실행할 수 있다. `test-collector`는 실제 벤더
수집 진단 도구이므로 허구 데이터 검증과 구분해서 실행한다.

## 공통 검증과 산출물

```sh
pnpm check:versions
pnpm test:shared-cache
node scripts/diagnostics/create-parity-scenarios.mjs
```

Windows 설치기 검증은 실제 설치본과 레지스트리를 건드리지 않는다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/test-install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/test-install-entry.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Check
```

| 산출물 | 경로 |
| --- | --- |
| Electron 번들·패키지 | `apps/node/.vite`, `apps/node/out` |
| 설치기용 Electron 패키지 | `apps/node/out/install-build` |
| Rust debug·release 실행 파일 | `target/debug`, `target/release` |
| E2E 결과 | `apps/node/test-results` |
| 작업 문서·캡처·측정 결과 | `.work` (로컬 전용) |

`.work`는 Git에 포함하지 않으며 없는 checkout에서도 빌드·테스트가 동작한다.
작업 기록을 제품의 필수 입력으로 참조하지 않는다. 공용 fixture 수정은 별도 검토하고
진단 도구는 결과를 `.work`에 기록한다. 기존 루트 빌드 캐시는 자동 삭제하지 않는다.

버전 변경 시 두 앱 manifest, 루트 package 버전과 Node 표시 버전을 함께 변경하고
`pnpm check:versions`로 확인한다. 설치·자동 시작·업데이트 명령은 기존 README를 따른다.
실제 로그인·재부팅과 macOS 실기·UI 검수 범위는 [검증 안내](verification.md)에 기록한다.
