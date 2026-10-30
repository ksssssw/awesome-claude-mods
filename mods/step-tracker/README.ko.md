# Step Tracker

[English](README.md) | 한국어

Claude Code 프롬프트 바로 위에 테두리 상자(band)를 띄워 Claude가 하는 일을 보여 주는 mod입니다. 계획한 단계, 지금 하는 일, 방금 끝낸 호출, 실시간 활동 그래프, 백그라운드 에이전트와 셸, 현재 브랜치를 한곳에서 볼 수 있습니다.

모델을 호출하지 않고 Claude가 읽는 내용도 바꾸지 않으므로 **토큰을 쓰지 않습니다**.

```
/plugin install step-tracker --marketplace ksssssw/awesome-claude-mods
```

## 보여 주는 것

단계 목록이 있을 때(Claude가 `TodoWrite`나 `TaskCreate`로 할 일을 등록했을 때):

```
╭─ STEPS 3/5 ─ my-app feat/search-filter*↑2 ─────────────────── 06:12 · ctx 41% ─╮
│ ✓ Read the search API                         ███▌                             │
│ ✓ Add the filter state                            ██████▊                      │
│ ⠹ Wire the filter into the results page  02:14          ███████████▊           │
│   ├ ✓ Read SearchPage.tsx            0.1s                                      │
│   └ ⠹ Bash run the unit tests                                                  │
│ ○ Handle the empty state                      ·  ·  ·  ·  ·  ·  ·  ·           │
├────────────────────────────────────────────────────────────────────────────────┤
│ ⠹ run the unit tests 실행 중                                             00:04 │
│   이번 턴  읽기 6 · 수정 3 · 명령 2 ─ SearchPage.tsx, filters.ts               │
│   ◆ explore · feat/search-filter  find filter usages ─ Grep useFilter (12) 01:05│
╰────────────────────────────────────────────────────────────────────────────────╯
```

단계 목록이 없을 때는 방금 끝난 호출이 아래에서부터 쌓이며 위로 갈수록 흐려집니다. 오른쪽에는 2초 단위 호출량 그래프가 있고, 그 아래에서 작은 Claude 캐릭터가 작업하는 동안 걸어 다닙니다.

```
╭─ STEPS ─ my-app main ─────────────────────────────────────── 00:48 · ctx 12% ─╮
│ ✓ Read package.json            0.1s                          █                  │
│ ✓ Bash list the routes         0.4s                        █ █   █              │
│ ✗ Bash run the linter          2.0s                      ███ █   █              │
│ ✓ Edit SearchPage.tsx          0.2s  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁███▁█▁▁██▁            │
│                                                 ·∙                              │
│                                              ▐▛███▜▌                            │
│                                             ▝▜█████▛▘                           │
│                                               ▝▘ ▘▝                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ⠹ SearchPage.tsx 수정 중                                                  00:02 │
│   이번 턴  읽기 1 · 수정 1 · 명령 2 ─ SearchPage.tsx                             │
│   $ start the dev server ─ npm run dev                                    03:10 │
╰─────────────────────────────────────────────────────────────────────────────────╯
```

- **헤더(위쪽 테두리 안)**: 단계 진행 수, 저장소, 브랜치(워크트리 안이면 `wt:`), 변경 표시 `*`, 원격보다 앞선 커밋 수 `↑n`, 경과 시간, 컨텍스트 사용률.
- **단계**: `✓` 완료, 진행 중인 단계는 스피너와 경과 시간(턴이 끝나면 `▸`), `○` 남은 단계. 진행 중 단계 아래에 최근 호출 3개가 붙습니다.
- **타임라인**(단계 목록이 있고 폭 92칸 이상): 단계마다 막대 하나를 그리고, 진행 중인 막대는 실시간으로 자랍니다.
- **최근 호출**(단계 목록이 없을 때): 최신 호출이 맨 아래에 오고, 이전 호출은 위로 올라가며 흐려집니다. 방금 끝난 호출은 잠깐 초록색으로 밝게 보이고, 실패한 호출은 빨간 `✗`입니다.
- **활동 그래프**(단계 목록이 없고 폭 92칸 이상): 2초 단위 호출량입니다. 막대 색은 그 구간에서 가장 많이 부른 종류입니다(읽기 파랑, 수정 주황, 명령 초록, 검색 보라, 스킬 노랑). 그 아래 Claude 캐릭터는 작업 중이면 걸어 다니고, 모델이 생각하는 동안 머리 위에 `·∙•`를 띄우고, 쉴 때는 서서 눈을 깜빡입니다.
- **지금 하는 일 줄**: 지금 무엇을 하는지 문장으로 보여 주고, 빛이 그 위를 지나갑니다. 응답 기다리는 중, 생각하는 중, 답변 쓰는 중, 변경 내용 작성 중, `<파일> 읽는/수정 중`, `<명령> 실행 중` 같은 문장입니다. plan 모드에서는 계획 수립 표현으로 바뀌고 테두리가 청록색이 됩니다.
- **이번 턴**: 종류별 호출 수와 수정한 파일.
- **백그라운드 작업**: 실행 중인 서브에이전트(`◆`)마다 맡은 작업, 지금 하는 호출, 호출 수를 보여 줍니다. `run_in_background`로 띄우거나 Ctrl+B로 보낸 셸 명령(`$`)도 보여 줍니다. 이 중 하나라도 돌고 있으면 턴이 끝나도 band가 유지됩니다.

## 조작

- 최근 호출, 호출 수(`명령 6`), 에이전트 줄, 셸 줄은 버튼입니다. 누르면 목록 자리에 상세 내용이 펼쳐집니다.
  - 전체 명령이나 경로, 검색 패턴과 위치, 스킬 인자
  - 에이전트의 최근 호출 20개
  - 셸의 명령과 작업 ID
  - `‹ 닫기`를 누르거나 같은 항목을 다시 누르면 닫힙니다.
- 마우스 클릭은 fullscreen 화면(`"tui": "fullscreen"`)에서 됩니다. 키보드로는 Ctrl+X Tab으로 band에 포커스를 준 뒤 항목에서 Enter를 누릅니다.
- `/steps`로 band를 강제로 켜고 끕니다.

## 설정

| 옵션 | 값 | 기본값 |
| --- | --- | --- |
| `language` | `en` 영어, `ko` 한국어 | `en` |

화면 문구는 기본이 영어입니다. 한국어로 보려면 Claude Code에서 `/plugin configure step-tracker@awesome-claude-mods`로 바꾸거나, 셸에서 다음을 실행합니다.

```bash
echo '{"language":"ko"}' | claude plugin configure step-tracker@awesome-claude-mods --values-stdin
```

바꾼 뒤 Claude Code를 재시작하면 적용됩니다. 아래 예시 화면은 `ko`로 설정했을 때의 모습입니다.

## 동작 규칙

- band 높이는 12줄로 고정입니다(화면이 작으면 더 작게). 에이전트나 셸이 생기면 목록 영역이 줄어들어 전체 높이는 변하지 않습니다.
- 스크롤하지 않습니다. 단계 목록은 진행 중 단계를 따라가고, 최근 호출은 최신 것만 남깁니다.
- 브랜치 정보는 턴 시작과 끝, `Bash`·`EnterWorktree`·`ExitWorktree` 직후에만 다시 읽습니다.
- 모델의 현재 상태는 응답 스트림의 청크 종류(thinking, text, tool)로 판단합니다. 청크는 바꾸지 않고 그대로 넘깁니다.
- `/clear`와 `/resume` 때 목록이 비워집니다.
- 터미널이 주 대상입니다. Desktop 앱에서는 그래프 없이 목록만 보여 줍니다.

## 알려진 제약

- plan 모드는 다른 플러그인이 가로챌 수 있는 이벤트로 판단합니다. 설치된 플러그인 중 그 이벤트를 넘기지 않는 것이 있으면 `EnterPlanMode`·`ExitPlanMode` 호출로만 plan 모드를 알아챕니다.
- 백그라운드 셸 줄은 완료 알림이 와야 사라집니다. 알림이 세션에 오지 않으면 `/clear` 전까지 남습니다.
- 상자 문자와 블록 문자가 한 칸 폭인 글꼴을 기준으로 합니다.

## 개발

```bash
claude plugin validate mods/step-tracker --profile directory
claude plugin test mods/step-tracker        # 테스트 27개
claude --plugin-dir mods/step-tracker       # 이 폴더를 직접 로드, 저장하면 다시 로드
```

릴리스 절차는 [CONTRIBUTING.ko.md](../../CONTRIBUTING.ko.md)를, 변경 내역은 [CHANGELOG.md](CHANGELOG.md)를 보세요.
