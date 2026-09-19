# 공유 캐시 v2 계약

## 위치와 소유권

Windows는 `%LOCALAPPDATA%\llm-usage-monitor\shared`, macOS는 `~/Library/Application Support/llm-usage-monitor/shared`를 사용한다. 수집·저장 계층만 이 디렉터리에 접근한다. renderer에는 정규화된 AppSnapshot만 전달한다.

실제 실행은 캐시 접근·수집 전에 127.0.0.1 TCP listener를 획득한다. 절대 경로의 구분자를 `/`로 바꾸고 Windows ASCII 대문자만 소문자로 바꾼 UTF-8 문자열을 SHA-256으로 해시한다. 앞 2바이트의 big-endian 값으로 `49152 + value % 16384` 포트를 계산한다. 종료 작업과 캐시 저장이 끝날 때까지 listener를 유지한다. 같은 포트를 쓰는 다른 프로그램도 안전하게 실행 거부로 처리한다. demo는 격리된 허구 데이터만 사용한다.

## quota-v2.json

최상위는 `{schemaVersion: 2, providers: [...]}`이다. provider에는 `providerId`, `status`, `fetchedAt`, `lastSuccessfulAt`, `quotaWindows`만 저장한다. quotaWindow는 기존 정규화 계약을 사용한다. 계정명·authKind·오류·토큰·장애 응답은 저장하지 않는다.

복구 시 provider와 값이 있는 quota는 stale, 미제공 quota는 unavailable로 유지한다. 표시 기준 시각은 lastSuccessfulAt이다. 정상 수집 응답은 quota 전체를 대체하며 토큰과 장애 상태는 보존한다. 실패 응답만 마지막 정상 quota와 오류를 함께 표시한다.

새 파일이 없을 때 기존 Node `usage-snapshot-v1.json`을 검증해 가져온다. 기존 파일은 변경하지 않는다. 손상·알 수 없는 버전은 빈 캐시로 복구한다. 새 버전을 쓰지 않는 구버전 앱과의 동시 실행은 보장하지 않는다.

## local-usage-index-v2.json

최상위는 `{schemaVersion: 2, providers: {codex: section, claude: section}}`이다. section은 `files`와 선택적 `rootKey`, `summary`를 가진다. summary는 LocalTokenUsage이며 calculatedAt을 원래 값으로 복구한다. 재검증 완료 전에는 기존 보조 영역에 rechecking을 표시한다(같은 provider의 다른 갱신 작업이 진행 중이어도 유지).

| 필드 | 공통 규칙 |
|---|---|
| rootKey | 실제 경로 또는 절대 경로, `/` 구분자, Windows `//?/` 제거·ASCII 소문자화 후 SHA-256 |
| fileKey | SHA-256(rootKey + NUL + 상대 경로의 `/` 표기) |
| identity | 파일 생성 시각의 Unix 밀리초 정수 문자열 SHA-256 |
| size, mtimeMs | byte 크기, Unix 밀리초(소수 버림) |
| offset | 개행까지 완성된 마지막 줄 다음 byte 위치 |
| boundaryHash | 첫 min(offset,4096) bytes + offset 직전 min(offset,4096) bytes를 이어 SHA-256; 겹치는 구간도 두 번 반영 |
| messages 키 | Claude message.id UTF-8 SHA-256 |
| contribution | input/output/cacheRead/cacheWrite의 안전한 비음수 정수 |
| lastCumulative | Codex 마지막 누적 token_count 값 |
| errorCount, observedFrom | 검증 오류 수, 최초 관측 시각 |

원본 경로·메시지 ID·본문은 캐시에 넣지 않는다. 모든 정수는 0부터 2^53−1까지다. 선택적 값 없음은 JSON null 대신 키 생략으로 표현한다. 시각은 RFC3339이며 `.000Z`와 `Z`는 같은 시각이다.

루트 우선순위는 `CODEX_HOME/sessions`, `CLAUDE_CONFIG_DIR/projects`, 미설정 시 홈의 `.codex/sessions`, `.claude/projects`이다. 심볼릭 링크를 따라 재귀 탐색하지 않는다. 루트가 달라지면 해당 section을 재구성한다.

동일 크기·mtime·identity·boundaryHash면 JSONL을 재파싱하지 않는다. 파일 크기 증가와 identity·경계 해시 일치 시 offset부터 읽는다. 교체·같은 크기 수정·truncate는 재스캔한다. 최대 행 크기는 개행 제외 16MiB이다. 미완성 UTF-8/JSON 마지막 줄은 개행이 들어올 때까지 offset을 전진시키지 않으며, 그 사실만으로 partial 오류를 만들지 않는다.

Codex는 유효 누적값의 항목별 양수 증가분을 더한다. Claude input에는 cache read/write를 포함하며 같은 메시지의 base input·output·cache read·cache write를 각각 최댓값으로 병합한다. 이 중복 제거는 파일 사이에도 적용한다. 오류는 partial로 표시하며 열거 실패로 확인하지 못한 파일의 이전 기여를 유지한다. 삭제를 확인하면 합계에서 제거한다.

## 저장과 갱신

프로세스 내부 쓰기를 직렬화하고 같은 디렉터리의 고유 임시 파일을 완성한 다음 rename으로 교체한다. 쓰기 실패는 현재 메모리 결과나 수집을 중단하지 않는다. 강제 종료로 남은 임시 파일을 캐시로 읽지 않는다. 기존 토큰 인덱스는 변환·삭제하지 않고 최초 한 번 재집계한다.

Rust 중앙 상태는 quota 3개·장애 3개·토큰 2개 작업을 독립 실행한다. 늦게 읽힌 quota 캐시는 이미 받은 정상 실측을 덮어쓰지 않는다. 작업별 한 번만 실행하고 실행 중 추가 요청은 후속 1회로 합친다. generation이 다른 결과는 반영하지 않는다.

quota는 정상 60초, 실패 60·120·240·480·900초이며 미래 retryAt이 우선한다. 장애는 operational 900초, 그 외 300초다. 토큰은 60초와 수동 갱신에 참여한다. 전체/개별 진행 표시는 실제 작업 집합으로 계산한다. 정상 종료는 신규 요청을 차단하고 실행 중 작업·마지막 저장을 정리한 뒤 잠금을 해제한다.

공통 허구 quota fixture는 `.work/parity-reference/snapshot.json`, JSONL 생성·양방향 검증은 `tests/unit/sharedCacheInterop.test.ts`, Rust fixture 실행기는 `src-native/bin/cache_fixture.rs`에 있다.
