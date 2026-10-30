# Step Tracker

English | [한국어](README.ko.md)

A framed band above the Claude Code prompt that shows what Claude is doing: its plan steps, the work in progress, the calls it just made, a live activity graph, background agents and shells, and the branch you are on.

It never calls a model and never adds anything Claude reads, so it costs **zero tokens**.

```
/plugin install step-tracker --marketplace ksssssw/awesome-claude-mods
```

## What it shows

With a plan (when Claude keeps a to-do list with `TodoWrite` or `TaskCreate`):

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

Without a plan, the calls Claude just finished rise from the bottom and fade as they go, beside a graph of calls per two seconds and a small Claude that walks while it works:

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

- **Header** (in the top border): step count, repository, branch (`wt:` inside a worktree), `*` for changes, `↑n` commits ahead, elapsed time, context use.
- **Steps**: `✓` done, a spinner on the one in progress (`▸` once the turn ends) with its time, `○` still to do. The last three calls sit under the active step.
- **Timeline** (92 columns and wider, with a plan): one bar per step, the running bar growing in real time.
- **Recent calls** (no plan): newest at the bottom, older ones fading as they rise; one that just finished is lit green for a moment, a failed one is a red `✗`.
- **Activity graph** (92 columns and wider, no plan): calls per two seconds, colored by the kind most called (read blue, edit orange, run green, search purple, skill yellow). Under it, Claude walks while it works, thinks with `·∙•` over its head while the model thinks, and stands still and blinks when idle.
- **Activity line**: what is happening now, with a glow that sweeps across it: waiting for the model, thinking, writing the answer, writing a change, `<file> 읽는/수정 중`, `<command> 실행 중`, and so on. In plan mode it reads as planning and the frame turns teal.
- **This turn**: calls by kind and the files changed.
- **Background work**: each running subagent (`◆`) with its task, current call and call count, and each background shell (`$`) started with `run_in_background` or sent there with Ctrl+B. The band stays up after the turn while any of them runs.

## Interaction

- Recent calls, the counts (`명령 6`) and the agent and shell rows are buttons. Pressing one opens its detail in place of the list: the whole command or path, the pattern and where it looked, a skill's arguments, an agent's last 20 calls, a shell's command and task id. `‹ 닫기` or pressing it again closes it.
- Mouse clicks work in the fullscreen terminal (`"tui": "fullscreen"`). With the keyboard, focus the band with Ctrl+X Tab and press Enter on an item.
- `/steps` forces the band on or off.

## Behavior

- The band has a fixed height of 12 rows (less on a short screen). The list area shrinks as agents or shells appear, so the band never jumps.
- Nothing scrolls: the steps follow the active one, and recent calls keep the newest.
- Branch information is read again only at a turn's start and end and after `Bash`, `EnterWorktree` and `ExitWorktree`.
- The model's phase comes from the kinds of chunks it streams (thinking, text, tool). Every chunk passes through unchanged.
- `/clear` and `/resume` empty the list.
- The terminal comes first. The desktop app shows the list without graphs.

## Known limitations

- The interface text is Korean for now. An English option is planned.
- Plan mode is read from events another plugin can intercept. If one of your plugins answers those events without passing them on, the band only notices plan mode through `EnterPlanMode` and `ExitPlanMode` calls.
- A background shell row is removed when its completion notification arrives. If that notification never reaches the session, the row stays until `/clear`.
- Box-drawing and block characters assume a font where they are one cell wide.

## Development

```bash
claude plugin validate mods/step-tracker --profile directory
claude plugin test mods/step-tracker        # 25 tests
claude --plugin-dir mods/step-tracker       # load this folder directly, reloading on save
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the release loop. Changes are listed in [CHANGELOG.md](CHANGELOG.md).
