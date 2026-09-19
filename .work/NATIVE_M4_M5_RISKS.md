# M4·M5 재검증 및 리스크 기록

2026-09-19, 기준 커밋 `cea4e5d`, 브랜치 `feat/native-gpui`.

기존 계획의 M1~M3 완료 표시는 이전 작업자의 보고다. 아래 재검토에서 실행·기능 차이가 확인되어, M4 구현과 M5 전환 판정 전에 보완해야 한다. 현재 M4·M5는 완료되지 않았다. Electron 대체와 main 병합은 수행하지 않았다.

## 확인된 구현 차이

| 우선순위 | 근거 | 리스크 및 필요한 조치 |
| --- | --- | --- |
| 차단 | `src-native/bin/main.rs` | GPUI executor에서 Tokio process·timer를 사용하지만 Tokio runtime 생성이 없다. GUI 실행 시 수집 경로 패닉 가능성이 있어 실제 실행 검증이 필요하다. |
| 차단 | 같은 파일의 이벤트 루프 | 수집 완료를 await한 뒤에야 트레이 이벤트를 처리한다. 느린 CLI 응답 중 열기·새로고침·종료가 지연된다. 별도 runtime에서 수집하고 UI 이벤트는 계속 처리해야 한다. |
| 높음 | `src-native/providers/codex.rs`, `src/providers/codex/protocol.ts` | Rust는 `rateLimits/read`, 기존 구현은 `account/rateLimits/read`다. Rust RPC 계약과 fake-process 회귀 검증이 필요하다. |
| 높음 | `src-native/core/engine.rs` | 실패한 새 snapshot을 그대로 반환하여 마지막 정상 quota가 사라진다. provider별 stale 보존과 오류 표시가 필요하다. |
| 높음 | `src-native/core/local_usage/checkpoint.rs` | 두 스캐너가 상태 전체를 각각 복제한 후 저장한다. 병렬 수집 시 다른 provider의 캐시 갱신이 덮어써질 수 있다. |
| 높음 | `src-native/core/local_usage/{codex,claude}.rs` | 변경 파일은 offset을 활용하지 않고 처음부터 다시 읽는다. 문서의 증분 캐시는 변경 없는 파일 건너뛰기이며, byte offset 증분 파싱과 다르다. 읽기·파싱 오류 일부도 partial에 반영되지 않는다. |
| 높음 | `src-native/core/vendor_health.rs` | Google 상태 요청 실패 시 기본 Operational이 유지된다. 네트워크 실패·JSON 불일치에는 Unknown이 필요하다. |
| 높음 | `src-native/ui/vendor_banner.rs` | 상태가 없는 provider도 장애 목록에 포함되지 않아 전체 정상 문구가 나올 수 있다. 미확인 상태를 별도로 표시해야 한다. |
| 높음 | `src-native/bin/main.rs` | blur 시 window handle을 지우지 않는다. 이후 트레이 클릭에서 이미 제거된 창을 처리해 재열기에 한 번 더 클릭이 필요할 수 있다. |
| 중간 | 같은 파일 | 실제 tray 좌표와 OS 작업영역 대신 첫 디스플레이 전체 경계·고정 앵커를 사용한다. 위치 초기화는 로그만 출력한다. 다중 모니터·배율·작업표시줄 패리티 미확인이다. |
| 중간 | `src-native/ui/` | 컴팩트 테이블, 테마 전환, 도움말, 헤더 수동 새로고침이 없다. 로컬 partial·provider 오류 설명도 충분히 표시되지 않는다. |

## 검증 환경과 미확인 사항

- Rust 실행 파일은 `C:/Users/ki1223/.cargo/bin`에 있으나 현재 쉘 PATH에 없다. 검증 시 해당 프로세스의 PATH에만 추가하면 된다.
- 설치된 native target은 `x86_64-pc-windows-msvc`다. macOS target·SDK·실기 검증 결과가 없으므로 macOS 무결성을 확정할 수 없다.
- `cargo metadata --offline --locked --format-version 1`은 미캐시 `aes 0.8.4` 때문에 실패했다. 전체 타깃 의존성 감사는 미완료다.
- Cargo.lock과 로컬 registry manifest 대조에서 `option-ext 0.2.0`의 `MPL-2.0` 선언을 확인했다. 캐시 없는 manifest 281개는 확인하지 못했다. 기존 문서의 “100% MIT/Apache·Permissive 확인 완료”는 근거가 부족하다. 타깃별 실제 의존성과 배포 라이선스 목록을 별도 확인해야 한다.
- 활성/상주 Working Set, private bytes, CPU, 10,000개 허구 세션 처리 성능은 이번 작업에서 아직 측정하지 않았다. 기존 문서의 400MB 비교 기준과 목표 수치를 새 실측 결과처럼 사용하지 않는다.
- 실제 계정과 인증정보를 fixture·로그·벤치마크 보고서에 남기지 않는다. UI 검증은 허구 snapshot, 스캐너 검증은 생성한 JSONL을 사용한다.

## 아키텍처 검사 선행 조건

기존 활성 정책은 Electron TypeScript만 포함한다. `plan --path src-native/bin/main.rs`는 `계획 경로가 policy include 범위 밖입니다`로 실패했다. 기존 정책을 덮어쓰는 `init`도 거부되었다.

`.architecture-guard/policy-native.draft.json`에 기존 Electron 정책을 유지하고 Rust 타입·provider·로컬 스캐너·코어·UI·shell·app 경계를 추가한 초안을 작성했다. UI는 정규화 타입만 참조한다. provider 파일은 현재 하나의 경계에 속하므로 provider 간 격리는 별도 코드 검토가 필요하다.

사용자가 초안 적용을 승인했다. 활성화 시 baseline 11건 외에 다음 기존 위반 4건이 발견되어, 활성화는 아직 완료되지 않았다. 정책 자동 완화 대신 이 4건의 baseline 수용 승인을 요청했다.

- `tests/unit/vendorHealthPoller.test.ts` → `src/usage/vendorHealthPoller.ts`: private-api-bypass
- `tests/unit/i18n.test.ts` → `src/shared/i18n/index.ts`: private-api-bypass
- `tests/unit/vendorHealthFetcher.test.ts` → `src/usage/vendorHealthFetcher.ts`: private-api-bypass
- `src-native/lib.rs` → `src-native/providers/mod.rs`: forbidden-dependency (기존 모듈 선언)

승인 대기 중 Windows 타깃의 누락된 Cargo 캐시를 내려받아 `cargo metadata --locked --filter-platform x86_64-pc-windows-msvc`를 완료했다. resolve node는 자체 패키지를 포함해 511개이며 `option-ext 0.2.0`의 MPL-2.0 선언이 포함된다. 자체 Cargo package에는 license 필드가 빠져 있다. 이는 메타데이터 확인 결과이며 release 바이너리의 최종 링크·배포 감사 완료를 뜻하지 않는다.

## M5 전환 판정 조건

1. M4 UI와 위 실행 차이를 구현하고 아키텍처 검사·회귀 테스트 통과.
2. release Windows 실행 및 활성/상주 메모리·CPU 실측. 목표 미달이면 실제 수치와 원인을 기록.
3. macOS 빌드·실기 검증을 구분해 기록. Windows에서 실행하지 않은 검증을 통과로 표시하지 않음.
4. 기존 Electron과의 UI·기능 차이, 라이선스 감사 결과를 검토 가능한 상태로 남김.
5. 원래 계획의 최종 사용자 검수 후 대체 조건을 충족할 때만 main 병합·배포 전환.


## 구현 검증 1차

사용자 승인 후 기존 15건(이전 11건 + 추가 4건)을 baseline으로 고정하고 정책을 활성화했다. Rust 변경 계획과 구현 후 verify가 통과했다.

- 별도 Tokio runtime에서 수집하고 GPUI loop는 트레이 이벤트를 계속 처리한다. 수동·자동 갱신 중복 실행을 막는다.
- blur 후 창 핸들을 정리하고 열기·토글·위치 초기화를 구분했다. macOS template icon, 좌클릭 메뉴 비활성화를 적용했다.
- 카드/간략 보기, 시스템/라이트/다크 팔레트, hover 도움말, 수동 갱신 상태, 보기 설정 저장을 구현했다. 실제 클릭·표시 검증은 M5에서 별도로 기록한다.
- provider별 마지막 정상 quota를 메모리에서 보존한다. 실패 시 오류와 stale 상태를 표시한다. 재실행을 넘는 quota 영구 보존은 아직 없다.
- Codex RPC 메서드를 수정하고 범위 밖 quota를 거부한다. CLI timeout 취소 시 자식 프로세스 정리와 Claude auth status 시간 제한을 추가했다.
- 로컬 캐시는 provider별로 lock 안에서 병합한다. 변경 파일은 안전한 offset에서 읽고, 미완성 UTF-8/JSON 행은 다음 수집에서 재시도한다. 최대 행 버퍼는 1 MiB이며 초과 행은 partial로 표시한다. 삭제·축소·경계 변경을 처리한다.
- Claude 중복 메시지는 최신 usage로 대체한다. 파일 간 같은 메시지 중복, rename 시 세션 이동과 특수 파일 교체까지 완전한 패리티를 보장하지는 않는다.
- Google 상태 요청 실패는 Unknown, 전체 상태 미확인은 정상과 구분한다. 로컬 partial과 stale 마지막 성공 시간을 UI에 노출한다.

검증: `cargo test --locked --all-targets` 16개 통과, 아키텍처 verify 통과. 테스트는 허구 데이터와 존재하지 않는 CLI만 사용했다. 기존 unused field warning과 dependency `proc-macro-error2` future-incompatibility warning이 남는다.
