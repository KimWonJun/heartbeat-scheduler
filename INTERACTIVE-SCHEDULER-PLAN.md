# 인터랙티브 스케줄러 구현 계획 및 완료 상태

## 목표

`./setup.sh` 하나로 Claude Code, Codex, Antigravity CLI heartbeat 스케줄을 설정하고 변경할 수 있게 만드는 것이 목표입니다.

사용자는 다음 항목을 선택합니다.

1. 실행할 AI agent
   - Claude Code
   - Codex
   - Antigravity CLI
2. 실행 시간
   - KST 기준 `HH:MM`
   - 여러 시간 입력 가능: `06:00,11:00,16:00`
3. 반복 방식
   - one shot
   - 매일 실행
   - 특정 요일 실행
4. 설정 후 테스트
   - 테스트 안 함
   - dry launchd probe
   - 실제 provider smoke test

이 프로젝트의 범위는 local desktop-authenticated CLI 실행입니다. API 기반 자동화나 대화 세션 resume은 범위에 포함하지 않습니다.

## 최종 사용자 흐름

```bash
./setup.sh
```

설정 후 확인:

```bash
node src/index.js list
node src/index.js status
node src/index.js test --mode dry --agents claude,codex
```

스케줄 변경:

```bash
./setup.sh
```

삭제:

```bash
node src/index.js uninstall
```

## 구현된 config 모델

active config:

```text
~/.cli-heartbeat-scheduler/config.json
```

runtime copy:

```text
~/.cli-heartbeat-scheduler/app
```

저장되는 config는 profile 중심입니다.

```json
{
  "timezone": "Asia/Seoul",
  "workdir": "~/.cli-heartbeat-scheduler/workdir",
  "logDir": "~/.cli-heartbeat-scheduler/logs",
  "stateDir": "~/.cli-heartbeat-scheduler/state",
  "defaultTimeoutMs": 60000,
  "maxOutputBytes": 20000,
  "scheduleProfile": {
    "agents": ["claude", "codex", "antigravity"],
    "times": ["06:00", "11:00", "16:00"],
    "recurrence": {
      "type": "daily"
    },
    "prompt": "test! 출력"
  }
}
```

`jobs`는 config load 시점에 생성됩니다. active config에는 generated jobs를 저장하지 않아 재설정 시 중복 job이 생기지 않습니다.

## Provider command contract

Claude Code:

```text
claude -p --no-session-persistence --permission-mode dontAsk --tools "" --output-format text <prompt>
```

Codex:

```text
codex --ask-for-approval never exec --ephemeral --skip-git-repo-check --sandbox read-only <prompt>
```

Antigravity CLI:

```text
agy --sandbox --print <prompt>
```

## macOS LaunchAgent 모델

각 job마다 plist를 하나 생성합니다.

```text
~/Library/LaunchAgents/com.local.cli-heartbeat-scheduler.<job-id>.plist
```

wrapper:

```text
~/.cli-heartbeat-scheduler/app/scripts/run-macos.sh
```

wrapper mode:

- `once`: 실행 후 plist 삭제 및 bootout
- `persistent`: 실행 후 plist 유지

LaunchAgent는 Desktop checkout을 직접 실행하지 않습니다. macOS launchd permission 문제를 피하기 위해 `~/.cli-heartbeat-scheduler/app`으로 복사된 runtime을 사용합니다.

## Phase 1: Data Model and Schedule Expansion

상태: 완료

주요 파일:

- `src/schedule-profile.js`
- `src/time.js`
- `test/schedule-profile.test.js`
- `test/time.test.js`
- `examples/config.schedule-profile.example.json`

완료 내용:

- agent selection 검증
- KST `HH:MM` 시간 parser
- `06:00,11:00,16:00` 같은 multi-time 입력 처리
- one-shot/daily/weekdays recurrence 모델
- `scheduleProfile`을 기존 `jobs` contract로 확장
- 기존 explicit jobs config와의 호환성 유지

## Phase 2: Antigravity Provider

상태: 완료

주요 파일:

- `src/providers/antigravity.js`
- `src/providers/index.js`
- `src/doctor.js`
- `test/providers.test.js`

완료 내용:

- `antigravity` provider 추가
- `agy --help` 기준 headless command check
- headless command 생성
- Claude/Codex/Antigravity provider routing 테스트

## Phase 3: Generic macOS Installer

상태: 완료

주요 파일:

- `src/platform/macos-launch-agent.js`
- `scripts/run-macos.sh`
- `test/macos-launch-agent.test.js`

완료 내용:

- job별 LaunchAgent plist 생성
- one-shot/daily/weekdays plist 생성
- runtime copy
- stale scheduler-owned LaunchAgent 제거
- launchd PATH 보정
- one-shot cleanup 순서 보존

## Phase 4: Interactive Setup

상태: 완료

주요 파일:

- `setup.sh`
- `src/setup.js`
- `src/setup-core.js`
- `src/index.js`
- `test/setup-core.test.js`

완료 내용:

- `@inquirer/prompts` 기반 checkbox/select/input UX
- 기존 active config를 기본값으로 load
- agent, times, recurrence, weekdays, prompt 입력
- active config 저장
- runtime copy 갱신
- macOS LaunchAgent 설치
- setup 후 테스트 모드 선택

## Phase 5: Status, List, and Test Commands

상태: 완료

주요 파일:

- `src/status.js`
- `src/test-runner.js`
- `src/index.js`
- `test/status.test.js`
- `test/test-runner.test.js`

완료 내용:

- `list`: 생성 job과 다음 실행 시간 출력
- `status`: plist 등록 여부와 최근 로그 출력
- `test --mode dry`: 실제 provider 호출 없이 임시 LaunchAgents 디렉터리에서 plist 생성 검증
- `test --mode real`: 선택 provider 즉시 smoke 실행
- `uninstall`: scheduler-owned LaunchAgent 제거

## Phase 6: Documentation and Repository Cleanup

상태: 완료

주요 파일:

- `README.md`
- `DESIGN.md`
- `INTERACTIVE-SCHEDULER-PLAN.md`
- `.gitignore`

완료 내용:

- 전체 문서를 한국어로 재작성
- `./setup.sh` 중심 사용법 정리
- command별 상세 사용법 작성
- config, log, LaunchAgent 위치 설명
- sleep/절전 조건 설명
- legacy fixed-time script를 legacy로 명시
- repo publish를 위한 `.gitignore` 추가

## 검증 명령

자동 테스트:

```bash
npm test
```

CLI 확인:

```bash
node src/index.js --help
node src/index.js doctor --config examples/config.schedule-profile.example.json
node src/index.js list --config examples/config.schedule-profile.example.json --count 1
node src/index.js status --config examples/config.schedule-profile.example.json --launchctl false
node src/index.js test --mode dry --agents claude,codex
```

현재 자동 테스트는 실제 provider 요청을 소비하지 않습니다. 실제 provider smoke call은 명시적으로 `test --mode real`을 실행할 때만 발생합니다.

## 남은 후속 과제

- Windows Task Scheduler profile installer 추가
- `status`에서 launchctl 상세 상태 요약 강화
- one-shot 시간이 이미 지난 경우 UI에서 다음 실행일 안내 강화
- legacy fixed-time scripts 제거 여부 결정
