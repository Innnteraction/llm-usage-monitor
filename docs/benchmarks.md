# 벤치마크 조사

## 요약

이 문서는 LLM Usage Monitor의 정보 구조와 수집 경계를 검토하는 구현자를 위한 조사 기록이다. 2026-09-01의 각 저장소 HEAD를 기준으로, quota는 벤더가 제공한 계정 창으로 보이고 토큰은 로컬 로그 범위로 구분해야 한다는 결론을 얻었다. 참고 프로젝트의 코드나 문구는 반입하지 않았다. 후속 구현 전에는 아래 revision과 현재 upstream의 차이를 다시 확인한다.

## 검증 스냅샷

| 프로젝트 | 검증 revision | 참고 범위 |
| --- | --- | --- |
| [claude-swap](https://github.com/realiti4/claude-swap) | `27c634ea12a73ca3aae72f8ed7d8840779672ddf` | 다중 계정 5h/7d 현황, reset, 상시 대시보드 |
| [CodexBar](https://github.com/steipete/CodexBar) | `8a732e743564abdb68ab3bee9332153ef88597a4` | provider 소스 선택, stale/fallback, 인증 경계 |
| [codex-usage-monitor](https://github.com/kimbyungsu/codex-usage-monitor) | `72b00b188e6546e1e1851e8f6046acfdb810169e` | quota와 로컬 토큰 분리, 추세·소진 예상 |
| [Tokscale](https://github.com/junhoyeo/tokscale) | `029a1baf7b7e55dbca176f65b47e1537543f2857` | 다중 coding agent JSONL 토큰 스캔 |

검증일은 모두 2026-09-01이다. revision은 `git ls-remote <repository> HEAD`로 확인했다.

## 적용할 패턴

### quota를 정보 계층의 최상단에 둔다

claude-swap의 대시보드는 계정별 5시간·7일 사용률과 reset을 한눈에 비교하도록 구성된다. LLM Usage Monitor는 계정 전환 기능을 초기 범위에 넣지 않지만, 5h/Weekly과 reset을 가장 짧은 시선 이동으로 읽게 하는 정보 우선순위를 따른다.

### 수집 소스와 인증 소유자를 드러낸다

CodexBar는 Codex에서 OAuth API, web dashboard, CLI RPC를 별도 소스로 구분하고, 자격증이 stale일 때 공유 `auth.json`을 갱신하지 않고 Codex CLI에 복구를 위임한다. Claude에서도 OAuth·Web·CLI 경로를 분리한다. LLM Usage Monitor는 v1에서 CLI 소유 경로를 우선하고, 직접 자격증 재사용을 사용자가 켜는 읽기 전용 fallback으로 제한한다.

- [Codex provider 자료](https://github.com/steipete/CodexBar/blob/8a732e743564abdb68ab3bee9332153ef88597a4/docs/codex.md)
- [Claude provider 자료](https://github.com/steipete/CodexBar/blob/8a732e743564abdb68ab3bee9332153ef88597a4/docs/claude.md)
- [Provider 전체 자료](https://github.com/steipete/CodexBar/blob/8a732e743564abdb68ab3bee9332153ef88597a4/docs/providers.md)

### quota와 토큰의 적용 범위를 분리한다

codex-usage-monitor는 계정 전체의 quota와 현재 장치의 로컬 로그 토큰을 다른 범위로 안내한다. Tokscale은 Codex의 `~/.codex/sessions/`와 Claude Code의 `~/.claude/projects/`를 비롯한 여러 로컬 소스에서 토큰을 집계한다. 따라서 로컬 토큰으로 계정 quota를 역산하지 않고, 파일이 크거나 진행 중일 수 있음을 전제로 청크·증분 파싱을 사용한다.

## 적용하지 않는 범위

- claude-swap의 계정 백업·교체·자동 전환은 인증 상태를 쓰는 기능이므로 참고하지 않는다.
- CodexBar의 브라우저 cookie 자동 가져오기와 다중 provider 전체를 v1에 반영하지 않는다.
- codex-usage-monitor의 VS Code 확장 형태와 상세 분석 차트는 초기 트레이 앱 범위에서 제외한다.
- Tokscale의 리더보드·제출·소셜 인증 기능은 필요하지 않다.

## 라이선스와 재검증

이 조사는 공개 문서와 구조적 패턴만 참고했고 외부 코드·문구·자산을 반입하지 않았다. 후속 구현에서 외부 자료를 반입할 때는 해당 revision의 라이선스와 저작권 고지를 먼저 확인하고 출처를 기록한다. upstream 설계를 기반으로 provider를 구현하기 전에는 저장된 revision과 최신 HEAD의 차이를 다시 검토한다.
