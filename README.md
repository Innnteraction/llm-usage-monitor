# LLM Usage Monitor (v0.8.0)

Codex, Claude Code, Antigravity(`agy`)의 5시간·주간 사용량 쿼터(Quota)와 이 PC의 로컬 토큰 사용량을 한눈에 모니터링하는 데스크톱 트레이 앱입니다.

TUI(Terminal UI) 특유의 군더더기 없는 시각적 직관성과 초경량 설계를 바탕으로, 작업 흐름을 방해하지 않는 상시 모니터링 위젯 경험을 제공합니다.

---

## 주요 기능

- **3대 AI 개발 도구 쿼터 통합 모니터링**:
  - **Codex**: 7일 주간 한도 및 추가 모델 한도 지원
  - **Claude Code**: 5시간 세션 한도, 7일 주간 한도, Fable 모델 한도 지원
  - **Antigravity (`agy`)**: Gemini 모델군 5시간·주간 한도 및 Claude/GPT 추가 한도 지원
- **듀얼 UI 모드 (상세 뷰 / 초간소화 간이 뷰)**:
  - **상세 뷰**: 프로바이더별 계정, 진행 막대 게이지, 리셋 카운트다운, 로컬 토큰 2줄 보조 뷰 제공
  - **초간소화 모드(Compact Table)**: 트레이 크기에 맞춘 컴팩트 테이블로 전 프로바이더의 주간/5h 쿼터 현황을 한 줄씩 조밀하게 요약 (`Ctrl+Shift+C`)
- **핀(Always-On-Top) 고정 & 드래그 자유 배치**:
  - 상단 타이틀 바 드래그로 화면 어디든 자유롭게 배치 및 마지막 위치 자동 기억/복원
  - 핀 고정(`Ctrl+Shift+P`) 시 다른 창에 가려지지 않는 플로팅 모니터 위젯으로 동작하며, 재부팅·앱 재시작 후에도 핀 상태 영구 보존
- **로컬 토큰 정밀 집계**:
  - 계정 쿼터와 분리하여 이 PC에 남겨진 CLI 세션 로그(JSONL)를 비동기 청크 스트리밍과 체크포인트 방식으로 안전하게 집계 (총 토큰, 입·출력, 캐시 읽기/쓰기)
- **세련된 TUI 인터랙션**:
  - OS 다크/라이트 자동 동기화 및 수동 테마 전환 (`Ctrl+Shift+L`)
  - 새로고침 시 CLI 스타일의 컬러 웨이브 쉬머 애니메이션
  - 0%~9% 구간을 `00%`~`09%`로 2자리 패딩하여 게이지 및 표의 자릿수 줄맞춤 완벽 유지
  - 마우스가 앱 창을 벗어나는 즉시 툴팁이 닫히는 화면 이탈 가드
- **철저한 보안 및 인증 경계**:
  - 벤더 CLI의 인증 소유권을 존중하며 토큰/자격증명 파일을 직접 읽거나 수정하지 않음

---

## 단축키 및 조작 안내

앱 하단의 `? Help` 버튼을 누르면 단축키 및 조작 안내 팝업을 확인할 수 있습니다.

| 기능 | 단축키 (Windows) | 단축키 (macOS) | UI 조작 |
| :--- | :--- | :--- | :--- |
| **간이 모드 전환** | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | 하단 <kbd>⊞</kbd> / <kbd>⊟</kbd> 버튼 |
| **로컬 토큰 표시 전환** | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> | 하단 <kbd>🪙</kbd> 버튼 |
| **다크 / 라이트 테마 전환** | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | 하단 <kbd>🌙</kbd> / <kbd>☀️</kbd> 버튼 |
| **항상 위 (핀) 고정** | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | 하단 <kbd>📌</kbd> 버튼 |
| **윈도우 드래그 이동** | - | - | 상단 헤더 영역 마우스 드래그 |
| **기본 위치로 재설정** | - | - | 트레이 아이콘 우클릭 $\rightarrow$ `기본 위치로 재설정` |
| **팝오버 닫기** | <kbd>Esc</kbd> | <kbd>Esc</kbd> | 핀 해제 상태에서 창 외부 클릭 또는 Esc |
| **윈도우 시작 시 자동 실행** | - | - | 트레이 아이콘 우클릭 $\rightarrow$ `Windows 로그인 시 시작` |

---

## 빠른 설치 및 실행 (Windows 개발자용)

관리자 권한(UAC) 없이 원클릭으로 패키징 빌드, 유저 프로그램 폴더 설치, 바로가기 등록 및 즉시 실행까지 완결되는 PowerShell 배포 스크립트를 제공합니다.

```powershell
# 빌드 후 유저 로컬 폴더(%LOCALAPPDATA%\Programs)에 배포 및 즉시 실행
pnpm deploy

# 부팅 시 자동 시작(AutoStart) 바로가기까지 함께 등록하여 배포
pnpm deploy:autostart

# 기존 빌드 산출물을 재사용하여 초고속 재배포
pnpm deploy:quick

# 설치된 프로그램 및 바로가기 완전 제거
pnpm deploy:uninstall
```

> 자세한 스크립트 옵션 및 배포 가이드는 [Windows 배포 가이드](docs/deploy-windows.md)를 참고하세요.

---

## 로컬 개발 및 테스트

Node.js 24 및 pnpm이 필요합니다.

```bash
# 의존성 설치
pnpm install

# 개발 모드 실행 (Vite + Electron Forge)
pnpm dev

# 전체 단위/통합 테스트 (28개 파일, 193개 테스트)
pnpm test

# 타입 체크 및 ESLint 정적 검사
pnpm typecheck
pnpm lint

# 프로덕션 애플리케이션 패키징
pnpm package

# Squirrel x64 배포 인스톨러 생성 (.exe)
pnpm make
```

---

## 프로바이더 연동 요구사항

- **Codex**:
  - `codex` CLI 로그인 상태가 유지되어 있어야 합니다.
- **Claude Code**:
  - `claude` CLI가 설치되어 있고 로그인이 완료되어 있어야 합니다.
  - 최초 실행 시 승인 폴더가 필요할 경우 팝오버의 `prepare folder`를 클릭하여 Windows Terminal에서 1회 승인을 완료합니다.
- **Antigravity (`agy`)**:
  - PATH에 `agy` 1.1.11 이상이 등록되어 있고 로그인된 상태여야 합니다. (선택 확장)

---

## 문서 및 참조

- [아키텍처 증거 및 모듈 경계 분석](docs/architecture-evidence.md)
- [아키텍처 평가 및 분리 계획 보고서](docs/architecture-assessment.md)
- [Windows 배포 도구 가이드](docs/deploy-windows.md)
- [Anthropic 인증 경계 결정](docs/decisions/0001-anthropic-credential-boundary.md)
- [v1 개발 로드맵](docs/plan/v1-roadmap.md)
- [제품 컨셉 및 설계 원칙](docs/product-concept.md)
