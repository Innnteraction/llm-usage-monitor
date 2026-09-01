# Codex provider 계약

## 검증 기준

- 검증일: 2026-09-01
- 로컬 CLI: `codex-cli 0.151.0`
- 계약 확인 명령: `codex app-server generate-json-schema --out <temporary-directory>`
- 전송 방식: `codex app-server --stdio`

공개된 공식 문서에서 이 App Server RPC의 안정적인 계약을 확인할 수 없으므로, 설치된 CLI가 임시 디렉터리에 생성한 스키마를 해당 버전의 기준으로 삼는다. 생성된 전체 스키마와 실제 계정 응답은 저장소에 커밋하지 않는다.

## 사용하는 RPC

앱은 quota 표시에 필요한 다음 읽기 메서드만 사용한다.

- `account/read`: 인증 필요 여부와 비식별 계정 종류를 확인한다. 요청의 `refreshToken`은 생략하거나 `false`만 허용한다.
- `account/rateLimits/read`: 기본 rate-limit snapshot과 선택적인 limit별 snapshot을 읽는다.

응답에서는 `primary`, `secondary`, `rateLimitsByLimitId`의 사용률·reset Unix 시각·window 분 단위 길이와 비식별 limit 메타데이터만 유지한다. 계정 이메일, credential, 원본 응답과 quota 실제 값은 로그·fixture·문서에 남기지 않는다.

## 인증 경계

- 인증 파일을 직접 열거나 수정하지 않는다.
- 앱이 token refresh, 로그인 복구 또는 계정 전환을 요청하지 않는다.
- App Server stdout은 다음 단계의 프로세스 어댑터에서 프레이밍 즉시 파싱하며 원문을 저장하지 않는다.
- 알 수 없는 서버 확장 필드는 버리되 필수 quota 필드가 잘못된 경우 명시적 provider 오류로 처리한다.
