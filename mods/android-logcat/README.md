# Android Logcat

English | [한국어](README.ko.md)

A pane beside the Claude Code transcript that follows the connected Android device's logcat for the app of the repo you are in, colored by level the way Android Studio does, with a level floor and a text filter. `/logcat` turns it on and off.

It costs **zero tokens while off**. While on, one tool definition (`logcat_read`, so Claude can read the log while debugging) sits in the prompt's tool list; off again, the tool waits behind ToolSearch.

```
/plugin install android-logcat --marketplace ksssssw/awesome-claude-mods
```

## What it shows

```
logcat com.example.app.debug  SM F966N · uid 10234  live
Level [D]  (p) Pause  (c) Clear  (u) Older  (d) Newer  (f) Follow
Filter [net                                                      ]
14:03:21.002  D/Net: GET /api/items
14:03:21.004  W/Net: slow response
14:03:21.005  E/Crash: java.lang.IllegalStateException
```

The three rows at the top stay put; only the lines under them scroll.

- **Header**: the package being followed (or `all processes`), the device model, the uid or pid the filter uses, and the state: `live`, `paused`, `starting`, `reconnecting`, `no device connected`, `<package> is not installed`, `adb not found`.
- **Level**: the lowest level shown: `All`, `D`, `I`, `W` or `E`. Default `D`.
- **Filter**: a case-insensitive substring of the tag or the message, applied as you type.
- **Lines**: `HH:MM:SS.mmm  L/Tag: message`, newest at the bottom, cut at the pane's edge. Colors follow Android Studio's Darcula scheme: `V` grey, `D` blue, `I` green, `W` yellow, `E` red, `F` red and bold. Warnings and above color the whole line; verbose, debug and info color only `L/Tag:`.
- **Status line**: `logcat <package> · E 3 W 12`, the errors and warnings since the capture started or was last cleared.

## Interaction

- `/logcat` turns the pane on; `/logcat` again, `/logcat off` or closing the pane (Ctrl+X X) turns it off and ends adb.
- `/logcat <package>` follows that package instead of the repo's app, for this session.
- `/logcat clear` empties the lines and the counts.
- With the pane focused (Ctrl+X Tab), `p` pauses the drawing (lines keep arriving) and `c` clears. Tab walks the level picker, the buttons and the filter.
- **Scrolling back**: the mouse wheel over the pane, PageUp/PageDown and Home/End while the pane is focused, or `u` (older page), `d` (newer page) and `f` (back to the newest). A click on the lines also gives them the arrow keys. While scrolled up the last row says how many newer lines wait below and the view holds still; `f` or End follows the newest again. The pane keeps the last 300 matching lines to scroll through.
- Claude can call `logcat_read` (`level`, `filter`, `lines`: up to 500 of the newest matching lines) while the pane is on. Ask it to look at the errors, or at a tag.

## Which package is "mine"

1. The `package` option, when set.
2. Else the `applicationId` of the first `build.gradle` or `build.gradle.kts` under the working directory (`app/` first, four levels deep, `build/` and the like skipped).
3. That id is matched against the packages installed on the device: the id itself, else its first flavor (`com.example.app.debug`). The header says `(1 of N)` when several match.
4. With no id at all, the pane shows every process.

The capture filters by the app's uid (`adb logcat --uid`), so it follows the app across restarts. Where the uid cannot be read, it follows the pid and checks it every two seconds.

## Configuration

| Option | Values | Default |
| --- | --- | --- |
| `package` | A package name; empty for the repo's own | empty |
| `serial` | A device serial from `adb devices`; empty for the first device | empty |
| `rows` | Pane height above the prompt (narrow terminals) | `20` |
| `bufferLines` | Lines kept for the pane and `logcat_read` | `2000` |
| `language` | `en` English, `ko` Korean | `en` |

Set them with `/plugin configure android-logcat@awesome-claude-mods`, or from a shell:

```bash
echo '{"language":"ko"}' | claude plugin configure android-logcat@awesome-claude-mods --values-stdin
```

Restart Claude Code to apply them.

## Behavior

- Nothing runs until `/logcat`. On, the mod runs `adb` (from `PATH`, else `$ANDROID_HOME/platform-tools`) to list devices and packages, then one `adb logcat -v threadtime -T 500` child that lives as long as the pane is on.
- No device, no adb or an app not yet installed is shown in the header and retried every five seconds. A device that drops out reconnects the same way.
- The pane keeps the newest `bufferLines` lines in memory and always shows the tail; the filter changes what is shown, never what is kept.
- A hot reload or a reconnect asks adb for the last 500 lines again.
- Nothing leaves the machine: adb talks to the device alone.

## Known limitations

- Scrolling back reaches the last 300 matching lines; older ones are only in `logcat_read` (up to `bufferLines`).
- One device at a time. With several connected and no `serial`, the first one wins.
- `--uid` filtering needs Android 8 or newer; older devices fall back to the pid.
- The mobile app draws no input fields, so the level and the filter are fixed there.

## Development

```bash
claude plugin validate mods/android-logcat --profile directory
claude plugin test mods/android-logcat        # 16 tests
claude --plugin-dir mods/android-logcat       # load this folder directly, reloading on save
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the release loop. Changes are listed in [CHANGELOG.md](CHANGELOG.md).
