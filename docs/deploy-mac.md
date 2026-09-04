# macOS 개발자용 원클릭 배포 및 설치 가이드

이 문서는 개발자가 LLM Usage Monitor를 macOS 로컬 환경에서 한 번의 명령으로 빌드하고, 사용자 애플리케이션 폴더(`~/Applications/LLM Usage Monitor.app`)에 배포하여 상단 메뉴바 트레이 상주 프로그램으로 사용하는 방법을 안내합니다.

---

## 1. 빠른 시작 (Quick Start)

### 기본 배포 및 앱 실행
프로젝트 루트에서 다음 명령어 중 하나를 실행합니다:

```bash
# npm / pnpm 사용 시 (OS 자동 감지)
pnpm run deploy

# 또는 macOS 전용 스크립트 직접 실행 시
./scripts/deploy-mac.sh
```

- 앱이 패키징(빌드)되어 `out/LLM Usage Monitor-darwin-*/LLM Usage Monitor.app` 번들이 생성됩니다.
- 기존 실행 중인 인스턴스가 있다면 안전하게 종료합니다.
- `~/Applications/LLM Usage Monitor.app` 디렉터리로 최신 번들이 설치됩니다.
- macOS 격리 속성(`xattr -cr`) 제거 및 ad-hoc 코드 서명이 자동 적용됩니다.
- 앱이 즉시 실행되어 화면 상단 메뉴바(트레이)에 상주합니다.

---

## 2. 로그인 시 자동 시작 (AutoStart) 옵션

컴퓨터 부팅 및 사용자 로그인 시 자동으로 백그라운드 메뉴바에 상주하도록 설정하려면 `--autostart` 옵션을 사용합니다:

```bash
# npm / pnpm 사용 시
pnpm deploy:autostart

# 또는 스크립트 직접 실행 시
./scripts/deploy-mac.sh --autostart
```

- `~/Library/LaunchAgents/com.innnteraction.llm-usage-monitor.plist`가 등록되고 활성화됩니다.
- 앱 내 트레이 우클릭 메뉴의 `로그인 시 시작` 체크박스를 통해서도 언제든 활성화/비활성화할 수 있습니다.

---

## 3. 재빌드 생략 초고속 재배포 (`--skip-build`)

이미 빌드된 `out/` 폴더의 산출물이 있고, 파일 복사 및 권한 재설정만 빠르게 수행하려면 `--skip-build`를 지정합니다:

```bash
# npm / pnpm 사용 시
pnpm deploy:quick

# 또는 스크립트 직접 실행 시
./scripts/deploy-mac.sh --skip-build
```

---

## 4. 파라미터 전체 목록

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `--autostart` | `false` | macOS 로그인 시 자동 시작되도록 LaunchAgent 등록 |
| `--skip-build` | `false` | 빌드를 건너뛰고 기존 `out/` 폴더 번들을 재활용하여 배포 |
| `--no-start` | `false` | 배포 완료 후 앱을 자동으로 실행하지 않음 |
| `--install-dir <경로>` | `~/Applications` | 설치할 사용자 디렉터리 경로 (관리자 권한 불필요) |
| `--uninstall` | `false` | 설치된 앱, LaunchAgent 등록 완전 제거 |

> [!TIP]
> 시스템 전역 설치를 원할 경우 `--install-dir /Applications`를 지정하여 `/Applications`에 설치할 수 있습니다 (사용자 계정에 쓰기 권한이 필요할 수 있습니다).

---

## 5. 언인스톨 (완전 제거)

개발 테스트 종료 후 설치된 앱과 자동 시작 설정을 완전히 정리하려면 다음을 실행합니다:

```bash
pnpm deploy:uninstall

# 또는 스크립트 직접 실행 시
./scripts/deploy-mac.sh --uninstall
```

---

## 6. 문제 해결 및 참고 사항

### Claude Code CLI 최초 1회 폴더 신뢰 승인
- Claude Code는 작업 디렉터리마다 1회 신뢰 확인("Do you trust this folder?")을 거칩니다.
- LLM Usage Monitor는 영구 디렉터리(`~/Library/Application Support/LLM Usage Monitor/claude-probe`)를 프로브 디렉터리로 사용합니다.
- 앱 팝오버에 `prepare folder` 안내가 뜰 경우 클릭하여 터미널을 열고, 1회 승인을 완료하면 이후 영구적으로 유지됩니다.

### PATH 환경 변수 인식
- GUI 앱으로 실행될 때도 `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin` 경로를 자동 감지하여 PATH에 병합하므로 `claude`, `codex`, `agy` CLI를 안정적으로 호출합니다.
