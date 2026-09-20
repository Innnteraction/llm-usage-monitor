# 아키텍처 경계 검증

Node의 `main`은 Electron/OS 호스트, `core`는 수집 조정, `storage`는 공유 캐시,
`infrastructure`는 CLI 실행 파일 탐색을 맡는다. Provider는 `main`에 의존하지 않는다.
Renderer와 shared는 브라우저에서 사용할 수 있는 계약·표시 정보만 참조한다.

```sh
pnpm check:architecture
node --test scripts/test-architecture.mjs
pnpm test:shared-cache
```

`boundaries.json`과 TypeScript 컴파일러의 모듈 해석을 이용해 모든 `src` TS/TSX 파일의
경계 누락, 금지 의존, 공개 index 우회, 정적 import/export/require 순환을 검사한다.
동적으로 계산한 import 경로, 런타임 호출 그래프, Rust 의미 해석은 이 검사의 범위가 아니다.
허용된 외부 패키지라도 자격증 접근 여부 등 동작 수준의 리뷰는 별도로 필요하다.

`guard/policy.json`·`guard/baseline.json`은 `sg-guard-arch`의 추적 가능한 저장소 정책이다.
해당 스킬이 있는 환경에서는 다음과 같이 Node와 Rust의 해석 가능한 의존을 함께 확인한다.

```powershell
& <skill-root>/sg-guard-arch/scripts/architecture-guard.ps1 check --root $pwd --state-dir architecture/guard
```

기존 로컬 정책의 예외 15건을 승계하지 않았다. Node의 실제 역방향 의존·private 참조를
제거했고, Rust `lib.rs`의 provider 모듈 선언은 앱 조립 책임으로 명시했다. 새 baseline은
비어 있다. 선언 전용 `forge-env.d.ts`는 스킬 분석기의 그래프에서 제외하되 저장소 TS 검사에 포함한다.
개발자별 `.architecture-guard` 상태는 더 이상 저장소 정책의 기준이 아니다.

Rust 엔진은 `engine.rs`의 수집 어댑터, `engine/cache.rs`의 저장·잠금,
`jobs.rs`의 작업 식별·재시도, `reducer.rs`의 필드별 상태 병합,
`monitor.rs`의 스케줄링·종료로 나뉜다. 기존 공개 API 경로는 유지한다.
현재 스킬의 Rust 분석은 제한된 문법 해석이며 전체 의미 기반 순환 부재를 보증하지 않는다.
CI는 Rust 컴파일·테스트와 실제 Node↔Rust 캐시 교환을 추가 검증한다.

`tests/fixtures/presentation-contract.json`은 시간대, pending, 미제공, 반올림 표시 규칙을
양쪽에서 검증한다. CSS와 GPUI의 픽셀·애니메이션 동등성을 대신하지 않는다.
Windows 설치 테스트는 실제 설치 조정 함수를 호출하되 OS 등록·도구 빌드를 대체한다.
앱의 자동 시작 호출 테스트는 임시 설치 폴더의 허구 헬퍼를 실행한다.
로그아웃·재부팅 후 실제 자동 시작과 macOS 설치 전환·UI는 실기 검수 대상이다.
