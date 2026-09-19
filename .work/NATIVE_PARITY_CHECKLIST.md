# 네이티브 패리티 실행 체크리스트

구현 완료와 검증 통과를 구분한다. 모든 완료 조건의 증거가 있어야 해당 마일스톤을 마감한다.

| ID | 기대 결과 | 구현 | 검증 | 증거·남은 문제 |
| --- | --- | --- | --- | --- |
| P0-01 | 문서·체크리스트·검증 기록 분리와 캡처 Git 제외 | 완료 | 통과 | 검증 기록 참조 |
| P0-02 | 동일 fixture·시각, 캡처가 기준 fixture를 덮어쓰지 않음 | 진행 | 대기 | 검증 기록 참조 |
| P0-03 | Electron 상세/간략 × light/dark 실제 캡처 | 미완료 | 차단 | Electron Target crashed |
| P0-04 | native 화면·입력 제어 및 비교 공유 | 미완료 | 차단 | 사용자가 수동 실화면 검수 담당 (native pipe os error 2) |
| P0-05 | 초기화 실패 비정상 종료, 준비 상태·실행 시간 확인 | 완료 | 통과 | 검증 기록 참조 |
| P1-01 | Codex 5h 무지개·무한대·도움말 정본 복원 | 완료 | 수동 대기 | 검증 기록 참조 |
| P1-02 | 폰트 fallback·색·간격·자간·그림자·테두리 동일 | 진행 | 대기 | 검증 기록 참조 |
| P1-03 | 실측 높이, 긴 라벨·계정·추가 제한·오류 잘림 없음 | 진행 | 대기 | 검증 기록 참조 |
| P1-04 | 4개 화면 쌍 비교와 수정 전후 공유 | 미완료 | 차단 | 검증 기록 참조 |
| P2-01 | 도움말 hover/focus/click, 300ms 닫힘·경계·스크롤·창 이탈 | 진행 | 대기 | 검증 기록 참조 |
| P2-02 | Tab/Shift+Tab·Enter/Space·포커스·disabled·단축키·Escape | 진행 | 대기 | 검증 기록 참조 |
| P2-03 | 갱신 점·gradient·무지개·countdown·reduced motion | 진행 | 대기 | 검증 기록 참조 |
| P2-04 | loading·refresh·stale·미제공·pending·partial·장애 화면 | 진행 | 대기 | 검증 기록 참조 |
| P2-05 | 설정 진입과 성공·실패 결과 UI 동일 | 진행 | 대기 | 검증 기록 참조 |
| P3-01 | 숨김 30초 전후 재열기와 상태 수명, pin 저장 | 진행 | 자동 부분 / 수동 대기 | 검증 기록 참조 |
| P3-02 | 드래그·높이·Reset Position·음수 좌표·pin/blur/Escape | 진행 | 대기 | 검증 기록 참조 |
| P3-03 | 트레이 생존·중복 실행·종료·초기화 실패 | 진행 | 대기 | 검증 기록 참조 |
| P3-04 | 자동 시작 읽기·변경·재확인·실패 복구 | 진행 | 대기 | 검증 기록 참조 |
| P3-05 | CLI·외부 링크 명령 및 실패 경로 | 진행 | 부분 | 검증 기록 참조 |
| P4-01 | Windows 100/125/150/200%·혼합 DPI 실기 | 미완료 | 차단 | 검증 기록 참조 |
| P4-02 | macOS CI 빌드·테스트 | 미완료 | 대기 | 검증 기록 참조 |
| P4-03 | macOS Retina·메뉴바·Dock·pin·로그인 항목 실기 | 미완료 | 차단 | 검증 기록 참조 |
| P5-01 | 동일 조건 Electron 전체 프로세스/native 메모리·CPU | 미완료 | 대기 | 검증 기록 참조 |
| P5-02 | 표시35/숨김20 MiB, 30초 유휴 이후 측정·최적화 | 미완료 | 대기 | 검증 기록 참조 |
| P5-03 | provider 대표 실패·스캐너 회귀 검증 | 진행 | 부분 | 검증 기록 참조 |
| P5-04 | 사용자 최종 수용과 전환·복구 절차 | 미완료 | 대기 | 검증 기록 참조 |

## 수동 검수 실행

```powershell
node scripts/create-parity-scenarios.mjs
./target/release/llm-usage-monitor.exe --demo-snapshot=.work/parity-captures/fixtures/normal.json
```

다른 상태를 보려면 `normal.json`을 아래 이름으로 바꾼다. 기존 시험 앱은 트레이 Quit으로 종료한 뒤 다음 시나리오를 실행한다. 모든 입력은 허구이며 데모에서 로그인·외부 브라우저·자동 시작 설정을 실행하지 않는다.

| 입력 | 확인 항목 |
| --- | --- |
| normal | 상세/간략 × dark/light 4화면, Codex 5h ∞·무지개·--%, 추가 제한 |
| stale | 기존 quota 유지, stale 문구·색, 오류 펼침 |
| unavailable | 다른 quota는 미제공, Codex 5h는 확정 무한대 표시 유지 |
| setup | Claude prepare folder 및 로그인 진입 표시; 실제 실행은 데모에서 차단 |
| pending_partial | pending/reset pending, partial 2, cache read -- 설명 |
| incident_long | 장애 문구·링크, 긴 계정명 줄바꿈·잘림, 창 높이 |

- 헤더를 Tab/Shift+Tab으로 순회하고 Enter/Space로 갱신·간략·테마·pin을 조작한다. 도움말과 나머지 버튼의 전체 키보드 동작·포커스 표시는 아직 완료되지 않았다.
- 간략·다크로 바꿔 숨긴 뒤 10초 내 다시 열면 상태가 유지되어야 한다. 다시 숨기고 31초 후 열면 상세·시스템 테마로 돌아가고 pin·사용자 위치는 유지되어야 한다.
- Ctrl+Shift+C/L/P, pin 해제 후 Escape·blur, 트레이 열기·위치 초기화를 확인한다.
- 캡처 저장: `.work/parity-captures/manual/<검수일>/`. `electron-detail-dark.png`, `native-detail-dark.png`처럼 쌍을 맞춘다. OS·배율·fixture·시각을 함께 기록한다. 캡처는 Git에 추가하지 않는다.
- 현재 Electron 자동 캡처는 실패 상태다. 서로 다른 실제 계정·시각의 화면으로 동일성을 통과 처리하지 않는다. fixture 주입이 안 된 Electron 수동 캡처는 외형 참고용으로만 기록한다.

## 정본 소스 대응표
| 사용자 관찰 항목 | Electron 정본 | 검증 시나리오 / 담당 단계 |
| --- | --- | --- |
| 글꼴·색·간격·아이콘 | renderer/styles.css, icons.tsx | 상세/간략, light/dark, 동일 OS·배율 / P1 |
| 제목 갱신·버튼 | Header.tsx | 제목 클릭, 중복 갱신 방지, 400ms 점 변화 / P2 |
| 표시 quota 선택 | selectors.ts | Codex weekly, Claude 5h/weekly/Fable, AGY 정해진 ID / P1 |
| 추가 제한 | ProviderCard.tsx | 확장/축소, reserve 제외, 긴 라벨 / P2 |
| 로컬 토큰 | LocalUsageView.tsx | input/output/cache, partial, 날짜, no logs / P1·P2 |
| 오류·stale·미제공 | selectors.ts, QuotaMeter.tsx | 실패 코드, 이전 값, 30분 stale, reset pending / P2 |
| compact 셀과 오류 확장 | CompactQuotaTable.tsx | provider 아이콘, 셀, 클릭 오류 표시 / P1·P2 |
| 도움말 | HelpTrigger.tsx, presentation.ts | hover/focus/click, 창 이탈, 스크롤, 경계 보정 / P2 |
| 테마·단축키 | useUsageMonitor.ts | 시스템 초기값, 2단계 토글, Ctrl/Meta+Shift+C/L/P / P2 |
| 동적 높이 | useWindowAutoResize.ts, application.ts | 480px 폭, 내용 변경, 작업영역 clamp / P1·P3 |
| 드래그·pin·Escape·blur | application.ts | pin 시 항상 위, pin 상태 Escape는 도움말만 닫음 / P3 |
| 트레이·종료·시작 프로그램 | trayMenu.ts, main/platform | 메뉴 순서·체크 상태·실패 복구 / P3 |
| CLI 설정·계정 전환 | claudeSetup.ts, antigravitySetup.ts | 기존 사용자 클릭 경로, 인증 직접 접근 금지 / P3 |
| 외부 상태 링크 | App.tsx, ipc.ts | http/https 허용·오류 표시 / P3 |
| 설정 수명 | useUsageMonitor.ts, application.ts | compact/theme 세션 상태, pin 저장, 재생성 / P3 |
