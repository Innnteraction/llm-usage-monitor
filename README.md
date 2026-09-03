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

현재 미리보기 버전은 Codex·Claude와 Antigravity(`agy`) quota를 읽어 Windows 트레이의 480×360 TUI형 팝오버에 표시한다. 첫 실행 또는 Claude 준비가 끝나지 않은 동안에는 팝오버를 열고, Claude quota를 한 번 정상 수집한 뒤부터는 트레이에서 조용히 시작한다. 진행 상태와 다음 작업은 [v1 로드맵](docs/plan/v1-roadmap.md)을 따른다.

기본 quota는 Codex `7d`, Claude `5h`·`7d`·`Fable`이다. `+N additional limits`를 누르면 수집된 추가 quota를 펼칠 수 있다. Codex의 `gpt-reserve Weekly`는 당분간 표시와 추가 한도 개수에서 제외하지만 수집 데이터는 보존한다. Antigravity는 별도 카드에서 Gemini 및 Claude/GPT 모델군의 5시간·주간 한도를 표시한다. 세 번째 카드와 펼친 내용은 목록 안에서 세로로 스크롤하며 헤더·하단 조작부는 고정된다.

Antigravity는 v1 필수 대상이 아닌 미리보기 확장이다. 설치되지 않았거나 로그인되지 않은 CLI는 오류 상태로 표시하며 Codex·Claude 수집은 계속된다. Antigravity 계정명과 로컬 토큰은 제공하지 않는다. 모델군 이름의 Gemini는 별도 Gemini CLI 지원을 뜻하지 않는다. [지원 버전·수집 계약](docs/providers/antigravity.md)을 참고한다.

Windows 로그인 시 시작과 종료는 트레이 아이콘의 우클릭 메뉴에서 선택한다. 자동 시작은 사용자 선택 사항이다. Phase 6의 자동 검사 결과와 남은 수동 확인 항목은 [검증 기록](docs/plan/phase6-validation.md)에 구분해 둔다.

## 화면 조작과 테마

앱 하단의 `? Help`에 마우스를 올리거나 키보드 초점을 옮기면 영어 조작 안내가 열린다. 왼쪽의 이모지 버튼으로 토큰 표시와 테마를 바꾸고 오른쪽에서 단축키를 확인할 수 있다. 단축키는 앱 창에 초점이 있을 때만 동작한다.

| 하고 싶은 일 | 조작 |
| --- | --- |
| 다음·이전 버튼으로 이동 | `Tab`·`Shift+Tab` |
| 로컬 토큰 정보 켜기·끄기 | `🪙` 버튼 또는 `Ctrl+Shift+T` |
| 밝은·어두운 테마 전환 | `🌙`·`☀️` 버튼 또는 `Ctrl+Shift+L` — 아이콘은 현재 테마 |
| 새로고침·추가 quota 펼치기·도움말 열기 | 해당 버튼에서 `Enter` 또는 `Space` |
| 계정·사용률·reset·토큰의 자세한 설명 보기 | 해당 텍스트에 마우스를 올리거나 키보드 초점 이동 |
| 팝오버 숨기기 | `Esc` — 앱은 트레이에서 계속 실행됨 |
| Windows 로그인 시 시작·앱 종료 | 트레이 아이콘 우클릭 메뉴 |

토큰 정보를 끄면 팝오버가 480×304로 줄어든다. 표시만 숨기므로 로컬 토큰 집계와 quota 갱신은 계속된다. 다시 켜면 기존 480×360 크기로 돌아온다. 추가 quota 펼침 상태는 유지하며 긴 내용은 목록 안에서 스크롤한다.

처음에는 Windows의 다크·라이트 설정을 자동으로 따른다. 직접 전환한 테마와 토큰 표시 선택은 팝오버를 숨기거나 새로고침해도 유지되지만 저장되지는 않는다. 앱을 종료하고 다시 실행하면 토큰 표시 켜짐과 Windows 자동 테마로 돌아온다.

툴팁은 대상 아래에 표시하되 하단 안내 영역이나 화면 밖으로 넘어갈 때 위쪽으로 열린다. 다른 설명 버튼을 덮는 경우에도 위쪽 공간이 충분하면 위로 표시한다.

## 미리보기 실행

Node.js 24와 Codex·Claude Code CLI가 필요하다. 저장소에서 다음 명령으로 개발 앱을 실행한다.

```powershell
corepack pnpm install
corepack pnpm dev
```

Antigravity 카드도 사용하려면 PATH에서 실행할 수 있는 `agy` 1.1.11 이상 1.1.x와 해당 CLI의 로그인 상태가 필요하다. 앱은 로그인·인증정보를 대신 관리하지 않는다. CLI 설치·로그인 후 `refresh`로 다시 확인한다. 개발 앱이 이미 열려 있으면 트레이 메뉴에서 종료한 뒤 `corepack pnpm dev`를 다시 실행해 main process 변경도 반영한다. 기존 설치 파일은 개발 코드 변경으로 갱신되지 않는다.

Claude가 로그인되지 않았으면 `sign in`, 전용 probe 폴더 승인이 필요하면 `prepare folder`를 누른다. 앱은 보이는 Windows Terminal만 열며 로그인과 폴더 trust 선택은 사용자가 Claude CLI에서 직접 완료한다. 완료 후 트레이 팝오버를 다시 열어 `refresh`를 누른다.

unsigned Windows x64 설치 파일은 다음 명령으로 만든다.

```powershell
corepack pnpm make
```

산출물은 `out/make/squirrel.windows/x64/LLM-Usage-Monitor-Setup.exe`에 생성된다. 코드 서명이 없어 Windows SmartScreen 경고가 나타날 수 있다. 제거는 Windows의 설치된 앱 목록에서 **LLM Usage Monitor**를 선택한다.
