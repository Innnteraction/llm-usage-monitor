# 아키텍처 개선 구현 체크리스트

- [x] 리뷰 결과 선행 커밋: d7fa9eb
- [x] A1/A3: Node core·storage·CLI infrastructure 책임 이동, 기존 baseline 참조 정리 (`582355e`)
- [x] A1/A2: 저장소 소유 경계 검사와 Node/Rust 공유 계약 CI 연결
- [x] A4: Rust cache·job·reducer·monitor 분리 및 명시적 작업 식별
- [x] A5: 실제 설치 조정 함수의 격리 전환·롤백, 양쪽 startup caller 검증
- [x] A6: 양쪽 표시 의미의 공통 fixture 검사 연결
- [x] 전체 테스트·빌드·아키텍처 확인, 단계별 커밋
- [ ] 사용자 확인 후 현재 브랜치 push
- [ ] macOS 실기 설치·로그인·UI 검수 (Mac 환경에서 진행)

## 범위와 위험 기록

- 기존 UI·quota·인증·공유 캐시 계약을 유지한다. 코드 경계 이동과 검증 연결을 우선하며 새 런타임이나 서비스는 추가하지 않는다.
- 저장소 `architecture/guard` 정책은 core·infrastructure·storage·분리한 Rust 엔진까지 포함하고 baseline 0건으로 활성화했다. 기존 로컬 정책의 예외 14건을 실제 의존 제거로 해소했다. Rust lib의 provider 선언은 앱 조립 경계로 분류했다.
- 기존 분석에서 Rust 의미 해석 capability가 없었다. 문법 기반 검증과 컴파일·계약 테스트의 범위를 구분하고 의미 기반 순환 전체 검증으로 과장하지 않는다.
- push는 최종 검증 결과를 사용자에게 제시하고 확인받은 뒤 진행한다.

## 검증 기록 (2026-09-20, Windows x64)

- Node typecheck·lint, 37개 파일 266개 테스트 통과.
- Rust all-targets 35개 및 이후 추가한 helper timeout 회귀 테스트 통과(최종 36개, 변경된 startup 테스트 2개 재실행). 기존 GPUI 전이 의존성 `proc-macro-error2`의 future-incompat 경고는 남아 있다.
- Node→Rust→Node 캐시·증분 인덱스·실행 잠금 교차 테스트 2개 통과.
- TS 경계 78개 모듈, 위반 0건. 역방향 참조·private 우회·새 미분류 폴더·순환을 주입한 검사기 회귀 테스트 통과.
- 통합 스킬 guard: 171개 모듈, 확정 의존 270개, 새 위반·stale baseline 없음. Rust 의미 해석의 한계는 별도 유지.
- Windows PowerShell 5.1 설치 helper 및 실제 조정 함수 테스트 통과: Node→Rust→Node, 동일 버전 갱신, 빌드/등록 실패 복구, 제거, 한글·공백 경로. 실제 사용자 등록은 변경하지 않음.
- `install.ps1 -Check` 실제 진입점 읽기 전용 실행 통과.
- 공통 표시 fixture 첫 실행에서는 Electron이 component에서 pending을 선택한다는 계층 차이를 확인했다. 제품 코드를 바꾸지 않고 실제 표시 규칙에 맞춰 검증했다.
- 원격 CI·macOS 실기 실행은 아직 하지 않았다. push 이후 확인한다.
- Windows Rust release 전체 bin 빌드와 Electron 패키징(`out/architecture-review`) 성공. 실제 설치본은 교체하지 않았다.
- 리뷰 `d7fa9eb`, Node 경계/CI `582355e`, Rust 분리/정책 `17c2cb8` 순서로 커밋했다. 설치·표시 계약 검증과 인계 기록은 다음 커밋에 묶는다.

- Rust startup helper에도 Node와 같은 15초 제한을 적용했다. 실패·잘못된 응답·무한 대기 허구 프로세스 테스트 통과, release 앱을 다시 빌드했다. timeout은 실패로 알리며 등록 변경의 자동 원복을 뜻하지 않는다.
