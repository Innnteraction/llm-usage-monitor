# 공유 캐시·표시 지연 개선 구현 체크리스트

- [x] M1: 공통 경로·quota v2 저장 계약·공통 실행 잠금 구현.
- [x] M1: guard·Node 캐시 8개·Rust engine 2개·TS 타입 검사 통과. 공유 quota 실제 표시 연결은 M3에서 수행.
- [x] M2: v2 토큰 인덱스·해시 식별·4KiB 경계 검증·Claude 파일 간 중복 제거·Node→Rust→Node 이어읽기 검증.
- [x] M3: 캐시 우선 표시와 독립 결과 반영. 느린 fake Claude 완료 전 캐시·Codex·AGY 실패 반영, Rust 30개·Node store 12개·타입 검사 통과.
- [x] M4: 갱신 병합·주기·종료 처리. Node 장애 조회 중복 제거, 마지막 quota 저장, 작업별 진행 상태·재검증 표시, 토큰 파서/검증 차이 보완.
- [x] M5: quota·토큰 양방향 fixture, 파일 변경·손상·실행 잠금·쓰기 실패·강제 종료 검증.
- [x] M5: Node 264개, 교차 2개, Rust 31개, 타입·lint·guard 검증.
- [x] M5: Rust release와 Electron 별도 패키지 산출물, 계약·재현 명령·진단 기록.
- [ ] 수동: 새 Electron 패키지 UI 실행 확인(Playwright startup timeout 원인 미확정).
- [ ] 수동: 실제 계정 Node↔Rust 전환 및 디자인·드래그·트레이·상태 링크·cmd 창 확인.
- [ ] 수동: macOS 빌드·실행 확인.

## 위험과 한계

- 루프백 포트가 다른 프로그램에 점유되어도 안전하게 실행을 거부한다. 진단 메시지는 다른 버전 실행과 잠금 불가를 함께 안내한다.
- 구버전 앱은 공유 잠금을 모르므로 새 버전 간 단일 실행만 보장한다.
- 기존 JSONL 원본이나 구버전 인덱스는 수정·삭제하지 않는다. 새 공유 인덱스에는 원본 경로와 메시지 ID를 저장하지 않는다.
- src/core/UsageMonitorCore.ts는 현재 guard include 밖이므로 의존성을 수동 검토한다. 정책과 baseline은 변경하지 않는다.

- M2 검증: Node 토큰 관련 20개, 교차 실행 1개, Rust 로컬 사용량 4개. 기존 인덱스는 재사용하지 않고 공통 v2로 처음 한 번 재집계한다.

- M4 검사: Node 관련 34개·타입 검사 통과. 처음 발견한 기존 capture-native-reference.mjs 6건과 create-parity-scenarios.mjs 1건의 no-undef는 M5에서 전역 객체 참조를 명시하여 해결했다.

세부 검증·산출물·남은 위험은 [검증 기록](SHARED_CACHE_VERIFICATION.md), 저장 형식은 [공통 계약](SHARED_CACHE_CONTRACT.md)을 참조한다.
