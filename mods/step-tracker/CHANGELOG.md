# Changelog

## 0.7.0

- The band draws in English by default. A new `language` option (`en`, `ko`) switches every phrase to Korean.

## 0.6.0

- Background shells: commands started with `run_in_background` or sent to the background with Ctrl+B show as `$` rows and keep the band up until their completion notification arrives or `TaskStop` ends them.

## 0.5.1

- Always-on graph: without a plan, an activity chart of calls per two seconds with a walking Claude mascot that thinks and blinks.
- Recent calls rise from the bottom and fade as they go; a call that just finished is lit for a moment.
- Removed scrolling inside the band.

## 0.4.0

- Fixed-height framed band with the header in its top border and a divider between the list and the activity area. The frame turns teal in plan mode.

## 0.3.0

- Recent calls are listed one per line with their status and duration instead of joined on one line.

## 0.2.1

- Plan mode is also read from plan-mode reminders, `EnterPlanMode`/`ExitPlanMode` and subagent spawns, for sessions where another plugin swallows the classic events.

## 0.2.0

- Activity line naming what Claude is doing now, with a sweeping glow.
- Turn summary by kind of call, and the files changed.
- Per-agent rows with task, current call, call count and elapsed time.
- Press a call, a count or an agent to open its detail.

## 0.1.0

- First version: plan steps above the prompt, step timeline, branch and worktree.
