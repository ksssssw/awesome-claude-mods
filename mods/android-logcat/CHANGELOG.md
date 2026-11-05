# Changelog

## 0.2.0

- The repo's app is found when the Android project sits in a subfolder (`workspace/…`): every `applicationId` under the git root, six levels deep, version catalog references (`libs.versions.x.get()`) resolved through `gradle/libs.versions.toml`, matched against what is installed so sample apps that are not on the device drop out. With several installed, the app on screen is followed.
- `/logcat <package>` and the new App picker remember the package per repo (in the mod's own store, not the repo); `/logcat auto` forgets it. The command's hint lists the repo's apps on the device.
- Long lines wrap under the time by default; `w` toggles it, remembered across sessions.
- Drag over the lines to copy whole lines untruncated (the view holds while selecting); or click, Shift+Up/Down and `y`.
- The level picker reads `Verbose`/`Debug`/`Info`/`Warn`/`Error` like Android Studio's, each showing its level and above, and starts at `Verbose` (every line) instead of `D`.

## 0.1.1

- The lines are drawn in the monospaced face, so the time, level and tag columns line up in the desktop app's proportional font. There the level is a colored badge, the buttons have no hotkey badges (Pause the main one, the rest dimmed), the header leaves the title to the pane's title bar, and the lines leave room for the taller native controls. The terminal is unchanged.

## 0.1.0

- First version: a `/logcat` pane that follows the connected device's logcat for the repo's app (its `applicationId`, matched to the installed package and filtered by uid), colored by level like Android Studio, with a level floor, a text filter, pause and clear, a status-line count of errors and warnings, and a `logcat_read` tool Claude can call while the pane is on. The header, the controls and the filter stay at the top; the lines scroll under them by wheel, keys or the `u`/`d`/`f` buttons through the last 300 matching lines.
