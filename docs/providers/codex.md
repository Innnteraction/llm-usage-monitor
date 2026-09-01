# Codex provider 계약

## 요약

이 문서는 Codex quota provider를 수정할 때 사용하는 참조 계약이다. 앱은 App Server의 읽기 RPC만 호출하고 credential 파일에는 직접 접근하지 않는다. App Server를 실행한 Codex CLI가 인증 소유자로서 자체 refresh를 수행할 수 있으므로, 검증 대상은 파일 전체의 전후 동일성이 아니라 앱 코드의 직접 read/write 부재와 refresh 요청 금지다.

## 검증 기준

- 검증일: 2026-09-01
- 로컬 CLI: `codex-cli 0.151.0`
- 계약 확인 명령: `codex app-server generate-json-schema --out <temporary-directory>`
- 전송 방식: `codex app-server --stdio`

공개된 공식 문서에서 이 App Server RPC의 안정적인 계약을 확인할 수 없으므로, 설치된 CLI가 임시 디렉터리에 생성한 스키마를 해당 버전의 기준으로 삼는다. 생성된 전체 스키마와 실제 계정 응답은 저장소에 커밋하지 않는다.

## 사용하는 RPC

앱은 quota 표시에 필요한 다음 읽기 메서드만 사용한다.

- `account/read`: 인증 요구 조건과 화면에 표시할 계정 이메일을 확인한다. `requiresOpenaiAuth`만으로 현재 미인증을 뜻한다고 가정하지 않고, 계정 객체가 함께 없는 경우에만 로그인이 필요하다고 판정한다. 요청의 `refreshToken`은 생략하거나 `false`만 허용한다.
- `account/rateLimits/read`: 기본 rate-limit snapshot과 선택적인 limit별 snapshot을 읽는다.

응답에서는 `primary`, `secondary`, `rateLimitsByLimitId`의 사용률·reset Unix 시각·window 분 단위 길이와 limit 메타데이터를 유지한다. 계정 이메일은 현재 구독 계정을 구분하기 위한 `accountLabel`로 renderer에만 전달하며 로그·오류·stale cache에는 저장하지 않는다. credential, 원본 응답과 실제 계정·quota 값은 fixture·문서에 남기지 않는다.

`rateLimitsByLimitId`에서 identity가 정확히 `codex`이고 7일 길이로 확인된 창은 계정 `weekly`로 승격한다. Spark의 5시간·7일 창은 모델별 추가 한도로 보존하되 기본 화면에서는 접어 두어 이후 표시 옵션으로 확장할 수 있게 한다.

## 인증 경계

- 인증 파일을 직접 열거나 수정하지 않는다.
- 앱이 token refresh, 로그인 복구 또는 계정 전환을 요청하지 않는다.
- Codex CLI가 자체 정책으로 인증 상태를 갱신하는 것은 허용하되 앱이 파일 mutation이나 refresh RPC를 대신 수행하지 않는다.
- App Server stdout은 다음 단계의 프로세스 어댑터에서 프레이밍 즉시 파싱하며 원문을 저장하지 않는다.
- 알 수 없는 서버 확장 필드는 버리되 필수 quota 필드가 잘못된 경우 명시적 provider 오류로 처리한다.

## 실제 환경 smoke

`pnpm test:smoke:codex`는 사용자가 명시적으로 실행하는 읽기 전용 검사다. 현재 Codex CLI가 로그인된 환경에서 window 종류만 검증하며 사용률, reset 값, 계정 응답과 원본 stdout은 출력하거나 저장하지 않는다.
