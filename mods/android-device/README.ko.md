# Android Device

[English](README.md) | 한국어

Claude Code 대화 옆에 패널을 띄워, 연결된 안드로이드 단말과 그 단말에 설치된 레포 앱의 상태를 보여 줍니다. 하드웨어 스펙을 필요할 때 펼쳐 보고, 터미널에 끌어다 놓은 APK나 build 폴더에서 고른 APK를 설치하고, 앱을 실행·종료·삭제하고, 스크린샷과 화면 녹화를 저장합니다. `/adb`로 켜고 끕니다.

**꺼져 있는 동안 토큰을 쓰지 않습니다.** 켜 둔 동안에는 Claude가 빌드·설치·실행을 대신할 수 있도록 작은 도구 정의 여덟 개(`device_list`, `apk_list`, `apk_install`, `package_info`, `app_launch`, `app_stop`, `screenshot`, `apk_pull`)가 프롬프트의 도구 목록에 들어갑니다. 끄면 ToolSearch 뒤로 물러납니다.

```
/plugin install android-device --marketplace ksssssw/awesome-claude-mods
```

## 보여 주는 것

터미널에서:

```
adb                                                            (r) 새로 고침
단말     Pixel 7 · Google · USB · device                              2대 연결
         1A2B3C4D · Android 14 (API 34) · 화면 켜짐
         배터리 ██████████░░ 82%   저장공간 ████████░░░░ 112 GB 중 21.3 GB 여유
         (d) 단말 바꾸기
스펙     (h) 하드웨어 스펙 보기
앱       com.example.app.debug                                          설치됨
         v2.3.1 (2310) · 업데이트 11-02 14:20 · 실행 중 (pid 12345)
         (l) 실행  (s) 종료  (u) 삭제  (c) 데이터 초기화
설치     app-debug.apk 대기 중
         app/build/outputs/apk/debug
         (i) 설치  (a) APK 고르기  (x) 취소
최근     app-debug.apk
         com.example.app.debug
         v2.3.1 (2310) · 11-02 14:20 · 8.4s
캡처     (p) 스크린샷  (v) 녹화  (e) APK 추출                        → ~/Downloads

화면     ▓▓▓▓▓▓▓▓  ~/Downloads/Pixel_7_20261102-142011.png
         ▓▓▓▓▓▓▓▓  1080×2400 · 11-02 14:20
         ▓▓▓▓▓▓▓▓  (o) 열기  폴더  닫기
```

데스크탑 앱, 에디터, 휴대폰에서는 같은 블록을 카드처럼 그립니다. 작은 캡션(`DEVICE`, `APP`, `INSTALL`)이 블록을 이끌고, 첫 줄은 굵게, 게이지는 색 띠로, 버튼은 버튼으로 나옵니다. 단축키 배지는 없고, 줄마다 주요 동작 하나만 강조합니다. 패널이 어디에 놓일지(풀스크린 대화 옆 dock, 좁은 터미널에서는 프롬프트 위 inline)는 서피스가 정합니다.

- **단말**: 고른 단말(모델, 제조사, USB·Wi-Fi, adb 상태), 시리얼, Android 버전과 API 레벨, 삼성 단말이면 One UI 버전(단말마다 한 번 읽음), 화면 켜짐 여부, 그리고 게이지 둘: 배터리(초록, 50% 아래 주황, 20% 아래 빨강)와 `/data` 사용량(여유 공간을 옆에 표시). 단말이 여러 대면 `d`와 숫자로 고를 때까지 아무것도 선택하지 않고, 한 대면 자동으로 고릅니다. 빠진 단말은 선택이 풀리고 그 사실이 표시됩니다.
- **스펙**: `h`를 누르기 전까지 접혀 있고, 그동안은 아무것도 읽지 않습니다. 펼치면 CPU-Z처럼 단말의 하드웨어를 한 줄씩 보여 줍니다. SoC(Android 12 이상은 `ro.soc.manufacturer`·`ro.soc.model`, 없으면 board platform, 그것도 없으면 hardware), CPU(코어 수와 거버너), 클러스터(같은 클럭 범위의 코어 묶음과 최소·최대 클럭, 느린 순), ABI, GPU(렌더러와 OpenGL ES 버전), 메모리(전체·가용·스왑), 화면(물리 해상도, 밀도, 최고 주사율), 시스템(보안 패치, 커널, 빌드 타입, 부트로더), 빌드 fingerprint, 배터리(상태, 온도, 전압, 종류, 단말이 알려 주면 충전 횟수). 단말이 알려 주지 않는 값은 빼고, 값이 하나도 없는 줄도 뺍니다. 단말마다 처음 펼칠 때 한 번 읽어 두고, `r`을 누르면 다시 읽습니다. 새 세션은 접힌 상태로 시작하고, 핫 리로드 뒤에는 그대로 유지합니다.

  ```
  스펙     (h) 접기
           SoC         QTI SM8550 (kalama)
           CPU         8코어 · 거버너 walt
           클러스터    3 × 0.31–2.02 GHz · 4 × 0.50–2.80 GHz · 1 × 0.60–3.36 GHz
           ABI         arm64-v8a, armeabi-v7a, armeabi
           GPU         Qualcomm Adreno (TM) 740 · OpenGL ES 3.2
           메모리      전체 7.4 GB · 가용 3.0 GB · 스왑 4.0 GB (1.1 GB 사용)
           화면        1080×2340 · 450 dpi · 120 Hz
           시스템      보안 패치 2026-10-01 · 커널 5.15.123-android14 · user · 부트로더 S918NKSU3BWK1
           빌드        samsung/dm3qksx/dm3q:14/UP1A.231005.007/S918NKSU3BWK1:user/release-keys
           배터리      양호 · 28.5 °C · 4.12 V · Li-ion · 충전 312회
  ```

- **앱**: 단말에 설치된 레포의 패키지: 버전 이름·코드, 마지막 업데이트 시각, 설치 경로, 비활성 여부, 실행 여부. 없으면 `미설치`.
- **설치**: 대기 중인 APK, 출처, 재시도에 붙은 플래그. 설치 중에는 경과 초를 세고, 실패하면 그 자리에 이유와 질문이 뜹니다(아래).
- **최근**: 마지막 설치에 쓴 파일, 단말에 올라간 패키지와 버전(단말에서 다시 읽은 값), 설치 시각과 소요 시간을 세 줄로 보여 줍니다.
- **캡처**: 스크린샷과 녹화는 `~/Downloads`(또는 `outputDir`)에 `<모델>_<yyyyMMdd-HHmmss>.png`·`.mp4`로 저장됩니다. 캡처 결과는 버튼 아래에 화면·녹화·APK 항목으로 남습니다. 항목마다 경로(누르면 열림, APK는 폴더가 열림), 정보 한 줄, `열기`·`폴더`·`닫기` 버튼이 있습니다. 이미지를 그리는 터미널(Ghostty, kitty, iTerm2 3.5 이상, tmux 안에서는 `allow-passthrough`를 켠 경우)에서는 스크린샷과 녹화의 첫 프레임이 옆에 그려집니다. `재생`은 ffmpeg가 있으면 패널 안에서 녹화를 재생하고, 없으면 시스템 플레이어로 엽니다. `APK 추출`은 포그라운드 앱의 APK를 같은 폴더에 `<패키지>_<versionName>_<versionCode>.apk`로 복사합니다. split으로 설치된 앱은 base 뒤에 `_split_config.en.apk` 같은 파일이 여러 개 나옵니다.
- **상태 줄**: `adb Pixel 7 · com.example.app.debug v2.3.1 (2310)`. 설치 중엔 `adb app-debug.apk 설치 중…`, 녹화 중엔 `adb 녹화 중 00:42`.

## APK 설치

APK를 설치 블록에 올리는 방법은 세 가지이고, `i`를 누르면 고른 단말에 `adb install -r`로 설치합니다.

1. **터미널에 파일을 끌어다 놓기.** 터미널이 경로를 프롬프트에 붙여 넣으니 Enter를 칩니다. 프롬프트가 `.apk` 경로 하나뿐이면 Claude에게 가지 않고 mod가 가로채 입력창을 비우며, 패널에 대기 중이라고 표시됩니다. 다른 말이 한 단어라도 섞이면 그대로 Claude에게 가고, Claude가 직접 실행하는 것(셸의 `adb`, `apk_install` 도구)은 이 검사를 거치지 않습니다.
2. `/adb install <경로>`. 절대 경로나 작업 디렉터리 기준 상대 경로.
3. 패널에서 `a`(또는 `/adb apk`)를 누르면 레포의 `build/outputs/apk` 아래 APK를 최신순으로 보여 주고, 숫자로 고릅니다.

설치가 실패하면 패널이 먼저 묻고 나서 플래그를 붙입니다. 잘못된 단말이나 플래그가 조용히 적용되는 일이 없습니다.

| adb 응답 | 패널의 질문 | `y`를 누르면 |
| --- | --- | --- |
| `INSTALL_FAILED_VERSION_DOWNGRADE`, debug 빌드 | `-d`(다운그레이드 허용)를 붙여 다시 설치할까요? | `adb install -r -d` |
| `INSTALL_FAILED_VERSION_DOWNGRADE`, release 빌드 또는 `-d`로 이미 실패 | 앱을 삭제(데이터 사라짐)하고 다시 설치할까요? user 빌드 단말은 release 빌드를 다운그레이드하지 않으며, 시스템 앱은 공장 버전으로 돌아갑니다. | `adb uninstall` 후 `adb install -r` |
| `INSTALL_FAILED_TEST_ONLY` | `-t`(테스트 전용 APK 허용)를 붙여 다시 설치할까요? | `adb install -r -t` |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE`(서명 키 다름) | 앱을 삭제(데이터 사라짐)하고 다시 설치할까요? | `adb uninstall` 후 `adb install -r` |
| 그 외(저장 공간 부족, 단말 끊김, 미승인) | 이유 — 다시 시도할까요? | 같은 명령을 다시 |

`n`은 질문을 닫고 APK를 대기 상태로 둡니다. 스스로 재시도하는 일은 없고, `-g`(런타임 권한 전부 부여)는 `grantPermissions` 옵션을 켰을 때만 붙습니다.

성공하면 최근 줄에 단말이 보고하는 패키지, `versionName`, `versionCode`가 표시됩니다. 패키지는 SDK build-tools가 있으면 `aapt dump badging`으로, 없으면 레포의 `applicationId`로 정합니다.

## 조작

- `/adb`로 켜고, 다시 `/adb`, `/adb off`, 또는 패널 닫기(Ctrl+X X)로 끕니다. 끄면 폴링도 멈춥니다.
- 패널에 포커스를 주고(Ctrl+X Tab): `r` 새로 고침(스펙이 펼쳐져 있으면 하드웨어도), `h` 스펙 접기·펼치기, `d` 뒤 `1`~`9` 단말 선택, `l` 실행, `s` 강제 종료, `u` 삭제, `c` 데이터 초기화(둘 다 `y`/`n` 질문 뒤), `i` 대기 중 APK 설치, `a` 레포 APK 목록, `x` 취소, `p` 스크린샷, `o` 스크린샷 열기, `k` 녹화 재생·정지, `v` 녹화 시작·정지(최대 3분, `screenrecord`의 한계), `e` 포그라운드 앱의 APK 추출.
- `/adb select <serial|n>`, `/adb install <경로>`, `/adb apk`, `/adb package <이름>`(이번 세션 동안 다른 패키지), `/adb launch`, `/adb stop`, `/adb uninstall`, `/adb clear`, `/adb screenshot`, `/adb record`, `/adb pull [<패키지>]`, `/adb refresh`로 프롬프트에서도 같은 일을 합니다. `uninstall`과 `clear`는 패널에서 다시 묻습니다.
- 켜 둔 동안 Claude의 도구: `device_list`, `apk_list`, `apk_install`(`path`, `allowDowngrade`, `allowTestOnly`), `package_info`, `app_launch`, `app_stop`, `screenshot`, `apk_pull`(`package`, 기본은 포그라운드 앱). `apk_install`이 실패하면 이유와 함께 "패널에서 y를 누르거나 플래그를 넘겨 다시 부르면 재시도된다"고 알려 줍니다. 스스로 재시도하지 않으며, 삭제·데이터 초기화·녹화는 도구로 노출하지 않습니다.

## 어느 패키지가 "내 것"인가

1. 이번 세션의 `/adb package <이름>`, 없으면 `package` 옵션.
2. 없으면 작업 디렉터리 아래 첫 `build.gradle`·`build.gradle.kts`의 `applicationId`(`app/` 먼저, 세 단계 깊이, `build/` 등은 건너뜀). `settings.gradle(.kts)`가 있고 `com.android.application`을 적용한 모듈이 있으면 안드로이드 레포로 봅니다.
3. 그 id를 단말에 설치된 패키지와 맞춥니다. id 자체, 없으면 첫 flavor(`com.example.app.debug`).

## 설정

| 옵션 | 값 | 기본 |
| --- | --- | --- |
| `package` | 패키지 이름. 비우면 레포의 앱 | 비움 |
| `serial` | 여러 대일 때 고를 단말. 비우면 패널에서 선택 | 비움 |
| `outputDir` | 스크린샷·녹화 저장 폴더 | `~/Downloads` |
| `grantPermissions` | `true`면 모든 설치에 `-g` | `false` |
| `rows` | 프롬프트 위에 놓일 때의 패널 높이(좁은 터미널) | `16` |
| `language` | `en` 영어, `ko` 한국어 | `en` |

`/plugin configure android-device@awesome-claude-mods`로 바꾸거나, 셸에서:

```bash
echo '{"language":"ko"}' | claude plugin configure android-device@awesome-claude-mods --values-stdin
```

적용하려면 Claude Code를 다시 시작합니다.

## 동작

- `/adb` 전에는 아무것도 실행하지 않습니다. 켜면 `adb`(`PATH`, 없으면 `$ANDROID_HOME/platform-tools`)로 `adb devices -l`을 2초마다, 고른 단말의 `getprop`·`dumpsys battery`·`dumpsys power`·`df`와 앱의 `dumpsys package`를 10초마다, 그리고 각 동작 직후에 읽습니다. 스펙 블록이 읽는 것(prop 전체, `/sys`·`/proc`의 CPU·메모리 파일, `dumpsys battery`, `dumpsys SurfaceFlinger`, `dumpsys display`, `wm size`)은 아직 읽지 않은 단말에서 펼칠 때와 `r`을 누를 때만 실행합니다. 설치나 캡처 중에는 폴링을 멈춥니다.
- adb에 넘기는 값은 모두 인자 하나로 전달하고 셸을 거치지 않습니다. 프롬프트에서 받은 시리얼과 패키지 이름은 먼저 검사합니다.
- 핫 리로드 뒤에도 고른 단말, 대기 중 APK, 열린 질문이 유지되고 패널은 저절로 돌아옵니다. 진행 중이던 녹화는 멈추고 파일을 가져옵니다.
- 아무것도 밖으로 나가지 않습니다. adb는 단말과만 통신합니다.

## 알려진 한계

- 모바일 앱에는 파일 드롭도 경로 붙여넣기도 없으므로 거기서는 `a`로 레포의 APK만 고를 수 있습니다.
- build-tools(`aapt`)가 없으면 끌어다 놓은 APK의 패키지를 레포에서 추정하므로, 다른 앱의 APK는 앱 줄이 새로 고쳐질 때까지 레포 패키지로 표시됩니다.
- 녹화는 `screenrecord`의 한계인 3분에 멈춥니다. `pkill`이 없는 단말은 `pidof`로 멈춥니다.
- 패널의 목록은 최대 아홉 개까지 보여 줍니다.

## 개발

```bash
claude plugin validate mods/android-device --profile directory
claude plugin test mods/android-device        # 테스트 35개
claude --plugin-dir mods/android-device       # 이 폴더를 직접 로드, 저장할 때마다 다시 로드
```

릴리스 절차는 [CONTRIBUTING.md](../../CONTRIBUTING.md)에, 변경 내역은 [CHANGELOG.md](CHANGELOG.md)에 있습니다.
