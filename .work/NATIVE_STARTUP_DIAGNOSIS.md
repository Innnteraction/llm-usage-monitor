# Native 초기 로딩 진단 — 2026-09-20

## 확인한 결과

창 생성 전 지연과 첫 데이터 대기는 서로 다른 경로다. Windows release 데모에서는 첫 UI 렌더 호출까지 0.51~0.64초가 걸렸고, 대부분은 GPUI 플랫폼 초기화였다. 실제 수집에서는 Node와 달리 모든 작업이 끝나야 첫 snapshot을 공개하므로 느린 작업 하나가 전체 데이터 표시를 지연시킨다.

## 측정 조건과 수치

- 현재 Windows 환경, release 빌드, 공통 허구 snapshot, 연속 실행 3회. OS 재부팅 후 cold start 비교가 아니다.
- --startup-timing으로 main 진입부터 경과 시간을 메모리에 최대 64개 기록하고 정상 종료 시 stderr로 출력한다. 시작 중 파일/콘솔 쓰기가 측정을 지연시키지 않도록 했다.
- 실제 provider CLI·상태 API·계정 캐시는 데모에서 사용하지 않는다. Node 실행 시간은 동일 조건으로 실측하지 않았으므로 배수 비교는 하지 않는다.

| 단계 (main 기준 누적 ms) | 1회 | 2회 | 3회 |
| --- | ---: | ---: | ---: |
| Tokio runtime 준비 | 0.65 | 0.61 | 0.72 |
| GPUI platform 준비 | 497.12 | 478.38 | 585.05 |
| 상태 준비 | 497.65 | 478.86 | 586.07 |
| 엔진 준비 (데모의 빈 캐시) | 497.95 | 479.04 | 586.25 |
| 트레이와 유지 창 준비 | 536.34 | 505.47 | 627.08 |
| 팝오버 생성 요청 | 536.73 | 505.82 | 627.48 |
| 첫 Render 호출 | 545.88 | 513.57 | 637.13 |
| 팝오버 생성 완료 | 568.78 | 534.64 | 665.27 |

첫 Render는 UI 구성 함수 진입이며 모니터에 픽셀이 표시된 시점은 아니다. exe 로더·보안 검사 등 main 이전 시간도 제외한다. 초기 즉시 stderr 출력 실험은 출력 자체의 지연이 섞여 최종 수치에서 제외했다. 원시 기록은 Git 제외 경로 .work/parity-captures/startup-{4,5,6}.stderr에 있다.

## 코드로 확인한 원인과 차이

1. src-native/bin/main.rs: Application::new가 끝나기 전에는 트레이와 수집 엔진도 시작하지 않는다. 설치된 GPUI 0.2.2의 WindowsPlatform::new는 DirectX 장치, DirectWrite, 메시지 창, dispatcher, COM 객체 등을 동기 초기화한다. 위 측정으로 이 초기화 묶음이 데모 시작 지연의 주원인임을 확인했다. DirectX와 폰트 각각의 기여도는 아직 분리하지 않았다.
2. 엔진/트레이/유지 창/launch_at_login 조회 후 첫 수집을 시작한다. 엔진 생성은 로컬 토큰 checkpoint 전체 JSON을 동기 읽기·파싱하고 HTTP 클라이언트를 생성한다. Windows 자동 시작 조회는 reg.exe 종료를 UI 스레드에서 기다린다. 실제 캐시 크기와 reg.exe 지연은 이번 데모 수치에 포함되지 않는다.
3. src-native/core/engine.rs: provider 3개 join → 장애 상태 3개 join → 로컬 스캐너 2개 join의 세 단계를 직렬 수행한다. 완료 전에는 snapshot 자체가 없어서 전역 로딩만 표시한다. 대략 max(provider 시간) + max(상태 조회 시간) + max(스캔 시간) + 최대 약 100ms UI 수신 대기다.
4. src/core/UsageMonitorCore.ts의 Node start는 quota·로컬 집계·장애 조회를 Promise.all로 동시에 시작한다. src/usage/store.ts는 provider 완료, 토큰 집계 완료, 장애 조회 완료마다 상태를 발행한다. 따라서 빠른 데이터가 느린 작업에 가려지지 않는다.
5. 실제 CLI 대기 자체도 존재한다. 예를 들어 Native Claude PTY는 응답 안정화 1.5초, 시작 무응답 대기 5초, probe 제한 25초를 사용한다. 이 값은 조건부 대기/상한이며 매 실행의 실측 지연을 뜻하지 않는다. 타임아웃을 무작정 줄이면 정상 응답도 실패로 처리할 위험이 있다.

## 개선 가능성

- 우선 권장: Node처럼 quota·장애 조회·스캔을 동시에 시작하고 결과가 준비되는 대로 provider별 UI에 반영한다. 첫 데이터가 전체 완료를 기다리는 구조를 없앨 수 있다. 단순 병렬화만 해도 단계 간 합산 대기는 줄지만, 부분 발행까지 해야 느린 provider가 다른 provider 표시를 막지 않는다.
- 수집 준비와 첫 수집을 UI 초기화와 겹치게 하고 checkpoint/자동 시작 조회를 UI 스레드 밖으로 옮긴다. 사용자 클릭에 대한 응답성도 보호한다. 트레이 메뉴 초기 체크 상태와 엔진 준비 전 refresh 중복 처리는 보존해야 한다.
- GPUI 초기화의 약 0.5초를 완전히 제거할 수 있다고 단정할 수 없다. 시작 프로그램으로 미리 상주시켜 사용자가 여는 시점에서 숨길 수는 있다. GPUI 내부 초기화 지연 제거 또는 트레이를 GPUI보다 먼저 표시하는 변경은 OS 이벤트 루프·GPU 수명 관리까지 영향을 주므로 별도 측정과 설계가 필요하다.
- UI 동일성, 오류/마지막 정상값 유지, provider별 refreshing 상태를 지키면서 개선해야 한다. 이번 작업에서는 진단 옵션만 추가했으며 수집 순서·렌더 동작은 변경하지 않았다.

## 재현

수집 없는 창 초기화 진단:

```powershell
$p = Start-Process .\target\release\llm-usage-monitor.exe -ArgumentList '--demo-snapshot=.work/parity-reference/snapshot.json','--startup-timing','--quit-after=2' -WindowStyle Hidden -PassThru -RedirectStandardError .work/parity-captures/startup-demo.stderr
$p.WaitForExit()
Get-Content .work/parity-captures/startup-demo.stderr
```

실제 provider 접속 및 실제 계정의 느린 구간은 이번에 실행하지 않았다. 실제 수집 진단 시 --show --startup-timing을 사용하고 앱을 정상 종료하면 시작 단계 시간이 출력된다. 기존 엔진의 [timing] Providers/Vendor Health/Local Scanners 로그와 함께 보아야 한다. 강제 종료하면 메모리의 시작 기록은 출력되지 않는다.

검증: architecture verify, Rust 테스트 27개, 최종 release 빌드 통과. 진단 옵션 없는 데모 실행은 exit 0, stderr 0 bytes.
