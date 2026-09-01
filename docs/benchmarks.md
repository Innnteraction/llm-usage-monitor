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
| [Claude Code](https://github.com/anthropics/claude-code) | `f275fa282e76c5e5456912268f2c367a7f4f4797` | 공식 statusline `rate_limits`, trust·settings 계약 |
| [ClaudeBar](https://github.com/daybigo/ClaudeBar) | `92d357b0af6cf577a4b8dfe4a53757d714817d76` | Windows 트레이 UX와 OAuth quota 구현 비교 |
| [claude-usage-monitor](https://github.com/aiedwardyi/claude-usage-monitor) | `d2829ede613e3444185245a915dd6daa45112706` | statusline quota cache와 5분 polling 비교 |
| [clauddy](https://github.com/renatoaug/claude-usage-monitor) | `2c4c405f5a7b80c8c9dce1e66f117a3325b762bc` | 독립 OAuth·로컬 토큰 방식의 제외 근거 |

검증일은 모두 2026-09-01이다. revision은 `git ls-remote <repository> HEAD`로 확인했다.

## 적용할 패턴

### quota를 정보 계층의 최상단에 둔다

claude-swap의 대시보드는 계정별 5시간·7일 사용률과 reset을 한눈에 비교하도록 구성된다. LLM Usage Monitor는 계정 전환 기능을 초기 범위에 넣지 않지만, 5h/Weekly과 reset을 가장 짧은 시선 이동으로 읽게 하는 정보 우선순위를 따른다.

### 수집 소스와 인증 소유자를 드러낸다

CodexBar는 Codex에서 OAuth API, web dashboard, CLI RPC를 별도 소스로 구분하고, 자격증이 stale일 때 공유 `auth.json`을 갱신하지 않고 Codex CLI에 복구를 위임한다. Claude에서도 OAuth·Web·CLI 경로를 분리한다. 다만 동작하는 벤치마크 구현은 Anthropic의 허가를 입증하지 않는다. LLM Usage Monitor는 [Anthropic 인증 경계 결정](decisions/0001-anthropic-credential-boundary.md)에 따라 Claude 구독 credential 재사용과 비공개 OAuth usage 호출을 채택하지 않는다.

- [Codex provider 자료](https://github.com/steipete/CodexBar/blob/8a732e743564abdb68ab3bee9332153ef88597a4/docs/codex.md)
- [Claude provider 자료](https://github.com/steipete/CodexBar/blob/8a732e743564abdb68ab3bee9332153ef88597a4/docs/claude.md)
- [Provider 전체 자료](https://github.com/steipete/CodexBar/blob/8a732e743564abdb68ab3bee9332153ef88597a4/docs/providers.md)

### quota와 토큰의 적용 범위를 분리한다

codex-usage-monitor는 계정 전체의 quota와 현재 장치의 로컬 로그 토큰을 다른 범위로 안내한다. Tokscale은 Codex의 `~/.codex/sessions/`와 Claude Code의 `~/.claude/projects/`를 비롯한 여러 로컬 소스에서 토큰을 집계한다. 따라서 로컬 토큰으로 계정 quota를 역산하지 않고, 파일이 크거나 진행 중일 수 있음을 전제로 청크·증분 파싱을 사용한다.

### Claude의 구조화된 공식 신호를 보조 후보로 둔다

[Anthropic statusline 문서](https://code.claude.com/docs/en/statusline#rate-limit-usage)는 Claude Code 2.1.251부터 `rate_limits.five_hour`와 `rate_limits.seven_day`를 구조화된 값으로 제공한다고 명시한다. 화면 파싱보다 안정적인 계약이지만 첫 모델 API 응답 이후에만 값이 생기고 사용자 statusline 설정과 충돌할 수 있다. v1 기본 수집은 고정 폴더의 `/usage` PTY를 유지하고, statusline bridge는 기존 설정을 덮어쓰지 않는 opt-in 설계가 가능할 때만 다시 검토한다.

CodexBar는 고정된 `ClaudeProbe` 폴더, 빈 tool set, session ID와 probe 세션 산출물 정리를 사용한다. 이 중 고정 폴더와 tool 차단은 적용한다. 첫 실행 prompt 자동 응답은 사용자 직접 trust로 대체하고, 벤더 세션 JSONL 삭제는 현재 무변조 규칙 때문에 적용하지 않는다.

## 적용하지 않는 범위

- claude-swap의 계정 백업·교체·자동 전환은 인증 상태를 쓰는 기능이므로 참고하지 않는다.
- CodexBar의 브라우저 cookie 자동 가져오기와 다중 provider 전체를 v1에 반영하지 않는다.
- codex-usage-monitor의 VS Code 확장 형태와 상세 분석 차트는 초기 트레이 앱 범위에서 제외한다.
- Tokscale의 리더보드·제출·소셜 인증 기능은 필요하지 않다.
- ClaudeBar와 일부 도구의 `.credentials.json` 직접 읽기 및 비공개 OAuth usage API 호출은 공식 인증 경계와 맞지 않아 구현하지 않는다.
- clauddy는 검증 revision에 명시적 저장소 라이선스가 없어 코드·문구를 반입하지 않는다.

## 라이선스와 재검증

이 조사는 공개 문서와 구조적 패턴만 참고했고 외부 코드·문구·자산을 반입하지 않았다. 후속 구현에서 외부 자료를 반입할 때는 해당 revision의 라이선스와 저작권 고지를 먼저 확인하고 출처를 기록한다. upstream 설계를 기반으로 provider를 구현하기 전에는 저장된 revision과 최신 HEAD의 차이를 다시 검토한다.
