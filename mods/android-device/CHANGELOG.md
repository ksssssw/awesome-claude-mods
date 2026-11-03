# Changelog

## 0.3.0

- A Spec block under Device, folded until `h`: the device's hardware the way CPU-Z lays it out, a row each for the SoC, CPU (cores, governor), clusters (cores of one frequency range, minimum to maximum clock), ABIs, GPU and OpenGL ES version, memory and swap, display (resolution, density, highest refresh rate), system (security patch, kernel, build type, bootloader), build fingerprint and battery (health, temperature, voltage, technology, charge cycles). Read once per device on first unfolding, in six adb calls side by side, and kept; `r` reads it again. Facts a device does not report are left out. Folded, it reads nothing.
- The Device block shows the One UI version on a Samsung device beside the Android version, read once per device.

## 0.2.1

- The desktop app, the editor and the phone draw each block as a rounded card, the buttons without hotkey badges, one main action per row (Launch, Screenshot, Install, Play) and the rest dimmed. The first row is the last notice on one line, with the home folder as `~`, beside Refresh; the pane's own title bar names it, so no second title. An item's path is text there, opened by Open and Folder. The terminal is unchanged.

## 0.2.0

- What Capture makes stays under it as items: Shot (the last screenshot), Video (the last recording) and APK (the last pull). Each shows its path, with the home folder as `~`; pressing the path opens the file in the system viewer (`open`, else `xdg-open`), the APK's in its folder. Each has a line of facts (size, length, package and version, splits, time) and its buttons: Open, Folder (shows the file in its folder) and Close (drops the item, the file stays).
- In a terminal that draws pictures (Ghostty, kitty, iTerm2 3.5 and later; inside tmux with `allow-passthrough` on) the screenshot and a poster frame of the recording are drawn beside their details, or under them when the pane is narrow, sized from the PNG's own width and height so a folded or an unfolded screen keeps its shape. Elsewhere the item is its path and buttons.
- `k` plays the recording in the pane at 10 frames a second, frames made by ffmpeg into the temporary folder; without ffmpeg it opens in the system player. The poster comes from ffmpeg, else macOS Quick Look (`qlmanage`).
- `o` opens the screenshot. The `screenshot` and `apk_pull` tools leave their items too.

## 0.1.0

- First version: an `/adb` pane with four blocks, drawn as a label column with glyph gauges in the terminal and as captioned cards with colored strips on the desktop, the editor and the phone. Device: the chosen device (picked by hand when several are connected), its Android version, screen state, and gauges of battery and storage. App: the repo's package as installed, with version name and code, update time and whether it runs, plus launch, force-stop, uninstall and clear data (the last two after a y/n question). Install: an APK dropped on the terminal, named with `/adb install` or picked from the repo's `build/outputs/apk` folders, installed with `adb install -r`; on failure the pane asks before adding `-d`, `-t` or an uninstall, and never retries by itself. Last: what the install put on the device, read back from it. Capture: screenshots, up to three minutes of screen recording, and the APK of the app in the foreground (base and splits), saved to `~/Downloads`. Eight tools (`device_list`, `apk_list`, `apk_install`, `package_info`, `app_launch`, `app_stop`, `screenshot`, `apk_pull`) for Claude while the pane is on, deferred while off. A downgrade `-d` cannot do (a release build, or `-d` already tried) asks for an uninstall and a fresh install instead.
