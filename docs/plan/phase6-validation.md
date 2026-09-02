# Phase 6 검증 기록

## 요약

이 문서는 Phase 6 인수 검토자가 자동 검사 결과와 실제 Windows에서 남은 확인 항목을 구분하는 데 사용하는 검증 참조다. 허구 계정으로 실행한 Electron 검사는 실제 계정 수집이나 Windows Narrator의 낭독 품질 검증을 대신하지 않는다. 최종 결과는 아래 항목별로 기록한다.

## 자동 검사

- 검증일: 2026-09-02
- 대상: Windows x64 packaged Electron 앱, 허구 계정과 격리된 테스트 userData
- Step 6.1: Guard·typecheck·lint·Electron E2E 8개 통과. 추가 quota의 Enter/Space 토글, refresh 중 펼침 유지, 새 실행 기본 접힘, 전체 계정 도움말과 목록 스크롤을 확인했다.
- Step 6.2: Guard·typecheck·lint·단위/통합 107개·Electron E2E 10개 통과. 미제공 quota·cache, stale 오류, reset 경과 설명과 provider 요청 없는 30초 카운트다운을 확인했다.
- Step 6.3: Guard·typecheck·lint·단위/통합 107개·Electron E2E 13개 통과. 다크/라이트와 100%/150% 배율의 긴 내용·오류 화면, 텍스트 대비·focus·툴팁 폭을 검사했다. 실제 Electron 키 입력의 Escape hide/reopen 후 툴팁이 남지 않음을 확인했으며, renderer blur를 강제로 발생시키는 보조 코드는 사용하지 않았다.
- Step 6.4: Guard·typecheck·lint·단위/통합 120개·packaged Electron E2E 13개 통과. 메뉴를 열 때 자동 시작의 실제 설정을 읽고, 설정·readback 예외를 처리하는 경로를 fake로 검증했다. 실제 앱이 사용하는 Quit 핸들러의 반복 요청·지연된 정리, 진행 중 polling의 종료 대기·실패 후 재예약, cache flush도 검증했다.
- 최종 검사: Guard, typecheck, lint, 단위/통합 23개 파일·120개 테스트, packaged Electron 13개 테스트, `git diff --check`, staged diff 전체 검토와 gitleaks 통과. 공개 IPC·snapshot 계약, provider 인증·파서, 로컬 집계 알고리즘과 의존성 변경은 없다.
- CSS는 Guard 범위 밖이므로 diff와 스크린샷을 별도로 검토했다. 배율은 packaged Electron의 `--force-device-scale-factor=1`·`1.5`, 테마는 `emulateMedia`로 검사했다. 이는 실제 Windows 배율 설정 변경·서로 다른 배율 모니터 이동을 대체하지 않는다.
- 위치 계산 단위 테스트는 상·하·좌·우 작업표시줄, 유효하지 않은 bounds, 제거된 모니터, 음수 좌표를 다룬다. work area 자체가 420×320보다 작으면 창을 축소하지 않고 해당 영역의 시작점에 맞춘다. 이 특수 환경에서 창 전체가 들어간다고 보장하지 않는다.
- 패키지 빌드는 성공했으며 기존 Forge/Vite의 `inlineDynamicImports` 폐기 예정 경고는 남아 있다. 의존성 갱신은 이번 Phase에 포함하지 않았다.

## 재현과 화면 산출물

저장소 루트에서 `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm test`, `corepack pnpm test:e2e`를 실행한다. E2E는 x64 앱을 패키징한 뒤 허구 계정과 격리된 userData로 실행하며 실제 vendor 계정·인증을 사용하지 않는다.

마지막 명령은 Git에 포함하지 않는 `test-results/` 아래에 기본 다크·라이트 `tui-dark-normal.png`·`tui-light-normal.png`, 추가 quota·오류의 다크·라이트 × 1·1.5 배율 화면을 생성한다. 기본 화면, 긴 모델명, 큰 토큰 수치, 설명 툴팁과 목록 스크롤을 확인할 수 있다. 스크린샷은 회귀 검사 산출물이지 실제 계정의 사용량 증빙이 아니다.

## 수동 확인 대기

아래 항목은 자동 테스트의 이벤트 호출이나 스크린샷으로 완료 처리하지 않는다. 현재 도구에서는 네이티브 Windows UI 조작과 Narrator 청취를 수행할 수 없어 미검증으로 남긴다.

- [ ] Windows Narrator: 핵심 quota 이름·사용률·상태, 토큰 설명, 추가 quota 버튼의 접힘 상태를 읽으며 주기 갱신 시 전체 목록을 반복 낭독하지 않는다.
- [ ] 네이티브 트레이: 실제 아이콘 클릭·우클릭과 키보드 메뉴 탐색으로 열기·새로고침·종료를 실행할 수 있다.
- [ ] 자동 시작: 원래 설정을 기록한 뒤 메뉴에서 opt-in을 변경하고 다시 열어 체크 상태를 확인한다. 검증 후 반드시 원래 설정으로 복원한다.
- [ ] 실제 혼합 배율·멀티 모니터: 각 모니터에서 열기, 모니터 분리 후 재표시 시 work area 안에 창이 보인다.

사용자가 직접 확인한 결과와 환경을 이 문서에 추가하기 전에는 Phase 6 전체 인수를 완료로 표시하지 않는다. 설치·업그레이드·제거 최종 검증은 Phase 7의 별도 관문이다.

Phase 6 구현은 `feat/phase-6-tui-polish`에 Step별로 커밋했으며 사용자 확인 전에는 `main`에 병합하지 않는다. Antigravity는 [로드맵](v1-roadmap.md)의 Phase 7 뒤 보류 항목으로 유지한다.
