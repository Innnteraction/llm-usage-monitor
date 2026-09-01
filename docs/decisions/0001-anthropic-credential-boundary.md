# Anthropic 구독 인증 경계 결정

## 상태

채택 — 2026-09-01

## 배경

Claude Code의 `/usage` 화면은 계정의 5시간·7일 quota를 제공하지만 환경과
계정 상태에 따라 모델별 Fable 창을 생략할 수 있다. 일부 벤치마크 앱은 로컬
Claude Code 구독 OAuth token을 읽어 비공개 usage endpoint를 직접 호출해 이
정보를 보완한다. 구현 가능성과 Anthropic이 허용하는 사용 방식은 별개이므로,
이 경로를 제품에 넣기 전에 공식 문서 기준으로 다시 검토했다.

## 공식 근거

- [Claude Code Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)는
  구독 OAuth를 Claude Code를 포함한 Anthropic 기본 앱의 일반 사용에 한정하고,
  제3자 제품에는 API key를 사용하도록 안내한다. 또한 제3자 개발자가
  Claude.ai credential이나 session token을 수집·저장·중간 처리하는 것을
  허용하지 않는다고 명시한다.
- [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms)는
  Anthropic API key 또는 명시적 허가가 없는 자동화 접근과 허용되지 않은
  수집을 제한한다.
- [Claude 계정 로그인 안내](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)는
  Claude Code의 구독 로그인을 Anthropic 소유 흐름으로 안내한다.
- [Claude Code statusline 문서](https://code.claude.com/docs/en/statusline)는
  지원되는 구조화 입력으로 `rate_limits.five_hour`와
  `rate_limits.seven_day`를 제공한다. 현재 문서에는 Fable 같은 모델별 quota
  계약이 없다.

## 결정

1. 앱은 Claude Code의 구독 OAuth token, credential 파일 또는 OS keychain을
   읽지 않는다.
2. 비공개 OAuth usage endpoint를 직접 호출하거나 구독 token을 요청에
   중계하지 않는다. 사용자 opt-in도 이 금지를 바꾸지 않는다.
3. v1 quota 기본 경로는 변경하지 않은 Claude Code CLI의 격리 PTY `/usage`다.
4. CLI 출력에 Fable 창이 있으면 표시하고, 없으면 수치나 reset을 추정하지
   않고 `not provided by Claude CLI`로 표시한다.
5. 공식 statusline은 5시간·7일 보조 입력 후보로만 유지한다. 기존 사용자
   설정을 덮어쓰지 않고 데이터 생명주기를 안전하게 정의할 수 있을 때 별도
   opt-in 설계로 검토한다.
6. Fable 자동 수집은 Anthropic이 지원 인터페이스를 공개하거나 이 사용 사례에
   서면 허가를 제공할 때만 다시 검토한다.

## 영향

- 벤치마크 앱에서 동작하는 비공개 구현을 그대로 채택하지 않는다.
- Fable이 보이지 않는 것은 0%나 오류가 아니라 현재 지원 source의 미제공
  상태다.
- 앱이 Claude Code CLI를 원형 그대로 실행하고 사용자가 Anthropic 로그인
  흐름을 직접 완료하는 현재 온보딩은 유지한다.
- API key는 모델 호출용 과금 인증이며 구독 quota 조회를 대체하지 않으므로,
  Fable 표시만을 위해 사용자에게 API key를 요구하지 않는다.
