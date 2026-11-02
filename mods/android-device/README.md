# Android Device

English | [한국어](README.ko.md)

A pane beside the Claude Code transcript that shows the connected Android device and the state of the repo's app on it, installs an APK you drop on the terminal or pick from the build folder, and launches, stops, uninstalls, screenshots or records the app. `/adb` turns it on and off.

It costs **zero tokens while off**. While on, eight small tool definitions (`device_list`, `apk_list`, `apk_install`, `package_info`, `app_launch`, `app_stop`, `screenshot`, `apk_pull`) sit in the prompt's tool list so Claude can build, install and run the app for you; off again, they wait behind ToolSearch.

```
/plugin install android-device --marketplace ksssssw/awesome-claude-mods
```

## What it shows

In the terminal:

```
adb                                                            (r) Refresh
Device   Pixel 7 · Google · USB · device                         2 connected
         1A2B3C4D · Android 14 (API 34) · screen on
         Battery ██████████░░ 82%   Storage ████████░░░░ 21.3 GB free of 112 GB
         (d) Switch device
App      com.example.app.debug                                     installed
         v2.3.1 (2310) · updated 11-02 14:20 · running (pid 12345)
         (l) Launch  (s) Stop  (u) Uninstall  (c) Clear data
Install  app-debug.apk waiting
         app/build/outputs/apk/debug
         (i) Install  (a) Pick APK  (x) Cancel
Last     app-debug.apk
         com.example.app.debug
         v2.3.1 (2310) · 11-02 14:20 · 8.4s
Capture  (p) Screenshot  (v) Record  (e) Pull APK                → ~/Downloads

Shot     ▓▓▓▓▓▓▓▓  ~/Downloads/Pixel_7_20261102-142011.png
         ▓▓▓▓▓▓▓▓  1080×2400 · 11-02 14:20
         ▓▓▓▓▓▓▓▓  (o) Open  Folder  Close
```

The desktop app, the editor and the phone draw the same blocks as cards: a small caption heads each (`DEVICE`, `APP`, `INSTALL`), the first line is bold, the gauges are colored strips, and the buttons are buttons. Where the surface seats the pane (docked beside a fullscreen transcript, or inline above the prompt in a narrower terminal) is the surface's choice.

- **Device**: the chosen device (model, maker, USB or Wi-Fi, adb state), its serial, Android version and API level, whether the screen is on, then two gauges: battery (green, amber under 50%, red under 20%) and `/data` used, with the free space beside it. With several devices connected nothing is chosen until you press `d` and a digit; with one, it is chosen for you. A device that drops out is unchosen and the line says so.
- **App**: the repo's package as installed on the device: version name and code, when it was last updated, who installed it, whether it is disabled, whether it runs. `not installed` when it is not there.
- **Install**: the APK that waits, where it came from and the flags a retry added. While an install runs the row counts the seconds; when it fails, the reason and a question take the row (below).
- **Last**: the file the last install sent, the package it put on the device and its version, read back from the device itself, with when and how long it took.
- **Capture**: screenshots and recordings go to `~/Downloads` (or `outputDir`) as `<model>_<yyyyMMdd-HHmmss>.png` or `.mp4`. What Capture made stays under it as items, Shot, Video and APK: the path, pressed to open (an APK's opens its folder), a line of facts, and Open, Folder and Close. In a terminal that draws pictures (Ghostty, kitty, iTerm2 3.5 and later; inside tmux with `allow-passthrough` on) the screenshot and the recording's first frame are drawn beside them; `Play` plays the recording in the pane with ffmpeg (else in the system player). `Pull APK` copies the APK of the app in the foreground to the same folder as `<package>_<versionName>_<versionCode>.apk`; an app installed as splits comes as several files, `_split_config.en.apk` and the like after the base.
- **Status line**: `adb Pixel 7 · com.example.app.debug v2.3.1 (2310)`; `adb installing app-debug.apk…` and `adb recording 00:42` while those run.

## Installing an APK

Three ways to put an APK in the Install block; `i` then installs it on the chosen device with `adb install -r`:

1. **Drop the file on the terminal.** The terminal pastes its path into the prompt; press Enter. A prompt that is one `.apk` path and nothing else never reaches Claude: the mod takes it, empties the prompt box and the pane says the file is waiting. A prompt with any other words in it goes to Claude untouched, and nothing Claude runs itself (`adb` in a shell, the `apk_install` tool) passes through this check.
2. `/adb install <path>`, absolute or relative to the working directory.
3. `a` in the pane (or `/adb apk`) lists the APKs under the repo's `build/outputs/apk` folders, newest first; a digit picks one.

When the install fails the pane asks before it adds anything, so a wrong device or a wrong flag is never a surprise:

| adb says | The pane asks | `y` does |
| --- | --- | --- |
| `INSTALL_FAILED_VERSION_DOWNGRADE`, debug build | Retry with `-d` (allow a downgrade)? | `adb install -r -d` |
| `INSTALL_FAILED_VERSION_DOWNGRADE`, release build or `-d` already tried | Uninstall the app (its data is lost) and install again? A user-build device never downgrades a release build; a system app goes back to its factory copy. | `adb uninstall`, then `adb install -r` |
| `INSTALL_FAILED_TEST_ONLY` | Retry with `-t` (allow a test-only APK)? | `adb install -r -t` |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (other signing key) | Uninstall the app (its data is lost) and install again? | `adb uninstall`, then `adb install -r` |
| anything else (no space, device gone, unauthorized) | the reason — retry? | the same command again |

`n` closes the question and leaves the APK waiting. Nothing is retried on its own, and `-g` (grant all runtime permissions) is added only when the `grantPermissions` option is on.

After a success the Last row shows the package, `versionName` and `versionCode` as the device reports them. The package comes from `aapt dump badging` when the SDK's build-tools are installed, else from the repo's `applicationId`.

## Interaction

- `/adb` turns the pane on; `/adb` again, `/adb off` or closing the pane (Ctrl+X X) turns it off and stops polling.
- With the pane focused (Ctrl+X Tab): `r` refreshes, `d` then `1`–`9` picks a device, `l` launches the app, `s` force-stops it, `u` uninstalls and `c` clears its data (each after a `y`/`n` question), `i` installs the waiting APK, `a` lists the repo's APKs, `x` cancels, `p` takes a screenshot, `o` opens it, `k` plays or stops the last recording in the pane, `v` starts and stops a recording (three minutes at most, the `screenrecord` limit), `e` pulls the APK of the app in the foreground.
- `/adb select <serial|n>`, `/adb install <path>`, `/adb apk`, `/adb package <name>` (follow another package this session), `/adb launch`, `/adb stop`, `/adb uninstall`, `/adb clear`, `/adb screenshot`, `/adb record`, `/adb pull [<package>]`, `/adb refresh` do the same from the prompt. `uninstall` and `clear` still ask in the pane.
- Claude's tools while the pane is on: `device_list`, `apk_list`, `apk_install` (`path`, `allowDowngrade`, `allowTestOnly`), `package_info`, `app_launch`, `app_stop`, `screenshot`, `apk_pull` (`package`, default the app in the foreground). A failed `apk_install` tells Claude why and that `y` in the pane, or the call again with the flag, retries; it never retries by itself, and uninstall, clear data and recording are not tools.

## Which package is "mine"

1. `/adb package <name>` for this session, else the `package` option.
2. Else the `applicationId` of the first `build.gradle` or `build.gradle.kts` under the working directory (`app/` first, three levels deep, `build/` and the like skipped). A repo counts as Android when it has a `settings.gradle(.kts)` and a module that applies `com.android.application`.
3. That id is matched against the packages installed on the device: the id itself, else its first flavor (`com.example.app.debug`).

## Configuration

| Option | Values | Default |
| --- | --- | --- |
| `package` | A package name; empty for the repo's own | empty |
| `serial` | The device to choose when several are connected; empty to pick in the pane | empty |
| `outputDir` | Where screenshots and recordings are saved | `~/Downloads` |
| `grantPermissions` | `true` adds `-g` to every install | `false` |
| `rows` | Pane height above the prompt (narrow terminals) | `16` |
| `language` | `en` English, `ko` Korean | `en` |

Set them with `/plugin configure android-device@awesome-claude-mods`, or from a shell:

```bash
echo '{"language":"ko"}' | claude plugin configure android-device@awesome-claude-mods --values-stdin
```

Restart Claude Code to apply them.

## Behavior

- Nothing runs until `/adb`. On, the mod runs `adb` (from `PATH`, else `$ANDROID_HOME/platform-tools`): `adb devices -l` every two seconds, and the chosen device's `getprop`, `dumpsys battery`, `dumpsys power`, `df` and the app's `dumpsys package` every ten seconds and right after each action. Polling pauses while an install or a capture runs.
- Every value handed to adb is one argument, never a shell line; serials and package names from the prompt are checked first.
- A hot reload keeps the chosen device, the waiting APK and an open question; the pane comes back by itself. A recording that was running is stopped and pulled.
- Nothing leaves the machine: adb talks to the device alone.

## Known limitations

- The mobile app has no file drop and no prompt path paste; use `a` for the repo's APKs there.
- Without build-tools (`aapt`) the package of a dropped APK is taken from the repo, so an APK of another app shows under the repo's package until the App row refreshes.
- Recording stops at three minutes, `screenrecord`'s own limit. Devices without `pkill` are stopped through `pidof`.
- Lists in the pane show nine entries at most.

## Development

```bash
claude plugin validate mods/android-device --profile directory
claude plugin test mods/android-device        # 22 tests
claude --plugin-dir mods/android-device       # load this folder directly, reloading on save
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the release loop. Changes are listed in [CHANGELOG.md](CHANGELOG.md).
