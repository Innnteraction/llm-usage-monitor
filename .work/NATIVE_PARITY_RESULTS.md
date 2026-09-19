# 네이티브 패리티 검증 기록

이전 기록은 당시 결과다. 최신 판정은 체크리스트의 검증 상태를 따른다. 캡처 원본은 Git에 포함하지 않는다.

## 이전 실행 기록

- `node scripts/capture-native-reference.mjs`: 현재 Electron fake provider를 실행하고 snapshot.json, 4개 PNG, metrics.json을 `.work/parity-reference`에 저장한다. 네이티브는 `--demo-snapshot=<snapshot.json>`으로 같은 snapshot과 updatedAt 시각을 사용한다. fixture가 잘못되면 exit 2이며 실제 수집으로 전환하지 않는다.
- 최초 Electron 캡처: Target crashed. 재시도 로그에서 GPU 프로세스 종료와 startup-failed 확인.
- `pnpm package`: Vite main/preload/renderer 빌드는 성공. 기존 사용 중인 out/.../app.asar 잠금 때문에 패키징은 EBUSY 실패. 사용자의 실행 중인 앱을 종료하지 않았다.
- 승인된 기존 아키텍처 baseline은 유지한다. Rust UI→정규화 타입, app→UI/core/shell 경계 안에서 진행한다. 신규 native UI presentation/icon 모듈을 계획에 포함했고 영향 검사 통과. Electron 제품 소스는 수정하지 않는다.

P0 자동 검증: 아키텍처 verify와 Rust 17개 테스트 통과. `--snapshot-only`는 정본 createFakeUsageStore를 2026-09-19T12:00:00Z에 실행하여 공통 JSON을 생성한다. GUI 캡처는 재시도 후에도 페이지 종료/타임아웃이 발생하여 기준 PNG는 아직 확보하지 못했다. P0는 완료로 판정하지 않고 입력·기준 계약만 먼저 커밋한다.

## P1 구현 1차 결과

- Electron SVG path를 assets/native-icons에 그대로 추출해 바이너리에 내장했다. 팔레트, 480px 폭, CSS 기준 글자 크기·간격, 상세 quota 행과 5분할 게이지, provider 내부 토큰, compact 3슬롯 구조를 이식했다.
- 정본의 기본/추가 quota 선택, reserve 제외, 퍼센트·토큰·카운트다운 표기, 30분 stale 판정을 순수 표시 함수로 옮겼다. 공통 fixture를 사용하는 회귀 테스트를 추가했다.
- 콘텐츠 측정 기반 높이 요청과 제목 새로고침, 추가 quota/compact 오류 펼침, 두 단계 테마 토글, 단축키를 연결했다. P2/P3 동작 중 같은 화면 작업에 필요한 일부가 포함된다.
- 아키텍처 verify와 Rust 테스트 18개, Windows release 빌드 통과. 공통 fixture 데모는 exit 0, 없는 fixture는 exit 2. Computer Use native pipe는 계속 연결되지 않아 실제 화면 대조는 미완료다.
- 남은 P1/P2 차이: 폰트 fallback의 실화면 확인, compact Fable 팔레트/반전 글자, 카운트다운 gradient animation, 토큰 색·세부 도움말, 도움말 focus/click 및 경계 동작. 창 높이·위치 변화는 실기 확인 필요. P1 완료로 표시하지 않는다.

## P3 OS 연결 1차 결과

- pin 버튼과 단축키를 Windows SetWindowPos / macOS NSWindow level에 연결했다. Windows는 콘텐츠 높이 변경 시 작업영역 안으로 위치를 재계산한다. 헤더 드래그 위치는 세션에서 유지하고 Reset Position으로 지운다.
- 상태 링크는 http/https와 host를 확인한 뒤 OS 브라우저로 연다. Claude 로그인/신뢰 폴더 준비, Antigravity 로그인/계정 전환은 기존 벤더 터미널 명령에 위임한다.
- 트레이 시작 프로그램 체크를 OS 읽기/쓰기/재확인에 연결했다. 실패 시 기존 체크 상태를 복원하고 오류를 표시한다. `LLM Usage Monitor Native` 항목으로 Electron 설정과 분리한다. 데모는 해당 OS 변경과 외부 실행을 하지 않는다.
- 검증은 허구 URL과 CLI 명령 구성, 음수 좌표 작업영역·높이 변경 경계에 한정한다. 실제 로그인이나 사용자 자동 시작 설정을 테스트 중 변경하지 않는다.
- 남은 차이/리스크: Windows 다중 DPI에서 드래그·높이 변경 후 좌표 실측, macOS 높이 변경 후 위치 보정 및 Dock 숨김, macOS 로그인 항목/Terminal 권한, 설정 팝업의 정확한 문구·배치, Electron의 숨김 후 30초 renderer 수명 동작. macOS 분기는 이 환경에서 컴파일·실행하지 못했다. P3 완료로 판정하지 않는다.

## P1/P2 표시 보완 결과

- compact Fable의 50%/80% 경계별 색과 2색 gradient, 채움 위 반전 글자, 퍼센트 폭·글자 크기를 CSS 값으로 보완했다. Antigravity compact의 kind fallback과 간략 카운트다운 자릿수도 정본 규칙을 적용했다.
- 로컬 토큰의 input/output/cache 색과 정확한 토큰 수·관측일·partial 설명을 hover 도움말에 연결했다. 제목 갱신 점은 400ms마다 1~3개로 바뀐다.
- 아직 다른 부분: gradient 글자 애니메이션, compact 글자 그림자·자간·light border, 도움말 click/focus/이탈·경계 처리, Tab/Enter/Space 및 접근성, 설정 동작의 성공·실패 UI. 이 항목은 구현 완료로 간주하지 않는다.
- 자동 테스트와 release 실행은 화면 동일성 증거를 대신하지 않는다. 화면 제어 도구가 연결되지 않는 현재 환경에서는 P0/P1/P2 시각 수용과 P4 실기 검증을 마칠 수 없다.
- 최종 아키텍처 검사, Rust 테스트 21개와 Windows release 빌드 통과. 일반 샌드박스에서는 트레이 초기화가 실패했는데도 exit 0으로 조기 종료했다. 따라서 앞선 exit 0만의 데모 확인은 실행 성공 증거에서 제외한다. 데스크톱 접근이 가능한 실행으로 재검증하여 공통 fixture의 `--hide-after=2 --quit-after=5`가 5.776초 후 exit 0, stderr 없이 종료됨을 확인했다. 실제 화면·입력 대조는 여전히 미검증이다. 초기화 실패의 exit code 0은 향후 실행 검증에서 주의할 남은 리스크다.

## 직접 실행과 다음 검수

저장소 루트 PowerShell에서 공통 허구 데이터로 실행한다. 데모에서는 실제 인증·로그 수집 및 시작 프로그램 변경이 발생하지 않는다.

```powershell
./target/release/llm-usage-monitor.exe --demo-snapshot=.work/parity-reference/snapshot.json
```

- 상세/간략, 라이트/다크를 전환하고 quota·로컬 토큰 문구, 추가 제한 펼침, 상태·오류 영역을 확인한다. Ctrl+Shift+C/L/P와 트레이 재열기·위치 초기화도 확인한다.
- 실제 수집 시험은 데모 인자를 빼고 실행한다. 이 경우 벤더 CLI가 실행된다. 로그인과 시작 프로그램 설정은 사용자가 해당 버튼을 선택한 경우에만 실행된다.
- P4 결과에는 OS/배율/모니터 배치, 동일 snapshot·시각의 Electron/native PNG, 입력 순서와 전후 상태를 함께 보관한다. 기준 PNG가 없는 현재 결과는 비교 통과가 아니다.
- P5 전환 판정은 보류한다. 기존 Electron 실행·배포를 유지하며 네이티브는 별도 시험 바이너리다. 기존 M5의 메모리 목표 미달도 해소된 것으로 보지 않는다.

## 후속 구현 결과 — 문서 분리와 수동 검수 빌드

- 사용자 결정: 실화면 검수는 수동 진행. 캡처·영상·부속 자료는 Git 제외, 문서에는 ID·환경·판정만 남긴다.
- Codex 5h 무한대 표시 복원, Windows 모션 감소 설정 시 무지개 흐름 정지. macOS 모션 설정은 미구현이다.
- 헤더 4개 동작을 마우스·키보드 공통 action으로 연결했다. 짧은 숨김의 상태·스크롤 유지, 30초 후 compact/theme/확장 상태 초기화를 추가했다. renderer 상태 수명 회귀 테스트 통과. 실제 스크롤·포커스 수명은 수동 검수 필요.
- provider별 요소 ID를 분리하여 로컬 토큰 tooltip ID 충돌을 방지했다.
- 아키텍처 verify 통과, Rust 22개 테스트 통과, Windows release 빌드 통과. 기존 경고 4개와 proc-macro-error2 future-incompatibility 경고는 유지된다.
- 6개 허구 fixture 실행: normal 2874ms, stale 2700ms, unavailable 2661ms, setup 2644ms, pending_partial 2644ms, incident_long 2698ms. 모두 `--quit-after=2`, exit 0, stderr 0 bytes. 이는 화면 비교 통과를 의미하지 않는다.
- 제한된 실행 환경의 트레이 초기화 실패: 기존 exit 0 문제 수정 후 exit 1 확인.
- Electron 개발 캡처: GPU process exit -2147483645와 startup-failed. packaged 캡처: Process failed to launch. native Computer Use: native pipe os error 2. 비교 이미지 미확보이며 P0/P1 수용은 미완료다.
- 캡처 스크립트는 기준 JSON을 읽어 기존 snapshot 이벤트로 전달하고 고정 시각을 적용한다. 실행별 출력은 Git 제외 디렉터리에 저장한다. GUI 캡처 성공 경로는 아직 검증하지 못했다.
- 다음 작업: 사용자 수동 비교를 반영한 P1 치수 보정, P2 도움말·전체 키보드·포커스·애니메이션 완성, P3 OS 실기, P4 macOS, P5 성능·최종 수용. 전체 계획 완료가 아니다.
