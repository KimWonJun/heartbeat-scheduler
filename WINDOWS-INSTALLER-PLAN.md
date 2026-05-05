# Windows Installer 추가 개발 계획

## 목표

현재 `cli-heartbeat-scheduler`는 provider 실행부는 Windows 친화적인 `spawn()` 기반이지만, 인터랙티브 자동 등록은 macOS LaunchAgent 중심입니다. 이 작업의 목표는 같은 `scheduleProfile` 설정을 Windows Task Scheduler에 등록할 수 있는 installer를 추가하는 것입니다.

최종 사용 흐름은 macOS와 최대한 동일하게 유지합니다.

```powershell
.\setup.ps1
```

또는 Node CLI로 직접 실행합니다.

```powershell
node src\index.js setup
node src\index.js list
node src\index.js status
node src\index.js test --mode dry --agents claude,codex
node src\index.js uninstall
```

## 설계 원칙

- 관리자 권한을 요구하지 않습니다.
- Windows 현재 사용자 Task Scheduler에 등록합니다.
- API key 자동화가 아니라 로컬 CLI 로그인 세션을 사용합니다.
- provider runner는 기존 `spawn()` + `shell: false` 원칙을 유지합니다.
- macOS LaunchAgent와 Windows Task Scheduler 구현은 platform module로 분리합니다.
- interactive setup UX와 config schema는 macOS와 공유합니다.
- 실제 provider 호출 없이 검증 가능한 dry probe를 먼저 제공합니다.
- 실제 provider smoke test는 사용자가 명시적으로 선택할 때만 실행합니다.

## 현재 상태

이미 구현된 부분:

- `scheduleProfile` 기반 config
- Claude, Codex, Gemini provider runner
- `runJob()`의 non-interactive spawn 실행
- JSONL 로그와 `last-status.json`
- macOS LaunchAgent installer
- macOS용 `./setup.sh`
- legacy Windows one-shot script: `scripts/install-windows-once-5am.ps1`

Windows에서 부족한 부분:

- profile 기반 Task Scheduler installer
- stale scheduler-owned task 정리
- Windows runtime copy 위치 정의
- Windows용 setup entrypoint
- Windows status/list/test/uninstall의 Task Scheduler 연동
- Windows dry probe
- Windows 문서와 검증 절차

## Windows runtime 위치

Windows에서는 macOS의 `~/.cli-heartbeat-scheduler`에 대응하는 위치를 사용합니다.

권장 기본값:

```text
%USERPROFILE%\.cli-heartbeat-scheduler
%USERPROFILE%\.cli-heartbeat-scheduler\app
%USERPROFILE%\.cli-heartbeat-scheduler\config.json
```

Node 내부에서는 기존 `os.homedir()` 기반 path를 계속 사용할 수 있습니다.

```text
path.join(os.homedir(), '.cli-heartbeat-scheduler')
```

## Task Scheduler 모델

각 job마다 하나의 Scheduled Task를 생성합니다.

Task name:

```text
CLI Heartbeat Scheduler\<job-id>
```

또는 schtasks 호환성을 우선하면 flat name을 사용합니다.

```text
CLI Heartbeat Scheduler <job-id>
```

권장 구현은 PowerShell `ScheduledTasks` module을 우선 사용하고, 테스트 가능한 command builder를 Node에서 생성합니다.

Action:

```text
node <runtimeDir>\src\index.js run --job <job-id> --config <runtimeDir>\config.json
```

Working directory:

```text
<runtimeDir>
```

Trigger:

- one-shot: `-Once -At <DateTime>`
- daily: `-Daily -At <TimeSpan>`
- weekdays: 요일별 weekly trigger 또는 multiple triggers

Principal:

- current user
- least privilege
- no highest privilege requirement

Settings:

- StartWhenAvailable: true 여부 검토
- AllowStartIfOnBatteries: true
- DisallowStartIfOnBatteries: false
- StopIfGoingOnBatteries: false
- ExecutionTimeLimit: job timeout보다 약간 길게

## 반복 방식 매핑

### One Shot

KST 기준 입력 시간이 오늘 이미 지났으면 다음 날짜로 계산합니다.

PowerShell trigger:

```powershell
New-ScheduledTaskTrigger -Once -At $runDate
```

실행 후 task 자동 삭제 전략은 두 가지 후보가 있습니다.

1. wrapper에서 성공/실패와 관계없이 self-delete
2. Task Scheduler의 expiration을 활용하고 cleanup 명령에서 제거

권장: macOS와 동일하게 wrapper 기반 self-delete를 구현합니다.

### Every Day

```powershell
New-ScheduledTaskTrigger -Daily -At "06:00"
```

### Selected Weekdays

PowerShell ScheduledTasks는 weekly trigger에 `-DaysOfWeek`를 사용할 수 있습니다.

```powershell
New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Wednesday,Friday -At "06:00"
```

요일 mapping:

```text
mon=Monday
tue=Tuesday
wed=Wednesday
thu=Thursday
fri=Friday
sat=Saturday
sun=Sunday
```

## 추가할 파일

### Platform module

```text
src/platform/windows-task-scheduler.js
```

책임:

- desired task 목록 생성
- PowerShell command/script 생성
- task 등록
- task 삭제
- stale scheduler-owned task 제거
- status 조회용 task name 계산
- dry mode에서 실제 등록 없이 script/command만 생성

예상 export:

```js
export function desiredWindowsTasks(config, options = {})
export function buildRegisterTaskScript(task, options = {})
export function buildUnregisterTaskScript(taskName)
export async function installWindowsScheduledTasks(config, options = {})
export async function pruneStaleWindowsTasks(options = {})
export async function listWindowsScheduledTasks(options = {})
```

### Windows wrapper

```text
scripts/run-windows.ps1
```

책임:

- Node path 확인
- `src/index.js run --job <job-id> --config <config-path>` 실행
- one-shot mode면 task 삭제
- stdout/stderr는 Task Scheduler 또는 scheduler 로그로 남김

인자:

```powershell
param(
  [string]$ProjectDir,
  [string]$ConfigPath,
  [string]$JobId,
  [string]$TaskName,
  [string]$Mode
)
```

### Windows setup entrypoint

```text
setup.ps1
```

책임:

- repo root로 이동
- Node CLI setup 호출
- PowerShell execution policy 문제를 피하기 위한 안내 제공

예상 실행:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

### Shared setup refactor

현재 `src/setup.js`는 macOS만 허용합니다.

변경 방향:

- interactive prompt는 platform neutral로 유지
- install step에서 `process.platform`에 따라 installer 분기
- `darwin`: `installMacOSLaunchAgents`
- `win32`: `installWindowsScheduledTasks`
- 그 외 platform은 config만 쓰거나 명확한 error 반환

변경 후보:

```text
src/setup.js
src/setup-core.js
src/paths.js
src/index.js
```

## CLI 명령 변경 계획

### setup

현재:

```text
macOS LaunchAgents only
```

변경:

```text
darwin -> LaunchAgent 설치
win32 -> Scheduled Task 설치
```

### status

현재:

```text
plist 존재 여부 + latest logs
```

변경:

```text
darwin -> LaunchAgent 상태
win32 -> Scheduled Task 존재 여부, LastRunTime, LastTaskResult, State
```

### test --mode dry

현재:

```text
임시 LaunchAgents 디렉터리에 plist 생성
```

변경:

```text
darwin -> 임시 plist 생성
win32 -> 임시 task registration script 생성 또는 fake task 등록 후 즉시 제거
```

권장 기본값은 실제 Task Scheduler를 건드리지 않는 script-generation dry run입니다.

### uninstall

현재:

```text
com.local.cli-heartbeat-scheduler.* LaunchAgent 제거
```

변경:

```text
darwin -> LaunchAgent 제거
win32 -> CLI Heartbeat Scheduler task 제거
```

## PowerShell 실행 방식

Node에서 PowerShell을 호출할 때는 `shell: false`를 유지하고 명시적으로 executable과 args를 구성합니다.

우선순위:

1. `pwsh`
2. `powershell.exe`

실행 예:

```js
spawnSync(powerShellBin, [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  scriptPath,
  ...args,
], { shell: false })
```

## Task name 안전 규칙

job id는 이미 `A-Za-z0-9._-`만 허용합니다. Windows task name에는 다음 prefix를 붙입니다.

```text
CLI Heartbeat Scheduler <job-id>
```

stale cleanup은 이 prefix를 가진 task만 대상으로 합니다.

사용자가 만든 다른 task를 삭제하지 않도록 prefix match를 엄격히 유지합니다.

## Phase 계획

### Phase W1: Windows Task 모델과 script generation

목표:

- Task name/action/trigger/settings를 순수 함수로 생성
- 실제 Windows가 아니어도 테스트 가능하게 구성

작업 파일:

- `src/platform/windows-task-scheduler.js`
- `test/windows-task-scheduler.test.js`

검증:

- one-shot task script 생성
- daily task script 생성
- weekdays task script 생성
- job id와 task name escaping 검증
- stale cleanup prefix 검증

### Phase W2: Runtime copy와 installer 통합

목표:

- `installConfiguredSchedule`을 platform-neutral로 refactor
- Windows runtime copy 후 task 등록 흐름 연결

작업 파일:

- `src/setup-core.js`
- `src/setup.js`
- `src/paths.js`
- `scripts/run-windows.ps1`
- `setup.ps1`

검증:

- macOS 기존 테스트가 깨지지 않음
- Windows installer는 mocked PowerShell runner로 테스트
- runtime copy에 `scripts/run-windows.ps1` 포함 확인

### Phase W3: CLI status/test/uninstall Windows 대응

목표:

- `status`, `test`, `uninstall`이 platform별 backend를 사용
- Windows dry probe 제공
- 실제 provider 호출은 선택적으로만 수행

작업 파일:

- `src/index.js`
- `src/status.js`
- `src/test-runner.js`
- `src/platform/windows-task-scheduler.js`
- `test/status.test.js`
- `test/test-runner.test.js`

검증:

- `test --mode dry`가 실제 provider를 호출하지 않음
- `uninstall`이 scheduler prefix task만 삭제
- Task Scheduler status parser 테스트

### Phase W4: Windows 실기 검증

목표:

- 실제 Windows 환경에서 Task Scheduler 등록/실행/삭제 검증

검증 환경:

- Windows 10 또는 Windows 11
- Node.js 20+
- PowerShell 5.1 또는 PowerShell 7+
- Claude/Codex/Gemini CLI 중 최소 1개 설치

검증 명령:

```powershell
npm install
npm test
node src\index.js doctor --config examples\config.schedule-profile.example.json
powershell -ExecutionPolicy Bypass -File .\setup.ps1
node src\index.js list
node src\index.js status
node src\index.js test --mode dry --agents claude,codex
node src\index.js uninstall
```

실제 provider smoke test:

```powershell
node src\index.js test --mode real --agents claude
```

### Phase W5: 문서화와 release 정리

목표:

- README에 Windows 사용법 추가
- DESIGN에 Windows Task Scheduler architecture 추가
- legacy `install-windows-once-5am.ps1`의 위치와 대체 경로 명시

작업 파일:

- `README.md`
- `DESIGN.md`
- `WINDOWS-INSTALLER-PLAN.md`

검증:

- macOS 문서와 Windows 문서가 충돌하지 않음
- `./setup.sh`와 `.\setup.ps1` 사용법이 분리되어 있음

## 자동 테스트 계획

로컬 macOS에서도 실행 가능한 테스트:

```bash
npm test
```

추가할 테스트 항목:

- Windows task name 생성
- PowerShell script escaping
- one-shot DateTime 계산
- daily trigger 생성
- weekdays trigger 생성
- Windows stale task cleanup command 생성
- Windows setup이 macOS setup 테스트를 깨지 않는지
- dry probe가 provider 호출을 하지 않는지
- runtime copy에 Windows wrapper가 포함되는지

테스트에서 실제 `Register-ScheduledTask`는 호출하지 않습니다. PowerShell runner를 주입하거나 command/script 생성 결과를 검증합니다.

## 수동 검증 계획

### macOS 회귀 검증

Windows 작업 후에도 macOS 경로가 깨지지 않아야 합니다.

```bash
npm test
node src/index.js --help
node src/index.js test --mode dry --agents claude,codex
node src/index.js status
```

### Windows dry 검증

실제 Task Scheduler 등록 없이 script generation만 검증합니다.

```powershell
npm test
node src\index.js test --mode dry --agents claude,codex
```

### Windows registration 검증

실제 task 등록:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
Get-ScheduledTask | Where-Object {$_.TaskName -like "CLI Heartbeat Scheduler*"}
```

상태 확인:

```powershell
node src\index.js status
```

즉시 실행 검증:

```powershell
Start-ScheduledTask -TaskName "CLI Heartbeat Scheduler claude-0600"
```

로그 확인:

```powershell
Get-ChildItem "$env:USERPROFILE\.cli-heartbeat-scheduler\logs" | Sort-Object LastWriteTime -Descending
```

삭제 검증:

```powershell
node src\index.js uninstall
Get-ScheduledTask | Where-Object {$_.TaskName -like "CLI Heartbeat Scheduler*"}
```

## 위험 요소와 대응

### ExecutionPolicy

문제:

- PowerShell script 실행이 막힐 수 있습니다.

대응:

- `setup.ps1` 사용법에 `-ExecutionPolicy Bypass` 명시
- Node에서 PowerShell 호출 시 `-NoProfile -ExecutionPolicy Bypass`

### PATH와 로그인 세션

문제:

- Task Scheduler에서 CLI PATH가 일반 터미널과 다를 수 있습니다.

대응:

- provider command는 env override를 계속 지원
- `doctor`로 CLI 탐지
- 필요하면 setup에서 resolved CLI path 저장을 후속 옵션으로 추가

### 사용자 session과 network

문제:

- CLI가 interactive login을 요구하면 scheduled task가 멈추거나 실패합니다.

대응:

- `runJob()` timeout 유지
- auth 관련 stderr를 `auth_required`로 분류
- 문서에서 각 CLI를 터미널에서 먼저 로그인하라고 안내

### Stale task 삭제 범위

문제:

- 사용자의 다른 Scheduled Task를 삭제하면 안 됩니다.

대응:

- task prefix를 `CLI Heartbeat Scheduler `로 고정
- prefix가 맞는 task만 cleanup
- dry run에서 삭제 대상 목록 출력

### One-shot cleanup

문제:

- 실행 중인 task가 자기 자신을 삭제할 때 실패할 수 있습니다.

대응:

- wrapper에서 실행 결과 기록 후 삭제
- 실패 시 `uninstall`로 정리 가능하게 유지
- self-delete 실패 로그를 stderr에 남김

## 브랜치 전략

현재 작업 브랜치:

```text
develop
```

진행 방식:

1. `main`은 안정 버전으로 유지합니다.
2. Windows installer 작업은 `develop`에서 진행합니다.
3. Phase W1-W5를 작은 커밋으로 나눕니다.
4. macOS 회귀 테스트와 Windows 검증이 끝나면 `main`으로 merge합니다.

## 완료 기준

- Windows에서 `setup.ps1`로 profile 기반 schedule 등록 가능
- `list/status/test/uninstall`이 Windows Task Scheduler와 연동
- daily, one-shot, selected weekdays 지원
- dry probe가 provider 호출 없이 검증 가능
- real smoke test는 명시 선택 시에만 실행
- macOS 기존 LaunchAgent 기능 회귀 없음
- `npm test` 통과
- README와 DESIGN에 Windows 사용법 반영
