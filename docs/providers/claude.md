# Claude Code provider 계약

## Windows PTY feasibility 기준

- 검증일: 2026-09-01
- 로컬 CLI: `Claude Code 2.1.252`
- 실행 인자: `claude --safe-mode --ax-screen-reader --restricted --strict-mcp-config --tools ""`
- PTY 구현: `node-pty 1.1.0`

probe는 `%LOCALAPPDATA%\LLM Usage Monitor\claude-probe`라는 고정된 앱 전용 작업 디렉터리를 사용한다. Claude Code의 project 지침·hooks·plugins·skills·MCP를 safe mode로 비활성화하고 restricted mode와 빈 tool set도 적용한다. quota 화면을 받을 준비가 확인된 경우에만 PTY에 `/usage`를 입력하고, 결과를 읽은 뒤 `Escape`로 패널을 닫아 `/exit`한다. 일반 prompt는 보내지 않는다.

결과에는 5시간·주간 창 신호, quota 상세 신호, 종료 방식과 비식별 오류 코드만 남긴다. raw 화면, quota 수치, reset 값, 계정 식별자와 credential 관련 문자열은 출력·fixture·문서에 저장하지 않는다.

로그인·workspace trust 같은 예기치 않은 prompt가 나타나면 선택지를 입력하지 않고 프로세스를 종료한다. 안정적인 quota 화면을 얻지 못해도 OAuth 직접 호출로 자동 전환하지 않는다.

## 2026-09-01 게이트 결과

새 작업 디렉터리에서는 workspace trust 확인이 먼저 나타난다. 앱은 이를 `blocked_prompt`로 분류하고 `/usage`, `/exit`, 선택지와 모델 prompt를 하나도 보내지 않은 채 종료한다. 사용자가 고정 probe 폴더를 대상으로 보이는 Claude CLI를 열어 최초 1회 직접 승인한 뒤에만 백그라운드 probe를 실행한다. 앱은 trust 선택지를 자동 입력하거나 Claude 설정 파일을 직접 수정하지 않는다.

설치된 CLI의 도움말에서 trust 확인을 생략하는 공식 옵션은 비대화형 `--print`뿐이지만, `/usage`가 모델 prompt로 처리될 가능성을 배제할 수 없어 사용하지 않는다. `--dangerously-skip-permissions`나 OAuth 직접 호출로 자동 전환하지 않는다.

## 대체 수집 경로 검토

Anthropic의 공식 statusline 입력은 Claude Code 2.1.251부터 `rate_limits.five_hour`와 `rate_limits.seven_day`의 구조화된 사용률·reset epoch를 제공한다. 그러나 이 값은 Pro·Max 구독에서 첫 모델 API 응답 이후에만 나타나며, 사용자의 `statusLine` 설정 또는 실행 중인 세션과 협력해야 한다. 따라서 독립 상시 수집기의 기본 경로로 사용하지 않고, 기존 statusline을 덮어쓰지 않는 명시적 opt-in 보조 입력 후보로 남긴다.

CodexBar의 고정 probe 폴더와 빈 tool set은 채택한다. trust·telemetry prompt 자동 응답과 Claude 프로젝트 JSONL 삭제는 채택하지 않는다. Windows용 ClaudeBar와 여러 statusline 도구가 사용하는 credential 직접 읽기·OAuth usage API 호출도 현재 인증 경계에 맞지 않아 v1 기본 경로에서 제외한다.

## 실제 환경 smoke

`pnpm test:smoke:claude-pty`는 사용자가 명시적으로 실행하는 읽기 전용 검사다. 성공 조건은 `/usage`만으로 5시간·주간 quota 신호를 얻고 `/exit`로 정상 종료하며 모델 prompt를 전혀 보내지 않는 것이다. trust가 준비되지 않았으면 정제된 결과가 `blocked_prompt`, `sentUsageCommand: false`, `sentModelPrompt: false`로 실패한다.

최초 준비는 고정 probe 폴더에서 위의 실행 인자로 Claude를 직접 열고 해당 빈 폴더만 trust한 뒤 `/exit`하는 과정이다. 이 작업은 설치·최초 실행 UI에서 사용자 동작으로 제공하며 백그라운드에서 대신 승인하지 않는다.

2026-09-01 실제 로그인된 Claude Code 2.1.252에서 최초 trust 이후 smoke가 통과했다. 5시간·주간·quota 상세 신호를 얻었고 모델 prompt를 보내지 않았으며 `Escape`로 usage 패널을 닫은 뒤 `/exit`로 정상 종료했다. 실제 quota 수치와 raw 화면은 출력하거나 저장하지 않았다.

## 정규화 계약

파서는 `Current session` 계열 header를 `five_hour`, 전체 모델의 `Current week`를 `weekly`, 모델명이 붙은 주간 header를 `model_weekly`로 변환한다. 각 header 다음 영역에서 확인된 사용률과 reset만 사용한다. `remaining`으로 표현된 비율은 사용률로 변환하지만, 비율이 없거나 범위를 벗어난 창은 만들지 않는다.

필수 5시간·주간 창이 모두 확인되면 `fresh` snapshot으로 게시한다. CLI 미설치, 미인증, workspace trust 대기, timeout, 프로세스 종료와 출력 변경은 서로 구분된 sanitized 오류로 변환한다. 필수 창이 누락되면 0%로 추정하지 않고 두 창 모두 `unavailable`로 유지한다.

## Electron 패키지 계약

Vite main bundle은 `node-pty`를 external dependency로 유지한다. Forge의 Vite copy 경계 뒤에서 라이선스·runtime JavaScript와 Windows x64 prebuild만 allowlist로 staging하고, native binary는 `app.asar.unpacked`에 둔다. 다른 플랫폼 binary, source map, 테스트와 PDB는 패키지에 넣지 않는다.

`pnpm test:smoke:claude-packaged`는 패키지를 새로 만든 뒤 개발 Electron이 아닌 생성된 앱 실행 파일을 직접 연다. 2026-09-01 Electron 44.1.0 패키지에서 Claude CLI PTY를 spawn하고 `fresh` quota snapshot을 얻는 데 성공했다. 이 검사는 실제 사용률이나 raw 화면을 assertion 메시지·fixture·로그에 남기지 않는다.

현재 Windows x64 prebuild는 실제 개발 실행과 패키지 실행으로 ABI 호환성을 검증한다. Forge의 source rebuild는 이 PC에 설치되지 않은 Visual Studio Spectre 완화 라이브러리를 요구하므로 `rebuildConfig.onlyModules`를 빈 목록으로 두고 사용하지 않는다.
