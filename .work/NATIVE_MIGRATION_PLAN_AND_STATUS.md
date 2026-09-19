# 순수 Rust GPUI 네이티브 마이그레이션 전체 계획 및 진행 상황

> **작업 목표**: Electron(400MB) 상시/상주 모니터 앱을 Zed의 GPUI 기반 순수 Rust 네이티브 앱(20~35MB)으로 100% 패리티 대체  
> **핵심 변경**: 헤드리스 수집 엔진(M1), 시스템 트레이 및 팝오버 쉘(M2), 실시간 UI 컴포넌트(M3), 디테일 패리티(M4), 실측 벤치마크 및 최종 대체(M5)  
> **검증 기준**: 3개사 쿼터 정확도, 10,000+ 세션 로컬 토큰 집계 성능, 트레이/팝오버 UX 패리티, 상주 메모리 90%+ 절감  
> **영향 범위**: `feat/native-gpui` 브랜치 독립 개발 (`src-native/`), 기존 Electron 소스코드(`src/`) 및 `main` 브랜치 100% 무손실 보존  

---

> 2026-09-19 재검토: 아래 완료·실측·라이선스 서술은 이전 작업의 기록이며, 재검증에서 구현 차이가 확인되었습니다. 현재 판정은 [M5 검증 보고서](NATIVE_M5_REPORT.md)를 우선합니다. M4 구현 및 Windows 측정은 수행했으나 메모리 목표 미달과 UI·macOS 검증 미완료로 최종 대체는 보류합니다.

## 1. 프로젝트 배경 및 전환 목적

### 1.1 배경
- LLM Usage Monitor는 Claude Code, OpenAI Codex, Google Antigravity 3개사의 쿼터 잔여량과 리셋 시각, 벤더 서버 장애 상태, PC 내 10,000개 이상의 세션 파일 토큰을 실시간 집계하는 시스템 트레이 상주 앱입니다.
- 기존 Electron 기반 구현은 크로스플랫폼과 빠른 UI 구현에는 유리했으나, Chromium 렌더러 프로세스 + Node.js 런타임의 기본 상주 오버헤드로 인해 **평상시 메모리 사용량이 ~400MB에 달하는 한계**가 있었습니다.

### 1.2 목표
- **초경량 메모리**: 상시 활성 표시 시 20~35MB, 트레이 상주(창 닫힘) 시 12~20MB (기존 대비 90% 이상 메모리 절감).
- **디자인 및 기능 100% 패리티**: 현재 Electron v0.12.0의 모든 기능(3개사 쿼터, 3개사 장애 상태, 세션 로그 증분 집계, 팝오버 스냅 위치, 핀 고정, 트레이 메뉴 등)을 완벽하게 만족.
- **점진적 무위험 전환**: `feat/native-gpui` 브랜치에서 독립적으로 완성 및 검증한 뒤, 사용자의 최종 검수 후 기존 Electron 버전을 대체.
- **100% Permissive 라이선스**: Qt나 GPL/LGPL 종속성을 일체 배제하고, Apache-2.0 / MIT 라이선스(GPUI, tray-icon, muda)만 사용하여 라이선스 오염 방지.

---

## 2. 기술 스택 및 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    GPUI Native Application                  │
│  (WindowOptions: PopUp, Transparent, Borderless, 20~35MB)   │
├──────────────────────────────┬──────────────────────────────┤
│       UI Components          │         Shell & Tray         │
│  - QuotaCard (게이지, 카운트다운)│  - SystemTrayManager (muda)  │
│  - VendorHealthBanner (장애배너) │  - Popover Positioner        │
│  - LocalTokensCard (토큰 집계) │  - Blur Auto-hide & Pin      │
├──────────────────────────────┴──────────────────────────────┤
│                   Headless Collector Engine                 │
│  - Codex Provider (JSON-RPC 2.0 app-server)                 │
│  - Claude Provider (portable-pty VT100 터미널 스크래핑)     │
│  - Antigravity Provider (agy CLI JSON 파싱)                 │
│  - Vendor Health (Statuspage API 비동기 폴링)               │
│  - Local Token Scanner (10,000+ 세션 JSONL 증분 캐시)        │
└─────────────────────────────────────────────────────────────┘
```

- **GUI 프레임워크**: Zed의 `gpui` 0.2 (Apache-2.0 / MIT) - GPU 가속 DirectWrite/Metal/Vulkan 렌더러
- **시스템 트레이 및 메뉴**: `tray-icon` 0.19, `muda` 0.15 (Apache-2.0 / MIT)
- **비동기 런타임 & 네트워크**: `tokio` 1.38, `reqwest` 0.12 (rustls-tls)
- **가상 터미널(PTY)**: `portable-pty` 0.8 (MIT)
- **시간 및 직렬화**: `chrono` 0.4, `serde` 1.0, `serde_json` 1.0
- **파일 모니터링 & 해시**: `notify` 6.1, `sha2` 0.10

---

## 3. 전체 마일스톤 계획 및 진행 현황

| 마일스톤 | 단계명 | 주요 내용 | 상태 | 커밋 / 산출물 |
|:---:|:---|:---|:---:|:---|
| **M1** | 헤드리스 수집 코어 엔진 | 3개사 쿼터 CLI/RPC 파서, 3개사 장애 상태, 10,000+ 세션 토큰 증분 캐시, 병렬 수집 엔진 | **초기 구현, 재검증 보완** | 커밋 `38ef7fb`<br>`test-collector` 실측 성공 |
| **M2** | GPUI 트레이 & 팝오버 쉘 | GPUI 무테 투명 팝업 창, 트레이 아이콘 내장, 스마트 팝오버 좌표 계산(스냅), 외부 클릭 자동 닫기, 핀 고정 | **초기 구현, 재검증 보완** | 커밋 `3492e02`<br>단위 테스트 통과 |
| **M3** | 실시간 엔진 연동 & UI 뷰 | 백그라운드 주기적(60초) 자동 수집, 쿼터 카드, 게이지 바, 리셋 카운트다운, 서버 장애 배너, 로컬 토큰 카드 연동 | **초기 구현, 재검증 보완** | 커밋 `3492e02`<br>`llm-usage-monitor.exe` 빌드 |
| **M4** | UI 디테일 패리티 & 인터랙션 | 컴팩트 테이블 뷰 모드, 테마(다크/라이트) 팔레트, 툴팁 도움말, 수동 새로고침 버튼 반응 | **구현, 화면 검증 미완료** | `876c2ba`, M5 보고서 |
| **M5** | 실측 벤치마크 & 최종 대체 | 활성/상주 메모리 실측(20~35MB 검증), macOS/Windows 크로스 컴파일 점검, 최종 검수 후 Electron 대체 | **Windows 측정 완료, 대체 보류** | [M5 보고서](NATIVE_M5_REPORT.md) |

---

## 4. 초기 구현 기록 (M1 ~ M3, 아래 실측은 이번 재검증 결과가 아님)

### 4.1 마일스톤 1: 헤드리스 수집 엔진 구축 (완료, `38ef7fb`)
- **OpenAI Codex**: `codex app-server --stdio` 프로세스 구동, JSON-RPC 2.0 프로토콜 핸드셰이크 (`initialize`, `account/read`, `rateLimits/read`), 5시간 및 주간 윈도우 정규화.
- **Claude Code**: `portable-pty` 가상 터미널 환경에서 백그라운드 리더 스레드로 `/usage` 터미널 화면 캡처, ANSI 제어문자 제거, 복수 프레임 병합, KST/시차/날짜형 리셋 시각 파서 구현.
- **Google Antigravity**: `agy --version` 감지, `agy --print /usage --output-format json` 안전 파싱, Gemini 및 Claude/GPT 쿼터 정규화, `cli.log` 계정 테일 추출.
- **3개사 서버 장애 모니터링**: Anthropic, OpenAI, Google Cloud Statuspage API 비동기 폴링 및 모의 장애 인젝션 지원.
- **10,000+ 세션 로컬 토큰 증분 캐시**: Codex(`~/.codex/sessions`), Claude(`~/.claude/projects`)의 10,128개 JSONL 파일에 대해 `mtimeMs` + `size` 기반 체크포인트 캐시(`local-usage-index-v1.json`)를 구축하여 초기 스캔 후 재스캔 속도를 0.1초대로 단축.
- **실제 환경 실측 (`test-collector` 검증)**:
  - Claude: (계정 식별자 생략) (5h: 30.0% used, resets at 04:20 UTC / 7d: 47.0% used, resets at 12:00 UTC) [Fresh]
  - Antigravity: (계정 식별자 생략) (Gemini 주간 11%, 5h 33%, Claude/GPT 0%) [Fresh]
  - Codex: 미설치 정상 감지 [Unavailable]
  - 로컬 토큰: Codex 50.3억 토큰 (721개 파일), Claude 70.4억 토큰 (10,128개 파일)

### 4.2 마일스톤 2: GPUI 시스템 트레이 & 무테 팝오버 쉘 (완료, `3492e02`)
- **무테 투명 팝오버 윈도우**:
  - `WindowOptions`: `WindowKind::PopUp`, `titlebar: None`, `WindowBackgroundAppearance::Transparent`.
  - 둥근 모서리(`rounded-xl`)와 모던 다크 테마 그림자(`shadow-xl`).
- **시스템 트레이 (`tray-icon` & `muda`)**:
  - 바이너리에 `assets/icons/tray-icon.png`를 컴파일 타임 내장(`include_bytes!`).
  - 우클릭 메뉴: `LLM Usage Monitor v0.12.0` (라벨), `열기 (Open)`, `새로고침 (Refresh)`, `위치 초기화 (Reset Position)`, `종료 (Quit)`.
  - 좌클릭 토글: 팝오버 창 보이기/숨기기 토글.
- **스마트 팝오버 좌표 계산기 (`src-native/shell/position.rs`)**:
  - Electron `src/main/windowPosition.ts` 로직을 1:1 완벽 이식.
  - Windows 작업표시줄(하단/상단/좌/우) 및 모니터 경계 자동 클램핑.
  - 단위 테스트 2종 통과 (`test_bottom_taskbar_position`, `test_top_menu_bar_position`).
- **인터랙션 처리**:
  - `cx.observe_window_activation`: 외부 클릭(Blur) 시 자동 닫기.
  - `📍 Pin` / `📌 Pinned`: 헤더 핀 고정 토글 시 포커스를 잃어도 창 유지.
  - `foreground_executor`: 메인 스레드 비동기 루프로 트레이/메뉴 이벤트 논블로킹 수신.

### 4.3 마일스톤 3: 실시간 엔진 연동 & UI 뷰 컴포넌트 (완료, `3492e02`)
- **UI 뷰 컴포넌트 (`src-native/ui/`)**:
  - `format.rs`: 토큰 친화적 포맷(`7.05B`, `12.34M`), 리셋 카운트다운(`in 2h 30m`, `in 1d 5h`), 색상 톤 판별 (`Low`, `Medium`, `High`, `Stale`).
  - `quota_card.rs`: 프로바이더별 카드, 계정 레이블, 상태 뱃지, 막대 진행률 바(`DefiniteLength::Fraction`), 수치 및 남은 시간 표시.
  - `vendor_banner.rs`: 3개사 서버 정상 시 `All Systems Operational`, 장애 시 경고 배너 및 인시던트 타이틀 렌더링.
  - `local_tokens.rs`: Claude 및 Codex 로컬 누적 토큰과 총 파일 수 집계 카드.
- **실시간 백그라운드 수집**:
  - 앱 시작 시 즉시 1회 병렬 수집.
  - 매 60초마다 자동 백그라운드 갱신.
  - 트레이 메뉴의 "새로고침" 클릭 시 즉시 수집 트리거 및 UI 리프레시.
- **빌드 및 테스트 결과**:
  - 7개 단위 테스트 전체 통과 (0.17초 소요).
  - 네이티브 실행 파일 `target\debug\llm-usage-monitor.exe` 빌드 완료.

---

## 5. M4 ~ M5 원래 계획과 현재 상태

M4 기능은 구현했다. 아래 목록은 원래 수용 기준이며, 구현만으로 UI 패리티를 확정하지 않는다. M5 Windows 측정과 자동 검증 결과, 미충족 기준은 최신 보고서를 참조한다.

### 마일스톤 4: UI 디테일 패리티 (구현, 직접 화면 검증 미완료)
1. **컴팩트 테이블 모드 (Compact Mode) 구현**:
   - 기존 Electron의 3개사 한눈에 보기 테이블(`CompactQuotaTable.tsx`) 레이아웃 이식.
   - 헤더에 컴팩트 모드 토글 버튼 추가.
2. **다크 / 라이트 테마 팔레트**:
   - OS 테마 변경 감지 및 토글 기능.
3. **도움말 / 툴팁 (Help / Tooltips)**:
   - 각 쿼터 값 및 리셋 시각 호버 시 상세 설명 표시.
4. **상단 새로고침 인디케이터**:
   - 수집 중일 때 헤더 상태 점 애니메이션/색상 전환.

### 마일스톤 5: 메모리 실측 벤치마크, 크로스플랫폼 검증 및 최종 대체 (측정 수행, 대체 보류)
1. **런타임 메모리 실측 벤치마크**:
   - Windows 작업 관리자 / Process Explorer 기준 실측:
     - 팝오버 창 활성화 표시 중 Working Set: **목표 20~35MB** (Electron 400MB 대비 90%+ 절감).
     - 트레이 상주(창 닫힘) 시 Working Set: **목표 12~20MB** (Electron 대비 95% 절감).
   - CPU 사용률 (유휴 상태 0.0% 유지 확인).
2. **macOS 크로스플랫폼 무결성 점검**:
   - macOS 메뉴바 템플릿 아이콘 및 상단 메뉴바 스냅 좌표 검증.
3. **최종 사용자 검수 및 대체**:
   - 디자인, 인터랙션, 쿼터 정확도 최종 확인.
   - 사용자 최종 승인 후 `main` 브랜치에 네이티브 엔진 대체 병합.

---

## 6. 안전성 및 불변 원칙 준수 현황

- **라이선스 확인 범위**: Windows resolve graph 508개 선언을 확인했다. [타깃별 결과](NATIVE_WINDOWS_LICENSES.md)를 참조하며, 모든 플랫폼 및 배포 고지 감사는 미완료다.
- **인증 경계**: Claude Code/Codex/Antigravity의 인증 파일을 앱이 직접 수정/변조하지 않으며, 토큰 및 키를 로그나 문서에 남기지 않음.
- **저장소 보존**: `main` 브랜치의 안정된 Electron 버전(`v0.12.0`)을 그대로 유지하고 있으며, `feat/native-gpui` 브랜치에서만 작업하여 점진적으로 검증한다. 잔여 리스크는 별도 기록했다.
