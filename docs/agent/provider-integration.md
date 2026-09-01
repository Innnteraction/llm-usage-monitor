# Provider 통합 계약

## 요약

이 문서는 quota provider나 로컬 토큰 스캐너를 구현·수정하는 Agent를 위한 참조 문서다. provider는 벤더 CLI의 인증 소유권을 유지하고 UI에 정규화된 snapshot만 제공해야 한다. quota를 로컬 토큰으로 추정하거나 미제공 값을 0으로 생성하지 않는다. 작업 전에 source·자격증·실패 경계를 고정하고, 성공·대표 실패·무변조를 검증한다.

## 통합 전에 고정할 사항

provider 작업을 시작하기 전에 다음을 코드·설정·공식 문서로 확인한다.

1. 사용자가 보려는 quota 창과 벤더가 실제 제공하는 필드
2. 수집 source의 공개·비공개 여부, 버전, fallback 순서와 마지막 검증 revision
3. 인증정보의 소유자, 읽기 권한과 갱신·저장 주체
4. 계정 전체 quota와 장치 로컬 토큰의 각각의 적용 범위
5. CLI 미설치, 미인증, 429, 서비스 장애, 타임아웃과 파서 변경 시 표시할 상태

공개 계약이 없는 endpoint나 CLI 출력을 사용하면 비공개·변경 가능성을 문서화하고 파서 불일치를 명시적 오류로 다룬다.

## 인증 소유권

| provider | 기본 quota source | 자격증 규칙 |
| --- | --- | --- |
| Codex | `codex app-server` RPC | `auth.json`을 직접 사용하지 않고 로그인·refresh를 Codex CLI에 위임한다. |
| Claude Code | 격리 PTY의 `/usage` | CLI 소유를 우선한다. 직접 OAuth 호출은 사용자 opt-in·읽기 전용이며 refresh·저장·삭제를 금지한다. |
| Gemini | v1 미구현 | 지원 계정과 API 계약을 다시 검증하기 전에 자격증 경로를 추가하지 않는다. |

자격증 읽기가 필요한 opt-in 경로는 최소 필드만 메모리에서 사용하고 renderer나 영구 캐시에 전달하지 않는다. 자격증 파일의 원문, 크기, hash, token 일부를 로그하지 않는다.

## quota mapping

- provider 응답을 `QuotaWindow` 목록으로 매핑한 후 UI에 전달한다.
- `five_hour`와 `weekly`는 의미가 확인된 벤더 필드에만 매핑한다. 시간 길이나 label만 보고 임의로 승격시키지 않는다.
- 사용률은 0부터 100 사이인지 검증한다. 범위 밖 값, 잘못된 reset 시각과 필수 필드 누락은 파서 실패로 취급한다.
- 벤더가 창을 생략하면 이전 스냅샷과 신선도를 대조한다. 미제공이 확인되면 unavailable, 일시 응답 이상이면 stale로 분리한다.
- provider별 모델 전용·추가 창은 고유 id를 유지하고 `model_weekly` 또는 `other`로 정규화한다.

## 로컬 토큰 스캔

- 스캔 루트와 환경 변수 override의 우선순위를 provider별로 명시한다.
- JSONL을 한 번에 문자열로 읽지 않고 청크로 스트리밍한다. UTF-8 멀티바이트와 한 줄이 청크 경계를 넘는 경우를 보존한다.
- 파일 식별자, 크기, 수정 시각과 안전한 byte offset으로 증분 상태를 추적한다. 파일이 작아지거나 교체되면 해당 파일만 다시 스캔한다.
- 중복된 루트·세션·event를 중복 집계하지 않는다. 파일 일부를 파싱하지 못했다면 전체를 0으로 바꾸지 않고 `partial: true`와 익명화된 오류 건수를 보고한다.
- 스레드 이름·프롬프트·응답 본문은 토큰 합계에 필요하지 않으며 renderer나 로그로 보내지 않는다.

## 실패와 stale 규칙

- 마지막 정상 snapshot을 provider별로 보존하고 실패한 갱신은 데이터를 지우지 않는다.
- stale snapshot에는 `lastSuccessfulAt`, 실패 code와 재시도 시각을 함께 제공한다.
- 사용자용 오류는 복구 행동을 설명하되 원본 출력, URL query, 헤더, 자격증 경로와 계정 식별자를 포함하지 않는다.
- 수동 refresh와 주기 refresh가 겹치면 요청을 병합하고, 느린 이전 응답이 최신 snapshot을 덮어쓰지 않도록 generation을 비교한다.

## 테스트 계약

provider별 테스트 fixture는 실제 자격증과 원본 사용자 데이터를 포함하지 않는다. 다음 경로를 자동화한다.

1. 정상 5시간·주간 창과 reset 매핑
2. 한 창이 없거나 벤더가 미제공으로 표시한 경우
3. CLI 미설치와 미인증·만료 상태
4. 429의 `Retry-After`, 일시 네트워크 실패와 backoff 상한
5. 필드 누락, 범위 밖 사용률, 잘못된 reset과 알 수 없는 CLI 출력
6. 마지막 정상값의 stale 유지와 provider 실패 격리
7. JSONL 청크·멀티바이트 경계, 증분 추가, truncate·교체, 중복 루트와 partial 파싱
8. 로그·오류·IPC payload에 token, cookie, 헤더와 credential 본문이 없음
9. opt-in 자격증 읽기 전후에 해당 파일이 변경되지 않음

실제 provider에 접속하는 통합 테스트는 사용자가 명시적으로 실행할 때만 수행하고, 기본 테스트는 로컬 fake process·HTTP server·fixture로 완전히 재현한다.
