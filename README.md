# LLM Usage Monitor

## 요약

LLM Usage Monitor는 Codex와 Claude Code 구독 계정의 5시간·주간 quota를 직관적으로 보여 주기 위한 Windows 트레이 앱이다. quota는 계정 전체의 벤더 서버 값을 주 정보로 다루고, 실제 토큰 사용량은 이 PC의 로컬 로그에서 집계한 보조 정보로 구분한다. v1은 Codex와 Claude Code를 필수 대상으로 한다.

## 제품 방향

- 트레이 아이콘을 누르면 보이는 TUI형 대시보드에 벤더별 `5h`와 `Weekly` 사용률을 가장 크게 배치한다.
- CSWAP처럼 고정폭 글꼴, 단순한 구획과 텍스트 진행 막대로 핵심 정보를 빠르게 읽게 한다.
- 사용률과 남은 비율, reset 카운트다운, 데이터 출처와 신선도를 함께 보여 준다. 로컬 토큰은 색으로 구분한 두 줄 보조 정보와 짧은 도움말로 읽을 수 있다.
- 벤더가 제공하지 않은 quota를 0%로 추정하지 않는다.
- 벤더 CLI가 인증을 소유한다. 이 앱은 기존 인증 파일을 수정·갱신·삭제하지 않는다.
- Electron + TypeScript로 구현한다. 가독성을 위해 기본 글꼴 크기는 110%로 적용한다.

## 문서

- [제품 컨셉과 데이터 계약](docs/product-concept.md)
- [벤치마크 조사](docs/benchmarks.md)
- [Agent 참조 인덱스](docs/agent/INDEX.md)

## 현재 범위

현재 미리보기 버전은 Codex·Claude quota를 읽어 Windows 트레이의 420×320 TUI형 팝오버에 표시한다. 첫 실행 또는 Claude 준비가 끝나지 않은 동안에는 팝오버를 열고, Claude quota를 한 번 정상 수집한 뒤부터는 트레이에서 조용히 시작한다. 진행 상태와 다음 작업은 [v1 로드맵](docs/plan/v1-roadmap.md)을 따른다.

기본 화면은 Codex `7d`, Claude `5h`·`7d`·`Fable`을 표시한다. `+N additional limits`를 누르면 수집된 추가 quota를 펼칠 수 있다. 긴 내용은 목록 안에서 세로로 스크롤하며, 계정·사용률·reset·토큰 설명은 마우스를 올리거나 Tab으로 초점을 옮겨 확인한다. Enter·Space로 버튼을 조작하고 Escape로 팝오버를 숨긴다. 테마는 Windows의 다크·라이트 설정을 자동으로 따른다.

Windows 로그인 시 시작과 종료는 트레이 아이콘의 우클릭 메뉴에서 선택한다. 자동 시작은 사용자 선택 사항이다. Phase 6의 자동 검사 결과와 남은 수동 확인 항목은 [검증 기록](docs/plan/phase6-validation.md)에 구분해 둔다.

## 미리보기 실행

Node.js 24와 Codex·Claude Code CLI가 필요하다. 저장소에서 다음 명령으로 개발 앱을 실행한다.

```powershell
corepack pnpm install
corepack pnpm dev
```

Claude가 로그인되지 않았으면 `sign in`, 전용 probe 폴더 승인이 필요하면 `prepare folder`를 누른다. 앱은 보이는 Windows Terminal만 열며 로그인과 폴더 trust 선택은 사용자가 Claude CLI에서 직접 완료한다. 완료 후 트레이 팝오버를 다시 열어 `refresh`를 누른다.

unsigned Windows x64 설치 파일은 다음 명령으로 만든다.

```powershell
corepack pnpm make
```

산출물은 `out/make/squirrel.windows/x64/LLM-Usage-Monitor-Setup.exe`에 생성된다. 코드 서명이 없어 Windows SmartScreen 경고가 나타날 수 있다. 제거는 Windows의 설치된 앱 목록에서 **LLM Usage Monitor**를 선택한다.
