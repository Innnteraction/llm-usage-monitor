# Windows 개발자용 원클릭 배포 및 설치 가이드

이 문서는 개발자가 LLM Usage Monitor를 Windows 로컬 환경에서 한 번의 명령으로 빌드하고, 사용자 프로그램 폴더(`%LOCALAPPDATA%\Programs\llm-usage-monitor`)에 배포하여 트레이 상주 프로그램으로 사용하는 방법을 안내합니다.

---

## 개발 실행과 설치 실행 (v0.9.2)

`pnpm dev`는 현재 소스를 패키징한 뒤 `out/`의 실행 파일을 실행합니다. 개발 데이터는 `%APPDATA%\llm-usage-monitor-dev`에 분리하며 설치본이나 자동 시작 등록을 갱신하지 않습니다. 설치본을 업데이트하려면 `pnpm deploy:autostart`를 실행하세요. HMR이 필요한 경우 `pnpm dev:hmr`를 사용할 수 있지만, 이 PC에서 확인한 개발용 Electron 경로의 권한 문제는 [트러블슈팅](../TROUBLESHOOTING.md)을 참고하세요.

설치 후 실행 파일의 버전은 다음 명령으로 확인할 수 있습니다. 시작 프로그램 바로가기는 위 설치 경로의 실행 파일을 가리켜야 합니다.

```powershell
(Get-Item "$env:LOCALAPPDATA\Programs\llm-usage-monitor\LLM Usage Monitor.exe").VersionInfo.ProductVersion
```

## 1. 빠른 시작 (Quick Start)

### 기본 배포 및 앱 실행
프로젝트 루트에서 다음 명령어 중 하나를 실행합니다:

```powershell
# 최초 1회 또는 최신 브랜치 pull 후 의존성 동기화
pnpm install

# npm / pnpm 사용 시
pnpm deploy

# 또는 PowerShell 직접 실행 시
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1
```
- 앱이 패키징(빌드)됩니다.
- 기존 실행 중인 인스턴스가 있다면 안전하게 종료합니다.
- `%LOCALAPPDATA%\Programs\llm-usage-monitor` 디렉터리로 최신 파일이 배포됩니다.
- Windows 시작 메뉴에 `LLM Usage Monitor` 바로가기가 등록됩니다.
- 앱이 즉시 실행되어 시스템 트레이에 상주합니다.

---

## 2. 부팅 시 자동 시작 (AutoStart) 옵션

컴퓨터 부팅(Windows 로그인) 시 자동으로 백그라운드 트레이에 뜨도록 설정하려면 `-AutoStart` 옵션을 사용합니다:

```powershell
# npm / pnpm 사용 시
pnpm deploy:autostart

# 또는 PowerShell 직접 실행 시
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1 -AutoStart
```
- Windows 시작 프로그램 폴더(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`)에 바로가기가 등록됩니다.
- Windows 작업 관리자 `시작 앱` 탭에서도 `LLM Usage Monitor` 항목의 활성화 상태를 언제든 확인하고 제어할 수 있습니다.

---

## 3. 재빌드 생략 초고속 배포 (`-SkipBuild`)

이미 빌드된 `out/LLM Usage Monitor-win32-x64` 바이너리가 있고 파일 복사 및 바로가기 재설정만 빠르게 수행하려면 `-SkipBuild`를 지정합니다:

```powershell
# npm / pnpm 사용 시
pnpm deploy:quick

# 또는 PowerShell 직접 실행 시
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1 -SkipBuild
```

---

## 4. 파라미터 전체 목록

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `-AutoStart` | `$false` | Windows 로그인 시 자동 시작되도록 Startup 폴더에 바로가기 생성 |
| `-SkipBuild` | `$false` | 빌드를 건너뛰고 기존 `out/` 폴더 산출물을 재활용하여 배포 |
| `-NoStart` | `$false` | 배포 완료 후 앱을 자동으로 실행하지 않음 |
| `-CreateDesktopShortcut` | `$false` | 바탕화면에 실행 바로가기 생성 |
| `-InstallDir <Path>` | `%LOCALAPPDATA%\Programs\llm-usage-monitor` | 설치할 사용자 디렉터리 경로 (UAC 관리자 권한 불필요) |
| `-Uninstall` | `$false` | 설치된 프로그램, 바로가기 및 시작 프로그램 등록 완전 제거 |

---

## 5. 언인스톨 (완전 제거)

개발 테스트 종료 후 설치된 파일과 바로가기를 완전히 정리하려면 다음을 실행합니다:

```powershell
pnpm deploy:uninstall
# 또는
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1 -Uninstall
```
