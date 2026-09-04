#!/usr/bin/env bash
# ==============================================================================
# LLM Usage Monitor macOS 원클릭 빌드 및 사용자 폴더 배포 스크립트
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

APP_NAME="LLM Usage Monitor"
BUNDLE_NAME="LLM Usage Monitor.app"
DEFAULT_INSTALL_DIR="${HOME}/Applications"
LAUNCH_AGENT_LABEL="com.innnteraction.llm-usage-monitor"
LAUNCH_AGENT_PLIST="${HOME}/Library/LaunchAgents/${LAUNCH_AGENT_LABEL}.plist"

AUTO_START=false
SKIP_BUILD=false
NO_START=false
UNINSTALL=false
INSTALL_DIR="${DEFAULT_INSTALL_DIR}"

# ANSI 색상 코드
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 도움말 출력
show_help() {
    cat << EOF
LLM Usage Monitor macOS 배포 스크립트

사용법:
  ./scripts/deploy-mac.sh [옵션]

옵션:
  --autostart          macOS 로그인 시 자동 시작되도록 LaunchAgent 등록
  --skip-build         빌드를 건너뛰고 기존 out/ 폴더의 번들 산출물을 재활용하여 배포
  --no-start           배포 완료 후 앱을 자동으로 실행하지 않음
  --install-dir <경로>  설치 대상 디렉터리 (기본값: ~/Applications)
  --uninstall          설치된 앱, LaunchAgent 자동 시작 등록 완전 제거
  -h, --help           도움말 출력
EOF
}

# 인자 파싱
while [[ $# -gt 0 ]]; do
    case "$1" in
        --autostart)
            AUTO_START=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --no-start)
            NO_START=true
            shift
            ;;
        --uninstall)
            UNINSTALL=true
            shift
            ;;
        --install-dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --install-dir=*)
            INSTALL_DIR="${1#*=}"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}알 수 없는 옵션: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

TARGET_APP="${INSTALL_DIR}/${BUNDLE_NAME}"

# 1. 언인스톨 모드 처리
if [ "${UNINSTALL}" = true ]; then
    echo -e "${CYAN}=== ${APP_NAME} 언인스톨 시작 ===${NC}"

    # 실행 중인 프로세스 종료
    echo -e "${YELLOW}실행 중인 ${APP_NAME} 프로세스를 종료합니다...${NC}"
    pkill -f "${APP_NAME}" 2>/dev/null || true
    sleep 1

    # LaunchAgent 제거
    if [ -f "${LAUNCH_AGENT_PLIST}" ]; then
        echo -e "${YELLOW}LaunchAgent 자동 시작 등록을 해제합니다...${NC}"
        launchctl bootout "gui/$(id -u)" "${LAUNCH_AGENT_PLIST}" 2>/dev/null || launchctl unload "${LAUNCH_AGENT_PLIST}" 2>/dev/null || true
        rm -f "${LAUNCH_AGENT_PLIST}"
    fi

    # 설치된 앱 번들 제거
    if [ -d "${TARGET_APP}" ]; then
        echo -e "${YELLOW}설치된 애플리케이션을 삭제합니다: ${TARGET_APP}${NC}"
        rm -rf "${TARGET_APP}"
    fi

    echo -e "${GREEN}=== ${APP_NAME} 언인스톨이 완료되었습니다. ===${NC}"
    exit 0
fi

# 2. 빌드 단계 (필요 시)
echo -e "${CYAN}=== ${APP_NAME} macOS 배포 시작 ===${NC}"

if [ "${SKIP_BUILD}" = false ]; then
    echo -e "${YELLOW}[1/4] 애플리케이션 패키징 빌드를 시작합니다 (pnpm package)...${NC}"
    cd "${PROJECT_ROOT}"
    pnpm package
else
    echo -e "${YELLOW}[1/4] 빌드를 건너뛰고 기존 out/ 산출물을 재사용합니다 (--skip-build)...${NC}"
fi

# 산출물 검색 (arm64 우선 또는 x64)
SOURCE_APP=""
for candidate in "${PROJECT_ROOT}/out/LLM Usage Monitor-darwin-"*"/${BUNDLE_NAME}"; do
    if [ -d "${candidate}" ]; then
        SOURCE_APP="${candidate}"
        break
    fi
done

if [ -z "${SOURCE_APP}" ] || [ ! -d "${SOURCE_APP}" ]; then
    echo -e "${RED}오류: 빌드 산출물을 찾을 수 없습니다: out/LLM Usage Monitor-darwin-*/${BUNDLE_NAME}${NC}"
    echo -e "${RED}--skip-build를 지정하지 않고 다시 실행하거나 pnpm package를 먼저 수행하세요.${NC}"
    exit 1
fi

echo -e "${GREEN}빌드 산출물 확인: ${SOURCE_APP}${NC}"

# 3. 기존 실행 중인 앱 종료
echo -e "${YELLOW}[2/4] 실행 중인 이전 인스턴스를 확인하고 종료합니다...${NC}"
pkill -f "${APP_NAME}" 2>/dev/null || true
sleep 1

# 4. 대상 디렉터리로 복사 및 권한 설정
echo -e "${YELLOW}[3/4] 애플리케이션을 ${INSTALL_DIR} 로 설치합니다...${NC}"
mkdir -p "${INSTALL_DIR}"
rm -rf "${TARGET_APP}"
cp -R "${SOURCE_APP}" "${INSTALL_DIR}/"

# macOS 격리 속성(Quarantine) 제거 및 ad-hoc 코드 서명
echo -e "${YELLOW}macOS 격리 속성 제거 및 ad-hoc 코드 서명을 적용합니다...${NC}"
xattr -cr "${TARGET_APP}" 2>/dev/null || true
codesign --force --deep --sign - "${TARGET_APP}" 2>/dev/null || true

# 5. 자동 시작(AutoStart) 설정
if [ "${AUTO_START}" = true ]; then
    echo -e "${YELLOW}macOS 로그인 시 자동 시작(LaunchAgent)을 등록합니다...${NC}"
    mkdir -p "${HOME}/Library/LaunchAgents"
    cat << EOF > "${LAUNCH_AGENT_PLIST}"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/open</string>
        <string>-a</string>
        <string>${TARGET_APP}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)" "${LAUNCH_AGENT_PLIST}" 2>/dev/null || launchctl unload "${LAUNCH_AGENT_PLIST}" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "${LAUNCH_AGENT_PLIST}" 2>/dev/null || launchctl load "${LAUNCH_AGENT_PLIST}" 2>/dev/null || true
    echo -e "${GREEN}LaunchAgent 등록 완료: ${LAUNCH_AGENT_PLIST}${NC}"
fi

# 6. 앱 실행 (옵션)
if [ "${NO_START}" = false ]; then
    echo -e "${YELLOW}[4/4] ${APP_NAME}을(를) 실행합니다...${NC}"
    open "${TARGET_APP}"
else
    echo -e "${YELLOW}[4/4] --no-start 옵션으로 인해 앱을 실행하지 않습니다.${NC}"
fi

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}  ${APP_NAME} 배포가 성공적으로 완료되었습니다!${NC}"
echo -e "${GREEN}  - 설치 경로: ${TARGET_APP}${NC}"
if [ "${AUTO_START}" = true ]; then
    echo -e "${GREEN}  - 자동 시작: 활성화됨 (LaunchAgent)${NC}"
else
    echo -e "${YELLOW}  - 자동 시작: 비활성화 (트레이 우클릭 또는 --autostart 로 활성화 가능)${NC}"
fi
echo -e "${GREEN}================================================================${NC}\n"
