# CLI Heartbeat Scheduler

`cli-heartbeat-scheduler`는 Claude Code, Codex, Gemini CLI에 짧은 로컬 CLI 프롬프트를 정해진 시간에 실행하는 Node.js 스케줄러입니다.

이 프로젝트는 API 자동화가 아닙니다. 이미 컴퓨터에 로그인되어 있는 CLI 세션을 사용해 `test! 출력` 같은 짧은 명령을 실행하고, 출력과 상태를 기록한 뒤 바로 종료합니다. 대화 세션을 이어가거나 긴 agent 작업을 돌리는 용도가 아닙니다.

## 핵심 특징

- Claude Code, Codex, Gemini CLI 지원
- KST 기준 여러 실행 시간 설정 가능: 예를 들어 `06:00,11:00,16:00`
- 실행 방식 선택 가능: one-shot, 매일 실행, 특정 요일 실행
- macOS LaunchAgent / Windows Task Scheduler 자동 등록
- 재설정 시 기존 scheduler-owned 등록 정리
- provider를 실제 호출하지 않는 dry probe 테스트 제공
- 실행 로그를 JSONL로 저장
- 관리자 권한 없이 현재 사용자 세션 기준으로 동작

## 공통 요구사항

- **Node.js 20 이상** (필수)
- 사용할 CLI는 미리 설치 및 로그인 필요
  - Claude Code CLI: `claude`
  - Codex CLI: `codex`
  - Gemini CLI: `gemini`

로그인은 이 스케줄러가 처리하지 않습니다. 각 CLI를 터미널에서 한 번 직접 실행해 로그인 상태를 만들어 둔 뒤 사용하세요.

플랫폼별 검증 상태:

- macOS: 검증 완료
- Windows 10/11 (PowerShell): 검증 완료

---

# macOS / Linux 사용법

## 빠른 시작 (macOS)

```bash
cd /path/to/cli-heartbeat-scheduler
npm install
npm test
./setup.sh
```

`./setup.sh`를 실행하면 다음 항목을 순서대로 묻습니다.

1. 설정할 AI agent (Claude Code / Codex / Gemini CLI)
2. 실행 시간 (KST `HH:MM`, 여러 개는 쉼표 구분: `06:00,11:00,16:00`)
3. 반복 방식 (one shot / 매일 / 특정 요일)
4. 설정 후 테스트 여부 (dry probe / 안 함 / 실제 provider smoke test)

설정 결과는 아래 위치에 저장됩니다.

```text
~/.cli-heartbeat-scheduler/config.json
~/.cli-heartbeat-scheduler/app           # launchd가 안전하게 실행할 runtime copy
```

## CLI 명령어 (macOS / Linux)

```bash
./setup.sh
node src/index.js list
node src/index.js status
node src/index.js test --mode dry --agents claude,codex
node src/index.js test --mode real --agents claude
node src/index.js uninstall
node src/index.js doctor
node src/index.js next --count 3
```

## 절전 상태와 실행 조건 (macOS)

macOS LaunchAgent는 사용자의 GUI 세션과 컴퓨터가 깨어 있는 상태에서 실행됩니다. 컴퓨터가 절전 상태면 정해진 시각에 실행되지 않을 수 있습니다.

안정적으로 실행하려면:

- Mac이 깨어 있어야 합니다.
- 사용자의 GUI 세션이 유지되어야 합니다.
- 네트워크가 필요한 provider는 네트워크 연결이 있어야 합니다.
- provider CLI가 interactive login을 요구하지 않는 상태여야 합니다.

## 문제 해결 (macOS)

CLI가 PATH에 보이는지 확인:

```bash
node src/index.js doctor
```

LaunchAgent는 있는데 실행되지 않을 때:

```bash
launchctl print gui/$(id -u)/com.local.cli-heartbeat-scheduler.<job-id>
ls -lt ~/.cli-heartbeat-scheduler/logs
```

설정을 완전히 다시 하고 싶을 때:

```bash
node src/index.js uninstall
./setup.sh
```

---

# Windows 사용법

Windows installer는 Task Scheduler를 사용합니다. 현재 사용자 권한으로 `CLI Heartbeat Scheduler <job-id>` 형식의 task를 등록합니다.

## Windows 사전 준비

1. **Node.js 20 이상 설치** — [nodejs.org](https://nodejs.org/)에서 LTS 설치 후 PowerShell을 새로 열어 `node -v`로 확인.
2. **PATH 환경변수 확인** — Task Scheduler가 task 실행 시 일반 PowerShell 세션과 다른 환경을 가질 수 있으므로, `node`와 사용할 CLI(`claude`, `codex`, `gemini`)가 시스템 PATH에 등록되어 있는지 반드시 확인하세요.
   - 시스템 속성 → 환경 변수 → 시스템 변수 `Path`에 Node.js 설치 경로(예: `C:\Program Files\nodejs\`)와 각 CLI 설치 경로 포함.
   - 사용자 변수가 아닌 **시스템 변수**에 두는 편이 Task Scheduler 환경에서 안정적입니다.
3. **PowerShell 실행 정책** — 아래 명령은 `-ExecutionPolicy Bypass`로 실행하므로 별도 정책 변경은 필요 없습니다.

## 빠른 시작 (Windows)

```powershell
cd C:\path\to\cli-heartbeat-scheduler
npm install
npm test
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

setup이 묻는 항목은 macOS와 동일합니다 (agent / 실행 시간 / 반복 방식 / 테스트 여부).

설정 결과는 아래 위치에 저장됩니다.

```text
%USERPROFILE%\.cli-heartbeat-scheduler\config.json
%USERPROFILE%\.cli-heartbeat-scheduler\app
```

## CLI 명령어 (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
node src\index.js list
node src\index.js status
node src\index.js test --mode dry --agents claude,codex
node src\index.js uninstall
```

등록된 task 직접 확인:

```powershell
Get-ScheduledTask | Where-Object {$_.TaskName -like "CLI Heartbeat Scheduler*"}
```

## Windows에서 알려진 동작

- **RunLevel은 `Limited`**로 등록됩니다. (관리자 권한 없이 현재 사용자 세션에서 실행) 일부 환경에서는 task XML을 직접 편집해 RunLevel을 조정해야 할 수 있는데, 본 스케줄러는 기본값으로 `-RunLevel Limited`를 사용합니다.
- Task Scheduler는 사용자 로그온 상태에서 실행됩니다. 로그아웃 또는 잠금 상태에서의 동작은 task 속성의 "Run whether user is logged on or not"을 직접 변경해야 합니다 (관리자 권한 필요).
- 컴퓨터가 절전/최대 절전 상태면 정해진 시각에 실행되지 않을 수 있습니다.

## 문제 해결 (Windows)

CLI가 PATH에 보이는지 확인:

```powershell
node src\index.js doctor
```

Task가 실행되지 않을 때:

```powershell
Get-ScheduledTask -TaskName "CLI Heartbeat Scheduler <job-id>" | Get-ScheduledTaskInfo
Get-Content "$env:USERPROFILE\.cli-heartbeat-scheduler\logs\<job-id>.task.out.log"
```

설정을 완전히 다시 하고 싶을 때:

```powershell
node src\index.js uninstall
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

---

# 공통 참조

## 설정 변경

설정 시간이나 agent를 바꿀 때도 같은 명령(`./setup.sh` 또는 `setup.ps1`)을 다시 실행합니다. 기존 config를 기본값으로 보여주고, 새 선택값으로 다시 생성합니다. 현재 설정에 없는 stale 등록은 자동 제거됩니다.

## 주요 명령 설명

- `setup` — 인터랙티브 설정 화면. `setup.sh` / `setup.ps1`이 내부적으로 호출.
- `list` — 현재 config의 job 목록 (provider, schedule, recurrence, 다음 실행 시간).
- `status` — LaunchAgent / ScheduledTask 등록 상태와 마지막 실행 결과.
- `test --mode dry` — provider를 실제 호출하지 않고 plist/task 생성 흐름만 검증.
- `test --mode real` — 실제 provider CLI를 즉시 호출 (요청이 발생할 수 있음).
- `doctor` — workdir/logDir/stateDir 쓰기 권한, provider CLI의 PATH 인식 여부 확인.
- `uninstall` — `com.local.cli-heartbeat-scheduler.*` / `CLI Heartbeat Scheduler *` 등록만 제거 (config/log는 유지).

## Provider 호출 명령

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

## 로그와 상태 파일

실행 로그:

```text
~/.cli-heartbeat-scheduler/logs/runs-YYYY-MM-DD.jsonl
```

마지막 상태:

```text
~/.cli-heartbeat-scheduler/state/last-status.json
```

플랫폼별 stdout/stderr:

```text
# macOS
~/.cli-heartbeat-scheduler/logs/<job-id>.launchd.out.log
~/.cli-heartbeat-scheduler/logs/<job-id>.launchd.err.log

# Windows
%USERPROFILE%\.cli-heartbeat-scheduler\logs\<job-id>.task.out.log
%USERPROFILE%\.cli-heartbeat-scheduler\logs\<job-id>.task.err.log
```

## 개발 검증

```bash
npm test
node src/index.js doctor --config examples/config.schedule-profile.example.json
node src/index.js list --config examples/config.schedule-profile.example.json --count 1
node src/index.js test --mode dry --agents claude,codex
```

macOS에서 Windows task script 생성만 검증:

```bash
node src/index.js test --mode dry --platform win32 --agents claude,codex
```
