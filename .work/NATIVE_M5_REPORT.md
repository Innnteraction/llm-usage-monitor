# M5 Windows 검증 및 전환 판정

2026-09-19 · `feat/native-gpui` · M4 구현 커밋 `876c2ba` 이후 보완.

**판정: M4 구현과 Windows M5 자동 검증·측정을 수행했으나 Electron 대체 조건은 충족하지 못했다.** 메모리 목표 미달, macOS 빌드·실기 미검증, UI 직접 검증 미완료로 main 병합과 배포 전환은 보류한다. 기존 Electron 소스는 보존했다.

## 구현과 실행 중 수정

- 카드/간략 보기, 시스템/라이트/다크 테마, 도움말, 수동 갱신 표시와 설정 저장을 추가했다. 수집은 별도 Tokio runtime에서 실행하여 트레이 이벤트 처리를 막지 않는다.
- quota 실패 시 마지막 정상값과 stale 시간을 표시한다. 미제공 quota는 복원하거나 추정하지 않는다. 서버 상태 Unknown과 로컬 partial을 표시한다.
- JSONL을 최대 1 MiB 행 버퍼로 스트리밍하고 안전한 offset에서 재개한다. 캐시의 provider 동시 저장, 누적 토큰 delta, 미완성 UTF-8 행, 삭제·축소와 탐색 실패 시 캐시 유지 처리를 보완했다.
- Windows 트레이의 물리 좌표와 모니터 작업영역을 DPI에 맞춰 변환한다. 좌표 취득 실패 시 기존 디스플레이 앵커를 사용한다. macOS는 물리 좌표를 논리 좌표로 오인하지 않도록 실제 트레이 좌표 적용을 보류했다.
- 첫 실행 측정에서 **팝업을 닫자 프로세스까지 정상 종료되는 결함**을 발견했다. GPUI 0.2.2 Windows 구현은 마지막 창 제거 시 종료 메시지를 보낸다. 표시되지 않는 1×1 창을 유지하도록 수정하고 팝업 닫힘 뒤 생존 및 자동 종료를 재검증했다. 아래 메모리에는 유지 창 비용이 포함된다.

## 검증 결과

| 검사 | 결과 |
| --- | --- |
| 아키텍처 verify | 통과. 승인한 기존 15건 baseline 유지, 신규 위반 없음 |
| `cargo test --locked --all-targets` | 17개 통과 |
| `cargo build --locked --release --bins` | Windows 성공 |
| release 데모 프로세스 | 표시 / 처음부터 숨김 / 표시 후 닫힘 모두 측정 중 생존, 지정 시간 후 exit 0 |
| 허구 세션 벤치마크 | Codex 10,000 + Claude 10,000개, 합계와 추가 50토큰 검증 통과 |
| Windows 의존성 선언 | 자체 패키지 포함 508개 메타데이터 확인. [목록](NATIVE_WINDOWS_LICENSES.md) |
| macOS | 빌드·실기 미실행. Windows/macOS CI workflow 추가, 원격 실행 결과 없음 |
| 화면·클릭·키보드 접근성 | 미검증. Computer Use native pipe 연결 실패, 초기화 후 재시도도 실패 |

기존 미사용 필드 경고 4개와 `proc-macro-error2` future-incompatibility 경고가 남는다. provider 테스트는 허구 파싱 입력과 미설치 CLI를 사용했다. 실제 계정 quota 정확도, 인증 만료·429·네트워크 오류의 전체 CLI 통합 경로는 검증 완료로 간주하지 않는다.

## 메모리와 CPU

Windows `10.0.26200`, x86_64 MSVC, Rust `1.98.1`, 논리 프로세서 16개. release 실행 후 3초 대기, 1초 간격 10회 측정했다. 허구 snapshot 데모로 실제 CLI·네트워크·사용자 로그 수집은 포함하지 않는다. 이 측정 이후의 최종 변경은 트레이 좌표 변환 실패 시 fallback 보정이며 측정 실행 경로의 메모리 구조는 같다.

| 상태 | Working Set MiB | private bytes 최대 MiB | CPU (1코어 100%) | 목표 상한 MiB | 판정 |
| --- | ---: | ---: | ---: | ---: | --- |
| 팝업 표시 | 56.59–56.61 | 252.91 | 0.306% | 35 | 미달 |
| 처음부터 트레이만 | 47.30–47.33 | 143.68 | 0.000% | 20 | 미달 |
| 표시 후 팝업 닫힘 | 52.30–52.32 | 250.81 | 0.000% | 20 | 미달 |

원시 결과: [native-memory-results.json](native-memory-results.json). Working Set과 private bytes는 서로 다른 지표다. 기존 Electron의 400MB 수치를 동일 환경에서 재측정하지 않았으므로 절감률을 확정하지 않는다. 유휴 CPU 0은 짧은 표본에서 반올림된 값이며 지속적인 무부하를 보장하지 않는다. 렌더러/드라이버별 메모리 원인 분해는 수행하지 않았다.

## 스캐너 측정과 재현

각 파일에 허구 usage 한 행을 만들고 cold, warm, 한 파일 append를 차례로 수행한다. 파일 생성 시간은 제외한다. warm도 파일 발견 및 경계 확인 비용이 있으므로 상수 시간 캐시 조회가 아니다. 대용량 단일 파일은 별도 스트리밍 회귀 테스트로 검증하며 이 벤치마크는 다수 파일 비용을 측정한다.

최종 측정은 cold 10,755.1 ms, warm 553.3 ms, append 578.5 ms다. 원시 수치는 [native-scanner-results.jsonl](native-scanner-results.jsonl)의 `elapsedMs`를 기준으로 한다. cold/warm 총합 2,400,000토큰, append 총합 2,400,050토큰을 assertion으로 확인한다.

```powershell
cargo test --locked --all-targets
cargo build --locked --release --bins
./target/release/benchmark-native.exe
./scripts/benchmark-native.ps1
```

GUI 프로세스 실행이 가능한 Windows 세션이 필요하다. 메모리 스크립트는 자신이 시작한 프로세스만 정리한다. 데모는 실계정 수집을 실행하지 않으며 기존 인증 파일을 직접 읽거나 수정하지 않는다.

## 기존 대비 남은 UI·기능 리스크

- 고정 폭·높이(기본 400×640), 불투명 배경, 그림자 및 컴팩트 배치가 기존 Electron과 다르다. 자동 크기 조절, 다중 모니터·배율·작업표시줄 방향별 실화면 검증이 필요하다.
- pin은 blur 시 닫힘을 막는다. 항상 위 표시·다른 앱과의 포커스 동작은 직접 검증하지 않았다.
- 설정/계정 전환, 시작 프로그램 등록, 상태 페이지 링크, 로컬 토큰 숨김, 다국어 등 Electron 전체 UX 패리티를 완료하지 않았다.
- stale quota는 프로세스 메모리에만 남아 재실행을 넘겨 보존되지 않는다. Claude PTY 출력과 벤더 CLI 형식 변경, retry/backoff 정책의 통합 검증이 남는다.
- Claude 메시지 중복 제거는 파일별이다. 파일 간 중복, 특수 파일 교체와 같은 크기·경계가 같은 내부 덮어쓰기까지 완전한 패리티를 보장하지 않는다.
- macOS는 template icon 설정만 적용했다. 빌드·실제 메뉴바 위치·Retina 배율·blur·종료 동작은 미검증이다.
- Windows 의존성에서 `dirs` 직접 버전을 GPUI와 같은 4 계열로 통일하여 MPL 선언 경로를 제거했다. Cargo.lock에는 다른 타깃용 `option-ext`가 남는다. 모든 플랫폼의 라이선스 및 배포 고지 감사를 완료했다는 의미는 아니다.

다음 전환 조건은 메모리 목표의 달성 또는 실측에 근거한 목표 재합의, macOS CI/실기 검증, 실제 UI·provider 수용 검증이다. 그 전에는 네이티브 시험 빌드로 유지한다.
