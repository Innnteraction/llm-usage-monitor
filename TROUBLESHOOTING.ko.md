[English](TROUBLESHOOTING.md) | **한국어**

# 개발 및 런타임 트러블슈팅

## 1. v0.9.2부터의 기본 개발 실행

`pnpm dev`는 현재 소스를 Forge로 패키징한 뒤 `apps/node/out/`의 실제 실행 파일을 실행한다. 설치 폴더에 복사하지 않는다. 저장 후에는 트레이의 종료 메뉴 또는 `Ctrl+C`로 종료하고 다시 실행한다. 패키징 실패 시 이전 산출물은 실행하지 않는다.

`pnpm dev:hmr`는 기존 Forge·Vite 경로다. HMR(Hot Module Replacement)은 저장한 화면 코드를 앱 재시작 없이 반영한다. main/preload 변경의 재시작 동작은 Forge를 따른다. 두 개발 명령은 동시에 사용하지 않는다.

개발 실행은 `LLM_USAGE_MONITOR_DEV=1`을 전달하고 `userData`와 `sessionData`를 `appData/llm-usage-monitor-dev`로 함께 분리한다. 설치 앱과는 설정·캐시·단일 인스턴스 잠금을 공유하지 않는다. E2E에서는 `LLM_USAGE_MONITOR_E2E_USER_DATA`가 우선한다. 벤더 인증 파일은 읽거나 변경하지 않으며 CLI 로그인은 기존 provider 경로를 사용한다.

## 2. 흰 화면과 GPU 종료: 확인과 가설

### 보고된 현상

일반 PowerShell에서 기존 `pnpm dev` 실행 시 흰 화면 또는 다음 GPU 오류가 반복되었다. CSP 완화와 GPU 샌드박스 우회를 추가한 뒤에도 문제가 지속되었고, 배포 앱은 정상 실행된다고 보고되었다.

```text
GPU process exited unexpectedly: exit_code=-2147483645
```

`-2147483645`는 `0x80000003` (`STATUS_BREAKPOINT`)이다. 이 코드만으로 특정 그래픽 드라이버, 보안 프로그램 또는 GPU 샌드박스를 근본 원인으로 확정할 수는 없다.

### 2026-09-07 조사에서 확인한 내용

- 설치된 Vite 8.2.2와 React 플러그인 6.1.1로 HTML을 변환했을 때 React Refresh preamble, Vite client, main 스크립트 모두 설정된 nonce를 받았다. 이전 기록의 **nonce 누락 가설은 현재 구성에서는 재현되지 않았다**. [Vite CSP 문서](https://vite.dev/guide/features#content-security-policy-csp)도 자동 nonce 주입을 설명한다.
- Forge 7.11.2는 renderer URL을 `http://localhost:17321`로 만든다. 실제 서버 바인딩은 `127.0.0.1`이다. HMR 호스트를 `127.0.0.1`로 명시해 허용한 WebSocket 출처와 일치시켰고 실제 연결을 검사했다. 이 오리진 차이는 GPU 종료 원인과 별개다.
- 조사 시작 시 설치 앱과 로컬 package에도 `disable-gpu-sandbox`가 있었다. 이후 통제된 비교에서는 packaged EXE가 우회 없이도 정상 동작했고, 문제 경로의 개발용 Electron은 우회 유무와 무관하게 실패했다.
- 기존 기본 E2E는 개발용 Electron으로 `app.asar`를 열었다. 실제 packaged EXE를 실행하는 테스트로 변경했다.

### 현재 처리

- 기본 개발 실행에서 Vite 서버·React Refresh·HMR WebSocket 경로를 제거하고 배포용 실행 경로를 재사용한다.
- HMR은 Vite의 nonce 지원을 사용한다. 개발 모드에서만 `ws://127.0.0.1:17321`을 허용하고, 배포 CSP에는 개발 오리진을 넣지 않는다. `unsafe-inline`, `unsafe-eval`과 광범위한 localhost 허용은 사용하지 않는다. meta CSP에서 적용되지 않는 `frame-ancestors`도 제거했다.
- 전역 Windows `disable-gpu-sandbox` 우회를 제거했다. GPU 및 renderer 샌드박스는 기본 활성화한다. `LLM_USAGE_MONITOR_GPU_SANDBOX=0`은 개발/테스트의 명시적인 비교에서만 우회하며 일반 배포 실행에서는 무시한다. `contextIsolation`, `webSecurity`는 활성화하고 `nodeIntegration`은 비활성화한다.
- 개발 실행은 `[runtime]`으로 시작 모드·Electron/Chromium 버전과 실패 단계를 출력한다. `did-fail-load`, `preload-error`, `render-process-gone`, `child-process-gone`, `renderer-console-error`, `startup-failed`를 구분한다. 계정·자격증 노출을 막기 위해 콘솔/예외 본문과 URL·경로를 중계하지 않는다.

### 실행 폴더 환경 비교 결과

같은 Electron 44.1.0, 같은 app.asar, 새 허구 데이터 프로필로 비교했다. 실제 GPU 비교는 에이전트의 제한된 실행 토큰 밖에서 수행했다.

| 실행 조건 | GPU 샌드박스 | 관찰 결과 |
| --- | --- | --- |
| 실제 packaged EXE | 활성 / 우회 | 각각 시작·종료 5회 + 프로필 동시 실행 통과 |
| node_modules의 원본 Electron + 같은 app.asar | 활성 / 우회 | 크래시 재현 |
| 원본 Electron을 일반 작업 폴더에 복사·이름 변경 | 활성 | GPU·renderer 크래시 재현 |
| 정상 packaged EXE를 위 문제 폴더로 복사 | 활성 | 동일 크래시 재현 |
| 원본 Electron 전체를 정상 package 폴더 하위에 복사 | 활성 | 시작·종료 5회 + 프로필 동시 실행 통과 |
| 위 정상 복사본으로 Forge·Vite HMR 실행 | 활성 | 시작·재로드 5회, 실제 WebSocket 연결, IPC·프로필 검사 통과 |

원본 Electron EXE는 공식 다운로드 zip과 SHA-256이 같았다. 원본과 package의 DLL·pak·snapshot 파일도 같았다. 따라서 바이너리 손상이나 GPU 드라이버만으로는 위 차이를 설명할 수 없다.

실패 폴더와 정상 package 폴더는 상속된 Windows ACL이 달랐다. 실패 폴더에서는 여러 AppContainer SID의 상속 항목이 관찰되었다. **현재 가장 유력한 원인은 실행 폴더의 권한/샌드박스 환경이다.** 폴더 이동에 따른 재현 차이는 확인했지만, 특정 ACE 하나의 인과관계나 권한을 추가한 프로그램까지 확정하지는 않았다. [Codex 공개 이슈 #27236](https://github.com/openai/codex/issues/27236)에도 유사한 권한 상속과 Electron GPU 종료 사례가 보고되어 있다.

시스템·사용자 프로필·node_modules의 ACL을 수정하지 않았다. 검증용 복사본만 만들고 정리했다. 환경에 남은 권한 문제를 앱의 CSP 완화나 GPU 샌드박스 해제로 덮지 않고, 기본 개발 실행에는 정상 동작한 패키징 경로를 사용한다. **이 PC의 기본 `dev:hmr` 경로에는 폴더 환경 문제가 남을 수 있다.** HMR 코드와 CSP의 성공 검증은 정상 권한을 가진 동일 런타임 복사본으로 수행했다.

### 재현 비교 절차 (PowerShell)

실제 계정 데이터 대신 내장 허구 데이터를 사용하는 테스트로 먼저 비교한다. 설치된 앱이나 기존 개발 프로필을 삭제하지 않는다.

```powershell
pnpm package

# 기본: 실제 packaged 실행 파일, 새 테스트 프로필, 5회 시작·종료 + 동시 실행
pnpm --dir apps/node exec playwright test tests/e2e/runtime.spec.ts

# 같은 app.asar를 개발용 Electron으로 실행
$env:LLM_USAGE_MONITOR_RUNTIME_MODE = 'asar'
pnpm --dir apps/node exec playwright test tests/e2e/runtime.spec.ts

# 나머지 조건을 고정하고 GPU 샌드박스 우회와 비교
$env:LLM_USAGE_MONITOR_GPU_SANDBOX = '0'
pnpm --dir apps/node exec playwright test tests/e2e/runtime.spec.ts
Remove-Item Env:LLM_USAGE_MONITOR_RUNTIME_MODE
pnpm --dir apps/node exec playwright test tests/e2e/runtime.spec.ts
Remove-Item Env:LLM_USAGE_MONITOR_GPU_SANDBOX
```

HMR 비교는 별도 터미널에서 허구 provider로 `pnpm dev:hmr`를 띄운 뒤 진행한다. 테스트는 별도의 프로필을 사용한다. Forge는 `apps/node/.vite` 산출물을 개발 모드로 바꾸므로 HMR 비교를 마친 후에는 다시 `pnpm package`한다.

```powershell
# 터미널 A
$env:LLM_USAGE_MONITOR_E2E = '1'
pnpm dev:hmr
# 종료 후
Remove-Item Env:LLM_USAGE_MONITOR_E2E

# 터미널 B
$env:LLM_USAGE_MONITOR_RUNTIME_MODE = 'hmr'
pnpm --dir apps/node exec playwright test tests/e2e/runtime.spec.ts
$env:LLM_USAGE_MONITOR_GPU_SANDBOX = '0'
pnpm --dir apps/node exec playwright test tests/e2e/runtime.spec.ts
Remove-Item Env:LLM_USAGE_MONITOR_RUNTIME_MODE
Remove-Item Env:LLM_USAGE_MONITOR_GPU_SANDBOX
```

`pnpm test:e2e:runtime`으로 최종 package와 기본 실행 검사를 한 번에 실행할 수도 있다. 위 비교 명령은 Node 앱 디렉터리에서 Playwright 설정을 해석한다.

같은 사용자 일반 터미널과 에이전트 환경도 구분해 기록한다. 차이가 있어야 실행 파일 경로·부모 프로세스·OS 실행 제한·프로필 등을 다음 후보로 좁힐 수 있다. 드라이버 변경, 버전 다운그레이드 또는 추가 샌드박스 해제를 근거 없이 적용하지 않는다.

### 검증 상태 (2026-09-07)

- 아키텍처 검사: 승인한 기존 위반 11건만 로컬 baseline으로 동결했고 새 위반 없이 통과.
- 변경 관련 단위 테스트: 4개 파일, 22개 통과. nonce 변환, 프로필 우선순위, 민감 본문 미출력, 빌드 실패·실행·취소, IPC 로딩 가드를 포함한다.
- 최종 packaged EXE: GPU 샌드박스 활성 상태에서 6개 E2E 통과. 5회 시작·재로드·종료, 최초 실행의 새로고침·토큰 표시·숨김/복원, 별도 프로필 동시 실행을 검사했다. 화면 PNG도 확인했다.
- 기본 실행기: 실제 패키징부터 EXE 시작까지 통과하고 취소 시 자신이 시작한 프로세스만 정리한 뒤 130을 반환했다. HMR 실행기에도 같은 종료 검사를 수행했다.
- HMR: 정상 권한의 동일 Electron 복사본에서 6개 E2E 통과. 실제 `ws://127.0.0.1:17321` 연결을 확인했다.
- 전체 단위/통합 테스트: 224개 통과, 기존 Antigravity runner 테스트 4개 실패. 테스트가 `agy.exe`라는 문자열에 의존하지만 resolver가 PC에 설치된 절대 경로를 반환해 fake PID와 종료 검사가 깨진다. 해당 provider·resolver·기존 테스트는 이번 작업에서 수정하지 않았고 단독 실행에서도 재현했다.
- 기존 UI E2E: 3개 실패 후 중단(16개 미실행). 과거의 `Gemini 5h 사용률` 접근성 이름을 찾지만 현재 UI 이름은 다르다. 기존 scaffold에도 변경 전 제목 `watching quota providers` 기대값이 남아 있다. 이번 작업에서 UI를 바꾸거나 기존 기대값을 완화하지 않았다.
- 타입 검사·ESLint·민감정보 검사 통과. macOS 실기 실행과 실제 벤더 계정의 quota 수집은 이번 런타임 검증 범위 밖이다.

개발 기본 실행은 검증됐으며 GPU 문제는 폴더 환경으로 범위를 좁혔다. Windows ACL 자체의 복구는 수행하지 않았다.

## 3. IPC 프레임 폐기 경고

`Render frame was disposed before WebFrameMain could be accessed`는 로딩·교체·크래시 상태의 renderer로 상태를 보내려 할 때 나타날 수 있다. GPU 종료가 먼저 발생했다면 이 경고는 후속 증상일 수 있다.

`publishState`의 기존 창 파괴·로딩·크래시 가드를 유지한다. 로딩 중 전송을 생략해도 renderer 마운트 후 `getState`로 최신 스냅샷을 받고 이후 구독으로 갱신한다. 해당 경로와 IPC 발신 프레임 검증을 별도로 테스트한다. 이 가드는 GPU 크래시나 React 부팅 실패의 해결책이 아니다.

---

## 4. Codex CLI 실행 실패 (`CLI Process execution failed` / 경로 불일치)

### 현상
- Codex 쿼터 조회 시 `CLI Process execution failed` 또는 `not_installed` 에러가 발생하며 쿼터 조회가 실패함.
- 사용자가 Codex CLI를 업데이트하거나 npm/pnpm/전용 인스톨러 등을 통해 설치 위치가 변경되었을 때 고정된 경로로는 실행 파일을 찾지 못함.

### 근본 원인
- `apps/node/src/shared/platform.ts`의 기본 실행 파일명이 Windows에서도 단순히 `"codex"`로 정의되어 있었으며, `process.env.PATH`에 등록되지 않았거나 업데이트 후 새로운 디렉터리(예: `OpenAI\Codex\bin\codex.exe`)에 설치된 바이너리를 발견하지 못함.

### 해결 방법
- **플랫폼별 다중 확장자 및 표준 디렉터리 동적 순회 로직 구현** (`apps/node/src/main/platform/index.ts`):
  1. `getExecutableCandidates`: Windows 환경에서 입력된 바이너리명에 대해 `.exe`, `.cmd`, `.bat` 등 가능한 확장자 후보군을 우선 순위별로 생성.
  2. `getPlatformFallbackDirectories`:
     - Windows: `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, `%APPDATA%\npm`, `%LOCALAPPDATA%\pnpm`, Bun, Git usr bin 등 주요 CLI 설치 디렉터리 순회.
     - macOS: `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` 등 순회.
  3. `resolveCliBinaryPath`:
     - 절대 경로가 전달된 경우 해당 파일 유효성 검사.
     - 상대/파일명인 경우 `PATH` 환경변수를 먼저 검색하고, 미발견 시 플랫폼 fallback 디렉터리를 순회하여 실제 존재하는 바이너리의 절대 경로를 반환.
  4. Codex Provider(`appServerClient.ts`) 및 Antigravity Provider(`processRunner.ts`)가 이 공통 resolver를 거쳐 프로세스를 기동하도록 통합.
