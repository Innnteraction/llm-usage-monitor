# 아키텍처 개선 구현 체크리스트

- [x] 리뷰 결과 선행 커밋: d7fa9eb
- [ ] A1/A3: Node core·storage·CLI infrastructure 책임 이동, 기존 baseline 참조 정리
- [ ] A1/A2: 저장소 소유 경계 검사와 Node/Rust 공유 계약 CI 연결
- [ ] A4: Rust cache·job·reducer·monitor 분리 및 명시적 작업 식별
- [ ] A5: 실제 설치 진입점의 격리 전환·롤백, startup caller 검증
- [ ] A6: 양쪽 표시 의미의 공통 fixture 검사 연결
- [ ] 전체 테스트·빌드·아키텍처 확인, 단계별 커밋
- [ ] 사용자 확인 후 현재 브랜치 push
- [ ] macOS 실기 설치·로그인·UI 검수 (Mac 환경에서 진행)

## 범위와 위험 기록

- 기존 UI·quota·인증·공유 캐시 계약을 유지한다. 코드 경계 이동과 검증 연결을 우선하며 새 런타임이나 서비스는 추가하지 않는다.
- 기존 로컬 guard는 core와 신규 infrastructure를 보호하지 못하므로 해당 이동은 명시적으로 수동 검토한다. 정리 후 새 경계를 포함한 정책을 활성화하며 baseline을 확대하지 않는다.
- 기존 분석에서 Rust 의미 해석 capability가 없었다. 문법 기반 검증과 컴파일·계약 테스트의 범위를 구분하고 의미 기반 순환 전체 검증으로 과장하지 않는다.
- push는 최종 검증 결과를 사용자에게 제시하고 확인받은 뒤 진행한다.
