# mac 소스 설치 가이드

[English](deploy-mac.en.md) · [README](../README.ko.md)

## 선택과 사전 조건

macOS Apple Silicon·Intel의 시스템 Bash에서 실행합니다. Linux·Windows ARM64·WSL은 지원하지 않습니다. ZIP 압축을 푼 프로젝트 폴더에서 시작할 수 있고 Git은 필수가 아닙니다. 공개 빌드 패키지는 제공하지 않습니다.

Node는 웹 UI와 Electron 런타임을 포함하며 빌드 준비가 비교적 단순합니다. Rust는 네이티브 UI로 실행 메모리가 작을 것으로 예상되지만 최초 도구 설치와 컴파일 부담이 큽니다. 앱 용량·메모리 절감률을 보장하지 않습니다. 전체 UI 동등성과 macOS 실화면 검증은 진행 중입니다.

필요한 도구는 Node 24·pnpm 또는 Rust stable·Xcode·Metal toolchain입니다. 선택한 버전의 부족한 도구만 설치합니다. 기존 비호환 버전은 교체하지 않으며 적합한 버전을 PATH에서 선택한 뒤 재실행해야 합니다.

## 설치

```bash
bash scripts/install.sh --check
bash scripts/install.sh
```

검사 명령은 도구·앱·자동 시작을 변경하지 않습니다. 설치 명령은 버전과 신규 자동 시작 여부를 묻고, 변경할 내용·설치 출처를 표시한 뒤 동의를 받습니다. 자동 시작을 지정하지 않은 업데이트는 기존 상태를 유지합니다.

```bash
# Rust 선택 + 자동 시작; node로 바꾸면 Node 설치
bash scripts/install.sh --variant rust --autostart on
# 명시적 비대화형 동의: 도구 설치 및 앱 교체를 승인하는 옵션
bash scripts/install.sh --variant rust --autostart off --non-interactive --accept-install --accept-dependencies --no-start
```

비대화형은 버전·앱 변경 동의가 필수이며 도구 설치가 필요하면 도구 동의도 필수입니다. 신규 설치는 자동 시작 on/off를 명시해야 합니다. 운영체제의 관리자 권한·라이선스·재부팅 확인은 생략하지 않습니다. 누락 도구에 동의하지 않으면 멈추며 수동 준비 후 같은 명령으로 재개합니다.

## 실행·업데이트·전환

설치 위치는 `~/Applications/LLM Usage Monitor.app`입니다. 설치 완료 메시지와 `install-info.json`에 버전 종류·버전·소스 revision·실행 파일을 남깁니다. macOS의 설치 정보는 `Contents/Resources/`에 있습니다. 시작 메뉴 또는 앱 번들에서 실행하고 트레이 아이콘으로 화면을 엽니다.

앱은 하나만 관리합니다. 트레이 Quit으로 종료하고 새 소스에서 같은 명령을 실행하면 업데이트됩니다. 다른 버전을 선택하면 교체됩니다. 기존 앱을 강제로 종료하지 않습니다. 새 빌드 실패 시 기존 앱을 유지하며 교체·설정 실패는 이전 설치로 복구합니다. 알려진 별도 Native 설치 경로는 통합하고 임의 복사본은 삭제하지 않습니다.

로그인 자동 시작은 `~/Library/LaunchAgents/com.innnteraction.llm-usage-monitor.plist` 하나로 관리합니다. 양쪽 버전의 트레이 메뉴도 동일한 등록을 읽고 씁니다. 변경은 다음 로그인부터 적용되며 개발/preview 실행 파일에서는 등록할 수 없습니다. 버전 변경 시 기존 자동 시작 선택은 보존합니다. 공유 캐시는 유지하지만 버전별 UI 설정은 변환하지 않습니다.

## 제거·복구

```bash
bash scripts/install.sh --uninstall
```

종료 후 실행하세요. 앱·앱 소유 바로가기·자동 시작을 정리하며 캐시, 벤더 인증, Node/Rust/C++ 도구는 삭제하지 않습니다. 사용자 지정 설치 위치는 지원하지 않습니다.

- 파일 사용 중: 트레이에서 종료하고 재실행합니다. 창을 닫는 것만으로는 종료되지 않습니다.
- 다운로드·설치 실패: 표시된 공식 출처와 네트워크를 확인하고 다시 실행합니다. 기존 앱은 유지됩니다.
- 설치 후 명령을 찾지 못함: 새 터미널을 열어 PATH를 반영하고 재실행합니다.
- 기존 Node 버전 충돌: Node 24를 선택하여 시작합니다. 설치기는 기존 Node를 삭제하지 않습니다.
- 로그인 뒤 화면이 없음: 트레이 상주가 기본입니다. 아이콘을 열고 앱 등록 경로를 확인합니다.
- 이중 실행: 다른 개발·복사본을 종료합니다. 같은 공유 캐시를 쓰는 앱은 동시에 수집하지 못합니다.

기존 `pnpm deploy`, `deploy:autostart`, `deploy:quick`, `deploy:uninstall`은 Node 호환 진입점입니다. quick도 빌드를 검증하며 임의로 오래된 결과를 설치하지 않습니다. 기존 custom install-dir와 desktop-shortcut 옵션은 단일 관리 설치 정책상 지원하지 않습니다.

## 벤더 설정과 검증 범위

설치기는 벤더 CLI나 인증정보를 설치·변경하지 않습니다. 사용할 CLI만 공식 안내로 설치하고 직접 로그인하세요. Claude는 전용 폴더 신뢰 승인이 추가로 필요합니다. [초기 설정](../README.ko.md#프로바이더-초기-설정)을 따르세요.

앱 사용자 폴더 설치와 도구 설치 권한은 별개입니다. macOS 실기 로그인·화면과 Windows 실제 재부팅 검수는 자동 테스트 결과에 포함되지 않습니다. [검증 기록](../.work/SINGLE_INSTALL_RISKS.md)을 확인하세요.

Homebrew가 없으면 별도 동의를 받아 설치합니다. Rust 빌드에 필요한 Xcode/Metal이 없으면 Apple 설치 화면을 열고 중단합니다. Xcode 최초 실행·라이선스·toolchain 설치를 완료한 뒤 재실행하세요. ad-hoc 서명은 공증이 아니며 Gatekeeper를 자동 해제하지 않습니다. OS 보안 안내에 따라 신뢰한 자체 빌드만 실행하세요.
