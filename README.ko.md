[English](README.md) | **한국어**

# LLM Usage Monitor (v0.12.0)

Codex, Claude Code, Antigravity(`agy`)의 5시간·주간 사용량 쿼터(Quota)와 이 PC의 로컬 토큰 사용량을 한눈에 보여주는 macOS·Windows 트레이 앱입니다.

<p align="center">
  <img src="docs/images/overview-dark.png" alt="상세 뷰: 3개 프로바이더 카드, 진행 막대, 리셋 카운트다운, 로컬 토큰 집계" width="480">
  <br>
  <img src="docs/images/compact-dark.png" alt="간이 모드: 프로바이더별 한 줄 요약 테이블" width="480">
  <br>
  <sub>상세 뷰(위)와 간이 모드(아래). 두 화면 모두 앱에 내장된 예시 데이터로 캡처했으며 계정·수치는 허구입니다.</sub>
</p>

---

## 요약

이 앱은 Codex, Claude Code, Antigravity CLI에 이미 로그인한 개발자가 계정 쿼터와 이 PC의 토큰 사용량을 작업 흐름을 끊지 않고 확인하도록 돕습니다. macOS와 Windows를 지원하며, 선택형 소스 설치기로 필요한 도구 확인부터 앱 실행까지 진행합니다. 빌드 도구 설치에는 관리자 권한이 필요할 수 있습니다.

앱은 각 CLI가 가진 인증 소유권을 존중합니다. 토큰이나 자격증명 파일을 직접 읽거나 고치지 않고, 쿼터는 CLI가 보여주는 값만 사용합니다. 그래서 설치 뒤에 필요한 준비는 각 CLI에 로그인해 두는 것과, Claude Code에 한해 앱 전용 빈 폴더를 처음 한 번 신뢰(trust)해 주는 것뿐입니다.

아래 빠른 시작으로 설치하고, 프로바이더 초기 설정에서 카드가 모두 fresh 상태가 되면 준비가 끝납니다.

---

## 빠른 시작

공개 빌드 패키지는 제공하지 않습니다. 저장소의 **Code → Download ZIP**으로 소스를 받아 압축을 풀거나 Git으로 내려받은 뒤 프로젝트 폴더에서 실행합니다. ZIP 설치에는 Git이 필요 없습니다. 설치기를 시작할 때 Node나 Rust가 없어도 됩니다.

### 1. 버전 비교·선택

| 항목 | Node / Electron | Rust / GPUI |
| --- | --- | --- |
| UI | 기존 웹 UI | 네이티브 UI |
| 빌드 도구 | Node 24, 프로젝트 지정 pnpm | Rust/Cargo, Windows MSVC·SDK 또는 macOS Xcode·Metal |
| 최초 준비 | 상대적으로 단순 | 빌드 도구와 컴파일 부담이 큼 |
| 실행 메모리 | Electron으로 상대적으로 클 것으로 예상 | 상대적으로 작을 것으로 예상 |
| 앱 구성 | Electron 런타임을 포함한 여러 파일 | 네이티브 실행 파일과 리소스 |

설치 준비가 단순하다는 것이 앱 크기가 작다는 뜻은 아닙니다. 절감률·빌드 시간은 보장하지 않습니다. 전체 UI 동등성과 macOS 실화면·로그인 실행은 별도 검수가 필요합니다. 설치기가 현재 PC에서 부족한 도구를 표시하며 **기본 버전은 자동 선택하지 않습니다.** 관리되는 앱은 하나만 설치됩니다.

참고: Windows x64에서 동일 허구 데이터의 펼친 화면을 5회 측정했을 때 Working Set 합계는 Node 314–318MiB, Rust 약 55MiB였습니다. 공유 페이지 중복 합산이 포함된 짧은 표본이며 [조건과 한계](docs/verification.md#메모리-비교)를 함께 확인하세요.

### 2. 환경 확인 → 설치

Windows x64, 64-bit PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

macOS Apple Silicon / Intel:

```bash
bash scripts/install.sh --check
bash scripts/install.sh
```

설치 안내와 앱 UI는 영어입니다. `node`(`n`) 또는 `rust`(`r`)와 자동 시작 여부를 선택합니다. `-Variant` / `--variant` 옵션에도 같은 약어를 사용할 수 있습니다. 필요한 도구와 설치 출처를 확인하고 동의하면 빌드·설치·실행합니다. 앱은 사용자 폴더에 설치하지만 빌드 도구에는 관리자 권한·라이선스 승인·재부팅이 필요할 수 있습니다. 기존 도구를 임의 삭제하거나 다른 버전으로 바꾸지 않습니다.

### 3. 앱 열기·초기 설정

Windows 시작 메뉴의 **LLM Usage Monitor**, macOS `~/Applications/LLM Usage Monitor.app`에서 실행합니다. 기본적으로 트레이에 상주하며 아이콘을 클릭하면 열립니다. 사용하려는 벤더 CLI에 로그인하고 아래 설정을 완료하세요. 일부 CLI가 없어도 다른 벤더는 사용할 수 있습니다.

자동 시작은 두 버전 모두 트레이 메뉴에서 변경할 수 있습니다. 개발 폴더의 실행 파일은 자동 시작을 등록할 수 없으며 설치본을 사용해야 합니다.

### 4. 업데이트·버전 변경·제거

앱을 트레이에서 종료하고 새 소스에서 설치기를 다시 실행합니다. 같은 버전은 업데이트, 다른 버전은 교체합니다. 새 빌드가 실패하면 기존 앱을 보존하고, 설치 교체 실패 시 이전 설치본을 복구합니다. 공유 캐시는 유지하고 버전별 UI 설정은 변환하지 않습니다.

```powershell
# Windows: Rust로 변경 (Node는 -Variant node)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Variant rust
# 제거: 캐시·인증·개발 도구 보존
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Uninstall
```

```bash
# macOS: Node로 변경 (Rust는 --variant rust)
bash scripts/install.sh --variant node
bash scripts/install.sh --uninstall
```

기존 `pnpm deploy*`는 Node 설치 진입점으로 유지됩니다. `deploy:quick`도 오래된 산출물을 쓰지 않도록 빌드를 다시 검증합니다. 상세 옵션·복구 절차: [Windows](docs/deploy-windows.md) · [macOS](docs/deploy-mac.md).

---

## 프로바이더 초기 설정

각 카드 오른쪽 위의 상태 표시가 기준입니다.

| 상태 | 뜻 |
| --- | --- |
| `● fresh` | 최근 새로고침 성공. 설정 완료 |
| `● stale` | 새로고침 실패. 마지막 성공값을 유지하고 원인을 카드에 표시 |
| `● unavailable` | 아직 한 번도 성공하지 못함. 아래 절차 필요 |

### Claude Code: 최초 1회 폴더 신뢰 승인

Claude Code는 새 작업 폴더마다 신뢰 여부를 묻습니다. 앱은 쿼터를 읽기 위해 전용 빈 폴더에서 `claude`를 safe mode로 실행하므로, 이 폴더를 처음 한 번만 직접 승인해 주면 됩니다. 앱은 이 질문에 대신 답하거나 Claude 설정 파일을 고치지 않습니다.

| OS | 전용 폴더 |
| --- | --- |
| macOS | `~/Library/Application Support/LLM Usage Monitor/claude-probe` |
| Windows | `%LOCALAPPDATA%\LLM Usage Monitor\claude-probe` |

1. 앱을 열면 Claude Code 카드에 `● unavailable`, `Workspace trust confirmation required.` 문구와 `prepare folder` 버튼이 보입니다.
2. `prepare folder`를 클릭합니다. 터미널(macOS: Terminal.app, Windows: Windows Terminal)이 열리고 전용 폴더에서 `claude`가 자동 실행됩니다.
3. 터미널의 `Do you trust this folder?` 질문에 **Yes**를 선택합니다.
4. Claude 프롬프트에서 `/exit`를 입력해 종료합니다.
5. 앱에서 `refresh`를 누르거나 최대 60초 기다립니다. 카드가 `● fresh`로 바뀌고 5h·7d 게이지가 채워지면 완료입니다. 승인은 이후에도 유지됩니다.

로그인이 안 된 경우에는 카드에 `Sign in with the CLI to view quota.`와 `sign in` 버튼이 보입니다. 클릭하면 터미널에서 `claude auth login --claudeai`가 실행되며, 로그인 후 위 1단계부터 이어갑니다.

버튼을 눌러도 터미널이 열리지 않으면 다음을 확인하세요.

- Windows: Windows Terminal(`wt.exe`)이 설치되어 있어야 합니다.
- macOS: 처음 실행 시 "Terminal을 제어하도록 허용" 권한 요청이 뜨면 허용합니다. 거부했다면 시스템 설정 → 개인정보 보호 및 보안 → 자동화에서 LLM Usage Monitor에 Terminal 권한을 켭니다.
- 수동으로 진행하려면 터미널에서 전용 폴더로 이동한 뒤 아래 명령을 실행하고 3~5단계를 따릅니다.

```bash
claude --safe-mode --ax-screen-reader --restricted --strict-mcp-config --tools ""
```

앱이 자격증명을 다루는 범위는 [Anthropic 인증 경계 결정](docs/decisions/0001-anthropic-credential-boundary.md)에 정리되어 있습니다.

### Codex

`codex` CLI 또는 **Codex Desktop 앱**에 로그인되어 있으면 추가 설정 없이 동작합니다.

- **Desktop 앱 단독 사용 지원**: 별도의 CLI를 설치하지 않았더라도 Codex Desktop 앱이 설치되어 있으면 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` 등의 기본 경로와 `~/.codex/sessions`의 세션 로그를 자동으로 감지하므로, 터미널 PATH 설정 없이도 계정 쿼터와 로컬 토큰 사용량을 모두 추적합니다.
- **로그인 상태 유지**: 로그인이 풀리면 카드에 `Sign in with the CLI to view quota.`가 표시되니 터미널에서 `codex login`을 실행하거나 Desktop 앱에서 다시 로그인하세요.

### Antigravity (선택)

`agy` 1.1.11 이상이 PATH에 있고 로그인되어 있으면 세 번째 카드가 나타납니다. CLI가 없으면 카드에 `CLI is not installed.`가 표시되며, 다른 프로바이더에는 영향을 주지 않습니다.

- **IDE & CLI 통합 트래킹**: Antigravity 자체 IDE 또는 VS Code 확장에 로그인된 Google 계정과 시스템 `agy` CLI의 계정이 동일하면 사용량이 원격 쿼터에 통합 반영되며, 하단 출처가 `source Antigravity CLI, IDE`로 표기됩니다.
- **계정 전환 지원 (`switch`)**: 카드 상단 이메일 라벨 옆의 `switch` 버튼을 클릭하면 대화형 터미널이 열려 `/logout` 및 원하는 Google 계정으로의 재로그인을 편리하게 진행할 수 있습니다.
- **간편 로그인 (`sign in`)**: CLI가 미인증 상태인 경우 카드 에러 영역에 `sign in` 버튼이 표시되어 클릭 시 터미널에서 브라우저 OAuth 로그인을 바로 시작할 수 있습니다.

---

## 주요 기능

- **3대 AI 개발 도구 쿼터 통합 모니터링**
  - Codex: 7일 주간 한도 및 추가 모델 한도
  - Claude Code: 5시간 세션 한도, 7일 주간 한도, Fable 모델 한도
  - Antigravity: Gemini 모델군 5시간·주간 한도 및 Claude/GPT 추가 한도
- **듀얼 UI 모드**
  - 상세 뷰: 프로바이더별 계정, 진행 막대, 리셋 카운트다운, 로컬 토큰 2줄 보조 뷰
  - 간이 모드: 전 프로바이더의 주간/5h 쿼터를 한 줄씩 요약한 컴팩트 테이블 (`Ctrl/Cmd+Shift+C`)
- **핀 고정과 자유 배치**
  - 화면 내 어느 영역이든(상단 헤더, 카드 여백, 게이지 바 등) 클릭하고 드래그해 자유롭게 배치하고 마지막 위치를 기억
  - 핀 고정(`Ctrl/Cmd+Shift+P`) 시 다른 창에 가려지지 않으며, 재시작 후에도 핀 상태 유지
- **로컬 토큰 집계**
  - 계정 쿼터와 분리해 이 PC의 CLI 세션 로그(JSONL)를 청크 스트리밍과 체크포인트로 집계 (총 토큰, 입·출력, 캐시 읽기/쓰기)
- **TUI 스타일 인터랙션**
  - OS 다크/라이트 자동 동기화 및 수동 전환 (`Ctrl/Cmd+Shift+L`)
  - 새로고침 시 CLI 스타일 컬러 웨이브 쉬머
  - 0~9% 구간을 두 자리(`05%`)로 패딩해 게이지와 표의 자릿수 정렬 유지
  - 마우스가 창을 벗어나면 툴팁 즉시 닫힘
- **인증 경계 준수**
  - 벤더 CLI의 인증 소유권을 존중하며 토큰·자격증명 파일을 직접 읽거나 수정하지 않음

---

## 단축키 및 조작

단축키는 앱 창에 포커스가 있을 때 동작합니다. 상단 우측의 <kbd>?</kbd> 버튼을 누르면 같은 내용을 앱 안에서 볼 수 있습니다.

| 기능 | Windows | macOS | 상단 버튼 |
| --- | --- | --- | --- |
| 간이 모드 전환 | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | 사각형 (접기 − / 펼치기 +) |
| 다크 / 라이트 테마 전환 | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | 달(다크) / 해(라이트) 아이콘 |
| 항상 위(핀) 고정 | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | 핀 아이콘 (고정되면 채워짐) |
| 단축키 및 정보 보기 | - | - | <kbd>?</kbd> 아이콘 (팝오버 열림) |
| 팝오버 닫기 | <kbd>Esc</kbd> | <kbd>Esc</kbd> | 핀 해제 상태에서 창 외부 클릭 |

마우스 조작과 트레이 메뉴:

- 창 이동: 화면 내 어느 곳이든(헤더, 본문 카드 여백, 게이지 바 등) 클릭하고 드래그합니다. 텍스트 드래그 선택이 방지되어 자연스럽게 이동할 수 있으며, 마지막 위치는 자동으로 기억됩니다.
- 상세 정보: 게이지·수치·버튼에 마우스를 올리거나 포커스하면 툴팁이 뜹니다.
- 트레이 아이콘 우클릭: `열기`, `새로고침`, `기본 위치로 재설정`, `로그인 시 시작`(Windows: `Windows 로그인 시 시작`), `종료`.

---

## 개발 폴더와 검증

Node 소스·테스트·설정은 `apps/node`, Rust 구현은 `apps/rust`에 있다. 공용 fixture는 `shared/fixtures`, 설치기는 `scripts`에서 관리한다. `.work`는 로컬 전용이며 빌드에 필요하지 않다. [개발 안내](docs/development.md)에서 변경 대상별 검증과 산출물 경로를 확인한다.

Rust 단독 개발에는 Node가 필요하지 않다.

```sh
cargo test --locked --all-targets
cargo run --locked --release --bin llm-usage-monitor -- --demo
```


## 로컬 개발 및 테스트

```bash
pnpm install

# 현재 소스를 패키징하고 로컬 앱 실행 (설치는 하지 않음)
pnpm dev

# 선택: Vite HMR로 저장한 화면 코드를 즉시 반영
pnpm dev:hmr

# 실제 실행 파일의 시작·종료·프로필 격리 검사 (허구 데이터)
pnpm test:e2e:runtime

# 단위/통합 테스트
pnpm test

# 타입 체크 및 ESLint
pnpm typecheck
pnpm lint

# 프로덕션 패키징 (apps/node/out/)
pnpm package

# 배포 산출물 생성: Windows는 Squirrel 인스톨러(.exe), macOS는 .zip
pnpm make

# README 스크린샷 재생성 (예시 데이터, pnpm package 선행 필요)
pnpm screenshot:readme
```

실제 CLI를 대상으로 한 읽기 전용 smoke 테스트는 `pnpm test:smoke:codex`, `pnpm test:smoke:claude-pty`, `pnpm test:smoke:local-usage`로 따로 실행합니다.

`pnpm dev`는 배포와 동일한 Forge 패키징을 사용하고, 생성된 Windows EXE 또는 macOS 앱 실행 파일을 직접 실행합니다. 코드 변경은 트레이의 종료 메뉴 또는 `Ctrl+C`로 종료한 뒤 다시 실행해 반영합니다. 창만 닫으면 트레이에 남습니다. 빌드에 실패하면 이전 앱을 대신 실행하지 않습니다.

두 개발 명령은 `appData/llm-usage-monitor-dev`에 설정·Chromium 데이터를 별도로 저장합니다. 공유 캐시의 실행 잠금은 같은 캐시를 사용하는 앱의 동시 수집을 막으므로 기존 앱을 종료한 뒤 실행하세요. 벤더 CLI의 기존 로그인은 그대로 사용하며 설치 폴더·바로가기·자동 시작 등록은 변경하지 않습니다.

GPU 종료와 흰 화면의 진단 절차 및 확인된 범위는 [트러블슈팅 가이드](TROUBLESHOOTING.ko.md)를 참고하세요.

---

## 문서 및 참조

- [macOS 배포 도구 가이드](docs/deploy-mac.md)
- [Windows 배포 도구 가이드](docs/deploy-windows.md)
- [제품 컨셉 및 설계 원칙](docs/product-concept.md)
- [Anthropic 인증 경계 결정](docs/decisions/0001-anthropic-credential-boundary.md)
- Provider 계약: [Codex](docs/providers/codex.md) · [Claude Code](docs/providers/claude.md) · [Antigravity](docs/providers/antigravity.md)
- [아키텍처 증거 및 모듈 경계 분석](docs/architecture-evidence.md)
- [아키텍처 평가 및 분리 계획 보고서](docs/architecture-assessment.md)
- [v1 개발 로드맵](docs/plan/v1-roadmap.md)

---

## 라이선스

이 프로젝트는 [MIT 라이선스](LICENSE)를 따릅니다.
