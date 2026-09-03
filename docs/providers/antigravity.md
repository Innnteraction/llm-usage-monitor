# Antigravity CLI quota 계약

## 요약

이 문서는 Antigravity provider를 유지보수할 때 사용하는 수집·보안·검증 참조다. 기존 Codex·Claude와 별개인 Google `agy` CLI의 계정 quota만 다룬다. Antigravity 로컬 토큰, 계정 전환과 직접 OAuth/API 호출은 범위 밖이다. 진행 상태는 [Phase 5.5 계획](../plan/phase5-5-antigravity.md)에 기록한다.

## 공식 경로와 확인 범위

고정된 독립 명령은 다음과 같다. 일반 모델 prompt로 바꾸거나 `--disable-slash-commands`를 붙이지 않는다.

```text
agy --print /usage --output-format json --print-timeout 20s
```

[공식 변경 기록](https://antigravity.google/changelog)의 1.1.11(2026-08-07)은 read-only slash command의 JSON 결과와 에이전트 턴·quota 소비·대화 생성 없는 동작을 명시한다. [Models 문서](https://antigravity.google/docs/models/)는 Gemini 및 Claude/GPT 모델군의 주간·5시간 잔여량을 설명한다. 이 모델군 이름은 Antigravity 내부 구분이며 이전 Gemini CLI 호환 기능이 아니다.

2026-09-03 Windows에서 `agy` 1.1.25의 JSON 구조와 아래 필드 계약을 검사했다. 종료 성공, `num_turns: 0`, 유효한 잔여 비율과 reset 시각을 확인했다. 실제 수치·날짜·계정·원문은 저장하지 않았고 필드 타입, 허용 enum 분류와 Boolean 결과만 출력했다. 조사 도중 설치 버전 1.1.23→1.1.24→1.1.25가 관측됐으나 앱이 업데이트를 실행한 것은 아니며 변경 원인은 확인되지 않았다.

## 정규화 계약

성공 응답은 `status`, `num_turns`, `command.name`을 확인한 뒤 `command.data.groups[].buckets[]`만 사용한다. 최상위 `usage`는 이 PC의 로컬 로그 합계가 아니므로 UI 토큰으로 사용하지 않는다.

| 확인된 필드 | 처리 기준 |
| --- | --- |
| `status` | 성공 상태만 quota로 처리한다. |
| `num_turns` | 0인지 확인한다. |
| `command.name` | 독립 usage 명령 결과인지 확인한다. |
| `groups[].name` | Gemini Models, Claude and GPT models를 고정된 모델군 이름으로 정규화한다. |
| `buckets[].window` | `weekly`와 `5h`의 확인된 의미만 사용한다. |
| `remaining_fraction` | 유한한 0~1 값만 허용하고 사용률을 `100 × (1 − remaining_fraction)`으로 변환한다. |
| `reset_time` | 제공된 ISO 날짜만 사용한다. 남은 시간에서 창 길이를 추정하지 않는다. |
| 원본 ID·설명·기타 필드 | 버린다. 공개 ID는 고정된 모델군+창 조합으로 생성한다. |

모델군별 주간 창은 `model_weekly`, 5시간 창은 `five_hour`로 분류한다. 필드가 미제공이면 사용률 0이나 reset 완료를 생성하지 않는다. 알 수 없는 모델군·창, 중복 ID, 잘못된 숫자·날짜는 명시적 출력 오류다. 임의 필드를 UI나 cache로 그대로 전달하지 않는다.

## 인증·프로세스 경계

- 실행기는 1.1.11 이상인 1.1.x를 대상으로 하고, 다른 major/minor나 해석할 수 없는 버전에서는 usage 명령을 실행하지 않는다. patch별 문자열 고정 대신 매 응답의 JSON 계약도 검증한다.
- 앱은 credential, keyring, vendor 설정 파일을 직접 읽거나 쓰지 않는다. 로그인과 refresh는 CLI가 소유한다.
- 신규 빈 임시 디렉터리에서 고정 인자로 실행한다. 전역 plugins·hooks·MCP까지 완전 격리됐다는 뜻은 아니다. 공식 CLI-direct 경로를 유지하고 이를 일반 agent 실행에 재사용하지 않는다.
- stdout·stderr는 메모리에서 크기를 제한하고 원문 파일이나 로그를 만들지 않는다. 고정 오류 코드와 복구 안내만 외부로 내보낸다.
- timeout·취소 시 앱이 시작한 프로세스 트리만 정리한다. 임시 디렉터리는 비어 있을 때만 제거하며 알 수 없는 CLI 생성물을 재귀 삭제하지 않는다.
- 미인증 상태를 시험하려고 실제 계정에서 logout하거나 설정을 바꾸지 않는다. 실패 경로는 허구 process로 검사한다.
- 현재 CLI 조회에서 확인되지 않은 이메일·구독 종류는 다른 파일에서 보충하거나 추정하지 않는다.

## 검증 분리

기본 자동 검사는 fake process·허구 JSON만 사용한다. 별도 실계정 smoke는 사용자가 명시적으로 실행할 때만 수행하며 성공 여부·정규화 계약만 출력한다. 실제 응답을 Vitest assertion의 expected/actual 값으로 넣지 않는다.

```powershell
corepack pnpm exec vitest run --config vitest.antigravity-smoke.config.mts
```

현재 계약 확인은 특정 로그인 환경의 관측이다. 모든 전역 startup 부작용이 없음을 입증하거나 향후 CLI 출력의 호환성을 보장하지 않는다. 구조 변경은 parser mismatch로 처리하고 마지막 정상 quota를 stale로 유지한다.

2026-09-03 수집기와 화면 연결의 Guard·typecheck·lint·전체 단위/통합 159개가 통과했다. 위 smoke 명령도 production provider로 성공했다. 실패 경로는 fake process와 허구 JSON으로 검증했으며 실제 계정의 인증 상태를 변경하지 않았다. Antigravity 전용 개발 Electron 5개에서 모델별 표시·오류 격리·테마·배율·스크롤·compact를 확인했다. packaged 앱과 설치 파일은 별도 배포 관문에 남긴다.
