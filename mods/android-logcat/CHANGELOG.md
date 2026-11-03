# Changelog

## 0.1.1

- The lines are drawn in the monospaced face, so the time, level and tag columns line up in the desktop app's proportional font. There the level is a colored badge, the buttons have no hotkey badges (Pause the main one, the rest dimmed), the header leaves the title to the pane's title bar, and the lines leave room for the taller native controls. The terminal is unchanged.

## 0.1.0

- First version: a `/logcat` pane that follows the connected device's logcat for the repo's app (its `applicationId`, matched to the installed package and filtered by uid), colored by level like Android Studio, with a level floor, a text filter, pause and clear, a status-line count of errors and warnings, and a `logcat_read` tool Claude can call while the pane is on. The header, the controls and the filter stay at the top; the lines scroll under them by wheel, keys or the `u`/`d`/`f` buttons through the last 300 matching lines.
