# CLI Heartbeat Scheduler

`cli-heartbeat-scheduler`는 Claude Code, Codex, Gemini CLI에 짧은 로컬 CLI 프롬프트를 정해진 시간에 실행하는 Node.js 스케줄러입니다.

이 프로젝트는 API 자동화가 아닙니다. 이미 컴퓨터에 로그인되어 있는 CLI 세션을 사용해 `test! 출력` 같은 짧은 명령을 실행하고, 출력과 상태를 기록한 뒤 바로 종료합니다. 대화 세션을 이어가거나 긴 agent 작업을 돌리는 용도가 아닙니다.

## 핵심 특징

- Claude Code, Codex, Gemini CLI 지원
- KST 기준 여러 실행 시간 설정 가능: 예를 들어 `06:00,11:00,16:00`
- 실행 방식 선택 가능: one-shot, 매일 실행, 특정 요일 실행
- macOS LaunchAgent 자동 등록
- 재설정 시 기존 scheduler-owned LaunchAgent 정리
- provider를 실제 호출하지 않는 dry probe 테스트 제공
- 실행 로그를 JSONL로 저장
- 관리자 권한 없이 현재 사용자 세션 기준으로 동작

## 요구사항

- Node.js 20 이상
- macOS에서 `./setup.sh`를 통한 LaunchAgent 설치
- 사용할 CLI는 미리 설치 및 로그인 필요
  - Claude Code CLI: `claude`
  - Codex CLI: `codex`
  - Gemini CLI: `gemini`

로그인은 이 스케줄러가 처리하지 않습니다. 각 CLI를 터미널에서 한 번 직접 실행해 로그인 상태를 만들어 둔 뒤 사용하세요.

## 빠른 시작

```bash
cd /Users/kimwonjun/Desktop/03_Study/03_Side_Projects/cli-heartbeat-scheduler
npm install
npm test
./setup.sh
```

`./setup.sh`를 실행하면 다음 항목을 순서대로 묻습니다.

1. 설정할 AI agent
   - Claude Code
   - Codex
   - Gemini CLI
2. 실행 시간
   - KST 기준 `HH:MM`
   - 여러 개는 쉼표로 입력: `06:00,11:00,16:00`
3. 반복 방식
   - one shot
   - 매일 실행
   - 특정 요일 실행
4. 설정 후 테스트 여부
   - dry launchd probe
   - 테스트 안 함
   - 실제 provider smoke test

설정 결과는 아래 위치에 저장됩니다.

```text
~/.cli-heartbeat-scheduler/config.json
```

launchd가 안전하게 실행할 runtime copy는 아래 위치에 생성됩니다.

```text
~/.cli-heartbeat-scheduler/app
```

## 권장 사용 흐름

처음 설정:

```bash
./setup.sh
```

현재 스케줄 확인:

```bash
node src/index.js list
```

LaunchAgent 등록 상태와 최근 실행 결과 확인:

```bash
node src/index.js status
```

provider 호출 없이 launchd plist 생성 흐름만 테스트:

```bash
node src/index.js test --mode dry --agents claude,codex
```

실제 provider를 즉시 호출해 smoke test:

```bash
node src/index.js test --mode real --agents claude
```

주의: `--mode real`은 실제 Claude/Codex/Gemini CLI 호출을 수행합니다.

모든 scheduler-owned LaunchAgent 제거:

```bash
node src/index.js uninstall
```

## 설정 변경

설정 시간을 바꾸거나 agent를 변경할 때도 같은 명령을 다시 실행합니다.

```bash
./setup.sh
```

기존 `~/.cli-heartbeat-scheduler/config.json`을 읽어 기본값으로 보여주고, 새 선택값으로 config를 다시 생성합니다. 이후 현재 설정에 없는 stale LaunchAgent는 제거하고, 필요한 LaunchAgent를 다시 등록합니다.

예를 들어 기존에 `06:00,11:00,16:00`으로 설정한 뒤 `07:30,12:30`으로 바꾸면 이전 시간대 plist는 정리되고 새 시간대 plist만 남습니다.

## CLI 명령어

```bash
./setup.sh
node src/index.js setup
node src/index.js list
node src/index.js status
node src/index.js test --mode dry
node src/index.js test --mode real --agents claude,codex
node src/index.js uninstall
node src/index.js doctor
node src/index.js next --count 3
node src/index.js run --job <job-id>
node src/index.js start
```

Windows에서는 PowerShell entrypoint를 사용할 수 있습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
node src\index.js list
node src\index.js status
node src\index.js test --mode dry --agents claude,codex
node src\index.js uninstall
```

별도 config를 지정할 수도 있습니다.

```bash
node src/index.js list --config examples/config.schedule-profile.example.json
node src/index.js status --config examples/config.schedule-profile.example.json
node src/index.js run --job claude-0600 --config examples/config.schedule-profile.example.json
```

## 주요 명령 설명

`setup`

- 인터랙티브 설정 화면을 엽니다.
- 현재는 macOS LaunchAgent 설치를 수행합니다.
- `./setup.sh`가 내부적으로 이 명령을 호출합니다.

`list`

- 현재 config에서 생성되는 job 목록을 보여줍니다.
- 각 job의 provider, cron schedule, recurrence, 다음 실행 시간을 출력합니다.

`status`

- 각 job의 LaunchAgent plist 존재 여부를 확인합니다.
- 최근 JSONL 실행 로그가 있으면 마지막 실행 상태를 함께 보여줍니다.

`test --mode dry`

- 실제 provider를 호출하지 않습니다.
- `process.execPath`를 사용하는 fake job으로 plist 생성 흐름을 검증합니다.
- 실제 `~/Library/LaunchAgents`를 건드리지 않고 임시 디렉터리에서 실행됩니다.

`test --mode real`

- 현재 config의 prompt로 선택한 provider job을 즉시 실행합니다.
- 실제 CLI 호출이므로 provider 요청이 발생할 수 있습니다.

`doctor`

- workdir, logDir, stateDir 쓰기 가능 여부를 확인합니다.
- 설정된 provider CLI가 PATH에서 발견되는지 확인합니다.

`uninstall`

- `com.local.cli-heartbeat-scheduler.*` 패턴의 scheduler-owned LaunchAgent plist를 제거합니다.
- config 파일과 로그는 삭제하지 않습니다.

## Config 형식

인터랙티브 설정은 profile 중심 config를 저장합니다.

```json
{
  "timezone": "Asia/Seoul",
  "workdir": "~/.cli-heartbeat-scheduler/workdir",
  "logDir": "~/.cli-heartbeat-scheduler/logs",
  "stateDir": "~/.cli-heartbeat-scheduler/state",
  "defaultTimeoutMs": 60000,
  "maxOutputBytes": 20000,
  "scheduleProfile": {
    "agents": ["claude", "codex", "gemini"],
    "times": ["06:00", "11:00", "16:00"],
    "recurrence": {
      "type": "daily"
    },
    "prompt": "test! 출력"
  }
}
```

`jobs`는 config를 로드할 때 자동 생성됩니다. 예를 들어 위 설정은 아래와 같은 job id를 만듭니다.

```text
claude-0600
claude-1100
claude-1600
codex-0600
codex-1100
codex-1600
gemini-0600
gemini-1100
gemini-1600
```

명시적 `jobs` 배열도 계속 지원합니다. 예시는 [examples/config.example.json](./examples/config.example.json)을 참고하세요.

## Provider 명령

Claude Code:

```bash
claude -p --no-session-persistence --permission-mode dontAsk --tools "" --output-format text "test! 출력"
```

Codex:

```bash
codex --ask-for-approval never exec --ephemeral --skip-git-repo-check --sandbox read-only "test! 출력"
```

Gemini CLI:

```bash
gemini -p "test! 출력" --approval-mode plan --output-format text
```

기본 설정은 모두 짧은 출력 후 종료하는 흐름을 목표로 합니다.

## 로그와 상태 파일

실행 로그:

```text
~/.cli-heartbeat-scheduler/logs/runs-YYYY-MM-DD.jsonl
```

마지막 상태:

```text
~/.cli-heartbeat-scheduler/state/last-status.json
```

launchd stdout/stderr:

```text
~/.cli-heartbeat-scheduler/logs/<job-id>.launchd.out.log
~/.cli-heartbeat-scheduler/logs/<job-id>.launchd.err.log
```

## 절전 상태와 실행 조건

macOS LaunchAgent는 사용자의 GUI 세션과 컴퓨터가 깨어 있는 상태에서 실행됩니다. 컴퓨터가 절전 상태면 정해진 시각에 실행되지 않을 수 있습니다. `caffeinate`를 사용하면 절전 진입을 막을 수 있지만, 뚜껑이 닫힌 노트북이나 전원 정책에 따라 동작이 제한될 수 있습니다.

안정적으로 실행하려면:

- Mac이 깨어 있어야 합니다.
- 사용자의 GUI 세션이 유지되어야 합니다.
- 네트워크가 필요한 provider는 네트워크 연결이 있어야 합니다.
- provider CLI가 interactive login을 요구하지 않는 상태여야 합니다.

## Legacy 스크립트

초기 검증에 사용한 고정 시간 스크립트는 rollback 및 참고용 legacy로 남겨두었습니다.

```text
scripts/install-macos-once-5am.sh
scripts/install-macos-once-9am-test.sh
scripts/install-macos-once-910am-test.sh
scripts/install-windows-once-5am.ps1
config.5am-once.json
config.9am-test-once.json
config.910am-test-once.json
```

일반 사용은 `./setup.sh`를 권장합니다.

## Windows 사용법

Windows installer는 Task Scheduler를 사용합니다. 현재 사용자 권한으로 `CLI Heartbeat Scheduler <job-id>` 형식의 task를 등록합니다.

설정:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

dry 검증:

```powershell
node src\index.js test --mode dry --agents claude,codex
```

macOS나 CI에서 Windows task script 생성만 검증하려면:

```bash
node src/index.js test --mode dry --platform win32 --agents claude,codex
```

등록 상태 확인:

```powershell
node src\index.js status
Get-ScheduledTask | Where-Object {$_.TaskName -like "CLI Heartbeat Scheduler*"}
```

삭제:

```powershell
node src\index.js uninstall
```

실제 Windows Task Scheduler 등록/실행 검증은 Windows 10/11 환경에서 수행해야 합니다.

## 문제 해결

CLI가 없다고 나올 때:

```bash
node src/index.js doctor
```

각 CLI가 PATH에서 보이는지 확인합니다.

Codex가 stdin을 기다리며 멈출 때:

- 현재 runner는 child stdin을 `ignore`로 닫습니다.
- 오래된 runtime copy가 남아 있으면 `./setup.sh`를 다시 실행해 `~/.cli-heartbeat-scheduler/app`을 갱신하세요.

LaunchAgent는 있는데 실행되지 않을 때:

```bash
launchctl print gui/$(id -u)/com.local.cli-heartbeat-scheduler.<job-id>
```

그리고 아래 로그를 확인합니다.

```bash
ls -lt ~/.cli-heartbeat-scheduler/logs
```

설정을 완전히 다시 하고 싶을 때:

```bash
node src/index.js uninstall
./setup.sh
```

## 개발 검증

```bash
npm test
node src/index.js doctor --config examples/config.schedule-profile.example.json
node src/index.js list --config examples/config.schedule-profile.example.json --count 1
node src/index.js status --config examples/config.schedule-profile.example.json --launchctl false
node src/index.js test --mode dry --agents claude,codex
```
