# Android Logcat

[English](README.md) | 한국어

Claude Code 대화 옆에 패널을 띄워, 연결된 안드로이드 단말의 logcat을 지금 작업 중인 레포의 앱 기준으로 따라갑니다. Android Studio처럼 레벨별로 색을 입히고, 최소 레벨과 텍스트 필터를 제공합니다. `/logcat`으로 켜고 끕니다.

**꺼져 있는 동안 토큰을 쓰지 않습니다.** 켜 둔 동안에는 Claude가 디버깅 때 로그를 읽을 수 있도록 도구 정의 하나(`logcat_read`)가 프롬프트의 도구 목록에 들어갑니다. 끄면 ToolSearch 뒤로 물러납니다.

```
/plugin install android-logcat --marketplace ksssssw/awesome-claude-mods
```

## 보여 주는 것

```
logcat com.example.app.debug  SM F966N · uid 10234  실시간
레벨 [D]  (p) 일시정지  (c) 비우기  (u) 이전  (d) 이후  (f) 따라가기
필터 [net                                                        ]
14:03:21.002  D/Net: GET /api/items
14:03:21.004  W/Net: slow response
14:03:21.005  E/Crash: java.lang.IllegalStateException
```

위 세 줄은 고정이고, 그 아래 로그 줄만 스크롤됩니다.

- **헤더**: 따라가는 패키지(또는 `전체 프로세스`), 단말 모델명, 필터에 쓰는 uid나 pid, 상태(`실시간`, `일시정지`, `시작 중`, `다시 연결 중`, `연결된 단말이 없습니다`, `<패키지>이(가) 단말에 없습니다`, `adb를 찾을 수 없습니다`).
- **레벨**: 보여 줄 최소 레벨. `All`, `D`, `I`, `W`, `E`. 기본 `D`.
- **필터**: 태그나 메시지에 대소문자 구분 없이 부분 일치. 타이핑하는 즉시 적용됩니다.
- **줄**: `HH:MM:SS.mmm  L/Tag: message`. 최신이 아래, 패널 너비에서 잘립니다. 색은 Android Studio Darcula 스킴을 따릅니다. `V` 회색, `D` 파랑, `I` 초록, `W` 노랑, `E` 빨강, `F` 빨강 굵게. W 이상은 줄 전체를, V·D·I는 `L/Tag:`만 칠합니다.
- **상태 줄**: `logcat <패키지> · E 3 W 12`. 켠 뒤(또는 마지막 비우기 뒤) 누적된 에러·경고 수입니다.

## 조작

- `/logcat`으로 켜고, 다시 `/logcat`, `/logcat off`, 또는 패널 닫기(Ctrl+X X)로 끕니다. 끄면 adb도 끝납니다.
- `/logcat <패키지>`는 이번 세션 동안 레포의 앱 대신 그 패키지를 따라갑니다.
- `/logcat clear`는 줄과 카운트를 비웁니다.
- 패널에 포커스를 주고(Ctrl+X Tab) `p`를 누르면 화면을 멈추고(수집은 계속), `c`를 누르면 비웁니다. Tab으로 레벨 선택, 버튼, 필터를 오갑니다.
- **거슬러 올라가기**: 패널 위에서 마우스 휠, 패널 포커스 상태에서 PageUp/PageDown과 Home/End, 또는 `u`(이전 페이지), `d`(이후 페이지), `f`(최신으로). 로그 줄을 클릭하면 방향키도 됩니다. 올라가 있는 동안은 맨 아랫줄에 아래에 몇 줄이 더 있는지 표시되고 화면이 밀리지 않습니다. `f`나 End로 다시 최신을 따라갑니다. 스크롤 범위는 최근 300줄입니다.
- 켜 둔 동안 Claude는 `logcat_read`(`level`, `filter`, `lines`: 최신 줄 최대 500개)를 부를 수 있습니다. "에러 로그 봐줘"처럼 부탁하면 됩니다.

## 어느 패키지가 "내 앱"인가

1. `package` 옵션이 있으면 그 값.
2. 없으면 작업 폴더 아래 첫 `build.gradle` 또는 `build.gradle.kts`의 `applicationId`(`app/`을 먼저, 4단계 깊이까지, `build/` 등은 건너뜀).
3. 그 id를 단말에 설치된 패키지와 맞춥니다. id 자체가 있으면 그것, 없으면 첫 flavor(`com.example.app.debug`). 여러 개면 헤더에 `(N개 중 1개)`로 표시합니다.
4. id를 전혀 못 찾으면 전체 프로세스를 보여 줍니다.

수집은 앱의 uid로 필터링하므로(`adb logcat --uid`) 앱을 재시작해도 이어집니다. uid를 못 읽으면 pid를 쓰고 2초마다 다시 확인합니다.

## 설정

| 옵션 | 값 | 기본값 |
| --- | --- | --- |
| `package` | 패키지 이름. 비우면 레포의 앱 | 빈 값 |
| `serial` | `adb devices`의 시리얼. 비우면 첫 단말 | 빈 값 |
| `rows` | 프롬프트 위에 붙을 때(좁은 터미널)의 패널 높이 | `20` |
| `bufferLines` | 패널과 `logcat_read`가 보관하는 줄 수 | `2000` |
| `language` | `en` 영어, `ko` 한국어 | `en` |

Claude Code 안에서 `/plugin configure android-logcat@awesome-claude-mods`로 바꾸거나, 셸에서:

```bash
echo '{"language":"ko"}' | claude plugin configure android-logcat@awesome-claude-mods --values-stdin
```

적용하려면 Claude Code를 다시 시작합니다.

## 동작 규칙

- `/logcat` 전에는 아무것도 실행하지 않습니다. 켜면 `adb`(`PATH`, 없으면 `$ANDROID_HOME/platform-tools`)로 단말과 패키지를 조회하고, 패널이 켜져 있는 동안 `adb logcat -v threadtime -T 500` 자식 프로세스 하나를 유지합니다.
- 단말이 없거나, adb가 없거나, 앱이 아직 설치되지 않았으면 헤더에 표시하고 5초마다 다시 시도합니다. 단말이 빠져도 같은 방식으로 다시 붙습니다.
- 최신 `bufferLines`줄만 메모리에 두고 항상 꼬리를 보여 줍니다. 필터는 보이는 것만 바꾸고 보관분은 건드리지 않습니다.
- 핫 리로드나 재연결 때는 adb에 마지막 500줄을 다시 요청합니다.
- 데이터를 밖으로 보내지 않습니다. adb는 단말하고만 통신합니다.

## 알려진 제약

- 스크롤은 최근 300줄까지입니다. 그보다 오래된 줄은 `logcat_read`로만 볼 수 있습니다(`bufferLines`까지).
- 한 번에 단말 하나. 여러 개가 연결되고 `serial`이 비어 있으면 첫 단말을 씁니다.
- `--uid` 필터는 Android 8 이상에서 동작합니다. 그 아래는 pid로 대체합니다.
- 데스크탑 앱에서는 로그 줄을 고정폭 글꼴로 그리고 레벨을 색 배지로 보여 주며, 버튼에 단축키 배지를 붙이지 않습니다.
- 모바일 앱은 입력 필드를 그리지 않아 레벨과 필터가 고정됩니다.

## 개발

```bash
claude plugin validate mods/android-logcat --profile directory
claude plugin test mods/android-logcat        # 테스트 21개
claude --plugin-dir mods/android-logcat       # 이 폴더를 바로 로드, 저장하면 다시 로드
```

릴리스 절차는 [CONTRIBUTING.ko.md](../../CONTRIBUTING.ko.md)를 보세요. 변경 내역은 [CHANGELOG.md](CHANGELOG.md)에 있습니다.
