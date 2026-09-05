<#
.SYNOPSIS
    LLM Usage Monitor Windows 원클릭 빌드 및 사용자 폴더 배포 스크립트

.DESCRIPTION
    앱을 빌드하고 Windows 사용자 로컬 프로그램 디렉터리(%LOCALAPPDATA%\Programs\llm-usage-monitor)로
    배포한 후 트레이 앱으로 기동합니다. OS 로그인 시 자동 시작(AutoStart)과 바로가기 생성을 옵션으로 지원합니다.

.PARAMETER AutoStart
    Windows 로그인 시 자동으로 실행되도록 시작 프로그램(Startup) 폴더에 바로가기를 등록합니다.

.PARAMETER SkipBuild
    빌드 과정을 건너뛰고 기존 out/ 폴더의 패키지 산출물을 재활용하여 배포합니다.

.PARAMETER NoStart
    배포 완료 후 앱을 자동으로 실행하지 않습니다.

.PARAMETER CreateDesktopShortcut
    바탕화면에 실행 바로가기를 생성합니다.

.PARAMETER InstallDir
    설치할 대상 디렉터리 경로 (기본값: $env:LOCALAPPDATA\Programs\llm-usage-monitor).

.PARAMETER Uninstall
    설치된 프로그램, 바로가기 및 시작 프로그램 등록을 제거합니다.

.EXAMPLE
    .\scripts\deploy-windows.ps1
    기본 빌드 후 유저 폴더 배포 및 즉시 실행

.EXAMPLE
    .\scripts\deploy-windows.ps1 -AutoStart
    빌드 및 배포 후 시작 프로그램 등록 및 실행

.EXAMPLE
    .\scripts\deploy-windows.ps1 -SkipBuild -AutoStart
    빌드 생략 후 초고속 재배포 및 시작 프로그램 등록

.EXAMPLE
    .\scripts\deploy-windows.ps1 -Uninstall
    설치된 파일 및 시작 프로그램/바로가기 제거
#>

[CmdletBinding()]
param(
    [switch]$AutoStart,
    [switch]$SkipBuild,
    [switch]$NoStart,
    [switch]$CreateDesktopShortcut,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\llm-usage-monitor"),
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$AppName = "LLM Usage Monitor"
$ExeName = "LLM Usage Monitor.exe"
$SourceDir = Join-Path $ProjectRoot "out\LLM Usage Monitor-win32-x64"
$TargetExe = Join-Path $InstallDir $ExeName

# 바로가기 생성 헬퍼 함수
function New-AppShortcut {
    param(
        [Parameter(Mandatory = $true)][string]$ShortcutPath,
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [string]$IconLocation = "",
        [string]$Description = ""
    )
    $parentDir = Split-Path -Parent $ShortcutPath
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }
    $wshell = New-Object -ComObject WScript.Shell
    try {
        $shortcut = $wshell.CreateShortcut($ShortcutPath)
        $shortcut.TargetPath = $TargetPath
        $shortcut.WorkingDirectory = $WorkingDirectory
        if ($IconLocation -and (Test-Path $IconLocation)) {
            $shortcut.IconLocation = $IconLocation
        }
        $shortcut.Description = $Description
        $shortcut.Save()
    } finally {
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($wshell) | Out-Null
    }
}

# 1. 언인스톨 모드 처리
if ($Uninstall) {
    Write-Host "=== $AppName 언인스톨 시작 ===" -ForegroundColor Cyan

    # 실행 중인 프로세스 종료
    $runningProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -eq "LLM Usage Monitor" -or
        ($_.Path -and $_.Path -like "*Programs\llm-usage-monitor\*")
    }
    if ($runningProcesses) {
        Write-Host "실행 중인 $AppName 프로세스를 종료합니다..." -ForegroundColor Yellow
        $runningProcesses | Stop-Process -Force
        Start-Sleep -Seconds 1
    }

    # 바로가기 제거
    $startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk"
    if (Test-Path $startMenuShortcut) {
        Remove-Item -Path $startMenuShortcut -Force -ErrorAction SilentlyContinue
        Write-Host "시작 메뉴 바로가기 제거됨: $startMenuShortcut" -ForegroundColor Gray
    }

    $startupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) "$AppName.lnk"
    if (Test-Path $startupShortcut) {
        Remove-Item -Path $startupShortcut -Force -ErrorAction SilentlyContinue
        Write-Host "시작 프로그램(AutoStart) 등록 해제됨: $startupShortcut" -ForegroundColor Gray
    }

    $desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"
    if (Test-Path $desktopShortcut) {
        Remove-Item -Path $desktopShortcut -Force -ErrorAction SilentlyContinue
        Write-Host "바탕화면 바로가기 제거됨: $desktopShortcut" -ForegroundColor Gray
    }

    # 설치 폴더 제거
    if (Test-Path $InstallDir) {
        Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "설치 폴더 제거됨: $InstallDir" -ForegroundColor Gray
    }

    Write-Host "=== $AppName 언인스톨이 완료되었습니다. ===" -ForegroundColor Green
    exit 0
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  $AppName Windows 배포 도구" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "설치 경로: $InstallDir" -ForegroundColor Gray
Write-Host "시작프로그램 등록(AutoStart): $(if ($AutoStart) { '예' } else { '아니오' })" -ForegroundColor Gray
Write-Host "배포 후 즉시 실행: $(if ($NoStart) { '아니오' } else { '예' })" -ForegroundColor Gray

# 2. 실행 중인 기존 프로세스 안전 종료 (파일 잠금 방지)
$existingProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -eq "LLM Usage Monitor" -or
    ($_.Path -and $_.Path -like "*Programs\llm-usage-monitor\*")
}
if ($existingProcesses) {
    Write-Host "[1/5] 실행 중인 기존 $AppName 인스턴스를 종료합니다..." -ForegroundColor Yellow
    $existingProcesses | Stop-Process -Force
    Start-Sleep -Seconds 1
} else {
    Write-Host "[1/5] 실행 중인 $AppName 인스턴스 없음 (진행)." -ForegroundColor Gray
}

# 3. 빌드 (package) 단계
if (-not $SkipBuild) {
    Write-Host "[2/5] 애플리케이션 패키징(빌드) 시작..." -ForegroundColor Cyan
    Push-Location $ProjectRoot
    try {
        if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
            Write-Host "  node_modules 디렉터리가 없습니다. 의존성을 먼저 설치합니다..." -ForegroundColor Yellow
            pnpm install
            if ($LASTEXITCODE -ne 0) {
                throw "의존성 설치(pnpm install)에 실패했습니다 (종료 코드: $LASTEXITCODE)."
            }
        }
        $forgeCmd = Join-Path $ProjectRoot "node_modules\.bin\electron-forge.cmd"
        if (Test-Path $forgeCmd) {
            & $forgeCmd package
        } else {
            pnpm package
        }
        if ($LASTEXITCODE -ne 0) {
            throw "빌드 과정에서 오류가 발생했습니다 (종료 코드: $LASTEXITCODE).`n최신 브랜치 변경사항이 있다면 'pnpm install'을 먼저 실행한 후 다시 시도해 보세요."
        }
    } finally {
        Pop-Location
    }
    Write-Host "빌드 완료." -ForegroundColor Green
} else {
    Write-Host "[2/5] -SkipBuild 지정됨: 기존 빌드 산출물을 사용합니다." -ForegroundColor Gray
}

# 패키지 산출물 확인
if (-not (Test-Path (Join-Path $SourceDir $ExeName))) {
    throw "패키지 산출물을 찾을 수 없습니다: $SourceDir`n-SkipBuild 없이 빌드를 먼저 진행해 주세요."
}

# 4. 사용자 폴더로 복사 배포
Write-Host "[3/5] 사용자 폴더로 파일 배포 중..." -ForegroundColor Cyan
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

# robocopy를 사용하여 미러 복사 (Windows 내장, 잠금 파일 제외 및 안정적 고속 전송)
robocopy "$SourceDir" "$InstallDir" /MIR /R:2 /W:1 /NP /NDL /NFL /NJH /NJS | Out-Null
# Robocopy 반환 코드: 0~7은 정상 (0: 변경 없음, 1: 파일 복사됨, 2: 잉여 파일 제거됨 등)
if ($LASTEXITCODE -gt 7) {
    throw "파일 복사(Robocopy) 중 오류가 발생했습니다 (코드: $LASTEXITCODE)."
}
Write-Host "배포 완료: $InstallDir" -ForegroundColor Green

# 5. 바로가기 및 시작 프로그램(AutoStart) 설정
Write-Host "[4/5] 바로가기 및 시작 프로그램 설정 중..." -ForegroundColor Cyan

# 5-1. 시작 메뉴 바로가기 (검색 및 시작 메뉴에서 항상 접근 가능)
$startMenuDir = [Environment]::GetFolderPath('Programs')
$startMenuShortcut = Join-Path $startMenuDir "$AppName.lnk"
New-AppShortcut `
    -ShortcutPath $startMenuShortcut `
    -TargetPath $TargetExe `
    -WorkingDirectory $InstallDir `
    -IconLocation $TargetExe `
    -Description "$AppName - Windows Tray Usage Monitor"
Write-Host "  시작 메뉴 바로가기 등록: $startMenuShortcut" -ForegroundColor Gray

# 5-2. 바탕화면 바로가기 (선택)
if ($CreateDesktopShortcut) {
    $desktopDir = [Environment]::GetFolderPath('Desktop')
    $desktopShortcut = Join-Path $desktopDir "$AppName.lnk"
    New-AppShortcut `
        -ShortcutPath $desktopShortcut `
        -TargetPath $TargetExe `
        -WorkingDirectory $InstallDir `
        -IconLocation $TargetExe `
        -Description "$AppName - Windows Tray Usage Monitor"
    Write-Host "  바탕화면 바로가기 등록: $desktopShortcut" -ForegroundColor Gray
}

# 5-3. 부팅 시 자동 실행 (AutoStart)
$startupDir = [Environment]::GetFolderPath('Startup')
$startupShortcut = Join-Path $startupDir "$AppName.lnk"
if ($AutoStart) {
    New-AppShortcut `
        -ShortcutPath $startupShortcut `
        -TargetPath $TargetExe `
        -WorkingDirectory $InstallDir `
        -IconLocation $TargetExe `
        -Description "$AppName - AutoStart"
    Write-Host "  [OK] Windows 로그인 시 자동 시작(AutoStart) 등록 완료." -ForegroundColor Green
} else {
    Write-Host "  AutoStart 미지정 (시작 프로그램 등록 건너뜀)." -ForegroundColor Gray
}

# 6. 애플리케이션 실행
if (-not $NoStart) {
    Write-Host "[5/5] $AppName 실행 중..." -ForegroundColor Cyan
    Start-Process -FilePath $TargetExe -WorkingDirectory $InstallDir
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "  [성공] $AppName 가 실행되었습니다!" -ForegroundColor Green
    Write-Host "  작업 표시줄 시스템 트레이 아이콘을 확인하세요." -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
} else {
    Write-Host "[5/5] -NoStart 지정됨: 앱 실행을 건너뜁니다." -ForegroundColor Gray
    Write-Host "배포가 성공적으로 완료되었습니다." -ForegroundColor Green
}
