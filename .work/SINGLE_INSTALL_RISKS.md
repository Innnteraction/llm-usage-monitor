# 단일 설치 위험 및 검증 기록

- 자동 시스템 도구 설치·로그인 항목 변경은 이 개발 PC에서 직접 실행하지 않는다. 가짜 명령과 임시 설치 경로로 검증한다.
- macOS 빌드·LaunchAgent·실기 로그인은 Windows 환경에서 완료로 표시하지 않는다.
- 설치 스크립트는 architecture-guard 지원 언어 밖이므로 직접 경계·인수·삭제 대상을 검사한다. 앱 변경은 main/native-shell 경계로 제한한다.
- Node/Rust UI 전체 동등성은 아직 미검증이다. 설치 선택 화면에서 숨기지 않는다.

## 2026-09-20 검증

- Windows PowerShell 5.1과 현재 PowerShell에서 `scripts/test-install.ps1` 통과: 선택 동의 누락, Node 버전 충돌, 도구 설치 동의 누락, 가짜 다운로드 실패, 재부팅/오류 exit, Node→Rust→Node와 동일 버전 업데이트, 실패 롤백, 잠긴 exe, 한글·공백 경로, 자동 시작 on/off·소유권. 실제 레지스트리·앱 설치·도구 설치는 변경하지 않았다.
- 아키텍처 verify 통과. 기존 baseline과 정책은 변경하지 않았다. TypeScript typecheck 및 lint 통과, Node 264개 테스트 통과. Rust 전체 타깃 검사 33개 통과. 첫 검사에서 임시 경로 기반 실행 잠금 포트가 Windows 10013으로 거부됐고 재실행에서는 통과했다. OS 예약 포트와의 충돌 가능성은 기존 잠금 구현의 남은 위험이다.
- Windows release `target/release/llm-usage-monitor.exe` 및 `out/install-verified/LLM Usage Monitor-win32-x64/` 패키지 빌드 성공. 임시 preview가 아니라 현재 소스의 정본 빌드다.
- Bash 구문 검사 통과. AppleScript 컴파일·macOS 환경 검사 CI를 추가했으나 이 세션에서 원격 실행 결과는 확인하지 않았다.

## 메모리 비교

`node scripts/benchmark-variants.mjs`로 같은 허구 snapshot을 순차 실행했다. Node는 renderer heading 표시와 snapshot 주입, Rust는 first-render 진단과 정상 종료를 확인했다. 화면은 펼침, 준비 5초, 샘플 5회다. OS는 Windows x64이며 macOS 결과로 일반화하지 않는다.

| 버전 | Working Set 합계 범위 (MiB) | 중앙값 (MiB) |
| --- | --- | --- |
| Node / Electron | 313.82–318.30 | 316.25 |
| Rust / GPUI | 55.04–55.04 | 55.04 |

프로세스 트리의 Working Set 합계이므로 Electron 하위 프로세스도 포함하고 공유 페이지 중복이 있을 수 있다. private bytes와 다른 지표이며 실계정 수집 부하는 포함하지 않는다. 원시 결과는 Git 제외 `.work/parity-captures/install-memory/result.json`에 둔다. 장시간·다른 PC 성능 보장이 아니다.

- 재패키징 중 기존 `out/install-build`의 `app.asar`가 EBUSY로 잠겼다. 앱 프로세스는 확인되지 않았으며 원인은 확정하지 못했다. 강제 종료·삭제 없이 별도 `out/install-verified`에서 최종 빌드를 성공시켰다. 설치기에서 같은 오류가 발생하면 기존 설치는 유지되며 파일 잠금 해제 후 재실행해야 한다.

## 남은 운영 검수와 경계

- rustup 설치 파일을 UUID 이름의 exe로 저장해 설치 모드 대신 proxy 판별 오류가 발생했다. 고유 임시 디렉터리 안의 `rustup-init.exe`로 수정하고, 잠긴 파일의 정리 실패는 경고로 남겨 원래 설치 오류를 보존한다. 실제 다운로드 분기에 허구 파일·체크섬·파일 잠금을 넣은 Windows PowerShell 5.1 회귀 테스트를 통과했다. 공식 exe 다운로드 및 `--help` 검증 명령은 자동 승인 검토에서 `blocked by policy`로 거절되어 실행하지 못했다. 실제 도구 설치 성공은 아직 확인하지 않았다.

- 설치기 자체 안내·오류와 앱의 남은 한국어 표시를 영어로 변경하고, Windows/macOS의 대화형 선택 및 버전 옵션에 `n`/`r` 별칭을 추가했다. OS·외부 설치 도구·벤더가 제공하는 원문과 사용자 데이터의 언어는 변경하지 않는다. Windows PowerShell 5.1 별칭·설치 테스트, Bash 별칭·구문, Node 264개/Rust 33개 테스트와 Windows 양쪽 빌드를 확인했다. Node 검증 산출물은 `out/install-english`에 있다. macOS 실화면은 미검증이다.

- Windows PowerShell 5.1에서 없는 Run 값을 `Get-ItemPropertyValue -ErrorAction SilentlyContinue`로 조회하면 예외가 발생하는 문제가 사용자 실행에서 확인됐다. 설치기와 공통 자동 시작 helper를 키 조회 후 속성 존재 확인으로 수정했다. 기존 가짜 레지스트리가 이 예외를 재현하지 못했으므로 키 없음·값 없음·접근 거부를 구분하도록 회귀 검증을 보강했다. 실제 설치 진입점이 해당 조회를 지나 동의 단계에 도달함을 시스템 변경 없이 확인했다.

- 실제 로그인/재부팅 자동 시작과 깨끗한 PC의 도구 설치는 사용자 검수 항목이다. 관리자 권한·다운로드 정책·프록시·OS의 별도 자동 시작 차단이 영향을 줄 수 있다.
- macOS는 기존 System Events 로그인 항목을 알려진 앱 이름·경로 접미사로 한정해 공통 LaunchAgent로 이관한다. Automation 권한이 거절되면 중단한다. 해당 경로의 실기 실행은 미검증이다.
- macOS ad-hoc 서명은 공증이 아니다. Gatekeeper와 Xcode 라이선스를 자동 우회하지 않는다. Mac App Store 상호작용·Metal 도구 준비는 직접 완료한 뒤 재개해야 한다.
- 도구 설치 동의 후에는 공식 설치기가 일부 도구를 설치한 다음 실패할 수 있다. 기존 앱은 유지하되 공용 개발 도구를 자동 제거·되돌리지 않는다.
- 전원 차단·프로세스 강제 종료 중의 디렉터리 교체는 정상 오류 롤백과 다르다. 관리 설치 경로의 `.backup-*` 또는 `.llm-install.*` 잔여물을 확인해야 하며 자동 삭제하지 않는다.
- 기존 custom install-dir와 desktop-shortcut 옵션은 단일 설치 정책으로 대체했다. deploy:quick도 빌드를 확인한다. 과거 임의 복사본은 사용자가 정리한다.
