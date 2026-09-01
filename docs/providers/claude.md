# Claude Code provider 계약

## Windows PTY feasibility 기준

- 검증일: 2026-09-01
- 로컬 CLI: `Claude Code 2.1.252`
- 실행 인자: `claude --safe-mode --ax-screen-reader --restricted --strict-mcp-config --tools ""`
- PTY 구현: `node-pty 1.1.0`

probe는 OS 임시 디렉터리 바로 아래에 전용 작업 디렉터리를 만들고, Claude Code의 project 지침·hooks·plugins·skills·MCP를 safe mode로 비활성화한다. restricted mode와 빈 tool set도 적용한다. quota 화면을 받을 준비가 확인된 경우에만 PTY에 `/usage`와 정상 종료를 위한 `/exit`를 입력하며 일반 prompt는 보내지 않는다.

결과에는 5시간·주간 창 신호, quota 상세 신호, 종료 방식과 비식별 오류 코드만 남긴다. raw 화면, quota 수치, reset 값, 계정 식별자와 credential 관련 문자열은 출력·fixture·문서에 저장하지 않는다.

로그인·workspace trust 같은 예기치 않은 prompt가 나타나면 선택지를 입력하지 않고 프로세스를 종료한다. 안정적인 quota 화면을 얻지 못해도 OAuth 직접 호출로 자동 전환하지 않는다.

## 2026-09-01 게이트 결과

현재 Windows 환경에서는 새 임시 작업 디렉터리에 대한 workspace trust 확인이 먼저 나타났다. probe는 이를 `blocked_prompt`로 분류하고 `/usage`, `/exit`, 선택지와 모델 prompt를 하나도 보내지 않은 채 종료했다. 설치된 CLI의 도움말에서 trust 확인을 생략하는 공식 옵션은 비대화형 `--print`뿐이지만, `/usage`가 모델 prompt로 처리될 가능성을 배제할 수 없어 사용하지 않는다.

따라서 격리 PTY 경로의 기술적 안전성 검증은 완료했지만 quota 수집 feasibility는 통과하지 못했다. Phase 3의 후속 구현은 workspace trust를 변조하지 않는 실행 경계를 별도로 승인하기 전까지 중단한다. `--dangerously-skip-permissions`나 OAuth 직접 호출로 자동 전환하지 않는다.

## 실제 환경 smoke

`pnpm test:smoke:claude-pty`는 사용자가 명시적으로 실행하는 읽기 전용 검사다. 성공 조건은 `/usage`만으로 5시간·주간 quota 신호를 얻고 `/exit`로 정상 종료하며 모델 prompt를 전혀 보내지 않는 것이다. 현재 환경에서는 의도적으로 실패하며, 정제된 결과가 `blocked_prompt`, `sentUsageCommand: false`, `sentModelPrompt: false`인지 확인할 수 있다.
