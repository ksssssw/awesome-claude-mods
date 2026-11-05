<h1 align="center">Awesome Claude Mods</h1>

<p align="center">
  Small, token-free mods that reshape the Claude Code terminal.
</p>

<p align="center">
  <a href="https://github.com/ksssssw/awesome-claude-mods/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ksssssw/awesome-claude-mods/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Claude Code 2.1.287+" src="https://img.shields.io/badge/Claude%20Code-2.1.287%2B-d97757.svg">
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"></a>
</p>

<p align="center">
  English | <a href="README.ko.md">한국어</a>
</p>

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
│ ⠹ Editing SearchPage.tsx                                                  00:02 │
│   This turn  read 1 · edit 1 · run 2 ─ SearchPage.tsx                            │
│   $ start the dev server ─ npm run dev                                    03:10 │
╰─────────────────────────────────────────────────────────────────────────────────╯
```
<p align="center"><sub><a href="mods/step-tracker">step-tracker</a>: what Claude is doing, above the prompt</sub></p>

> [!WARNING]
> A mod runs code inside your Claude Code session. Read a mod's source before you install it, and update only from sources you trust.

## Contents

- [What are mods?](#what-are-mods)
- [Quick start](#quick-start)
- [Mods](#mods)
- [Principles](#principles)
- [Repository structure](#repository-structure)
- [Creating a mod](#creating-a-mod)
- [License](#license)

## What are mods?

A mod is a Claude Code plugin with a hooks module: code that runs inside the session and changes what Claude Code draws or does. It can draw a band above the prompt, open a pane beside the chat, set the status line, add a slash command or watch tool calls.

Skills and MCP servers give Claude new knowledge or tools, and Claude reads them. A mod works on the interface around Claude, so it can add nothing to the conversation at all. Mods need Claude Code 2.1.287 or later.

## Quick start

Add this repository as a marketplace once:

```
/plugin marketplace add ksssssw/awesome-claude-mods
```

Adding the marketplace installs nothing. Pick the mods you want:

```
/plugin install step-tracker@awesome-claude-mods
```

From a shell, one line does both: `claude plugin install step-tracker --marketplace ksssssw/awesome-claude-mods`.

**Turn mods on and off** one by one in the **Installed** tab of `/plugin`, or from a shell. A disabled mod stays installed.

```bash
claude plugin disable step-tracker@awesome-claude-mods
claude plugin enable step-tracker@awesome-claude-mods
```

**Scope**: install for your user (every project) or for one project only, when `/plugin install` asks.

**Update and remove**:

```bash
claude plugin marketplace update awesome-claude-mods
claude plugin update step-tracker@awesome-claude-mods
claude plugin uninstall step-tracker@awesome-claude-mods
```

## Mods

| Mod | What it does | Where | Tokens | Version |
| --- | --- | --- | --- | --- |
| [step-tracker](mods/step-tracker) | Plan steps, what Claude is doing now, the calls it just made, a live activity graph with a walking mascot, background agents and shells, and the branch, in a framed band | Band above the prompt | 0 | 0.7.0 |
| [android-logcat](mods/android-logcat) | The connected Android device's logcat for the repo's app, colored by level like Android Studio, with a level floor, a text filter and a `logcat_read` tool for Claude | Pane beside the transcript | 0 off, 1 tool while on | 0.2.0 |
| [android-device](mods/android-device) | The connected Android device and the repo's app on it: pick a device, install an APK dropped on the terminal or picked from `build/` (asking before `-d`, `-t` or an uninstall), launch, stop, uninstall, screenshot, record, pull the foreground app's APK, a foldable hardware spec block (CPU-Z style), and eight tools for Claude | Pane beside the transcript | 0 off, 8 tools while on | 0.3.0 |

## Principles

- **Zero tokens by default.** Mods watch and draw. Anything that calls a model or adds to what Claude reads is opt-in and documented.
- **Terminal first.** Designed for the terminal, degrading cleanly elsewhere.
- **No emoji** in what a mod draws.
- **Nothing leaves your machine.** Mods do not send session data anywhere.

## Repository structure

```
awesome-claude-mods/
├── .claude-plugin/marketplace.json   # the marketplace: every mod and its version
├── mods/<name>/                      # one mod = one plugin, with its README and CHANGELOG
├── template/                         # a working mod to copy when starting a new one
├── scripts/check.sh                  # validate, test and scan every mod (CI runs it too)
└── CONTRIBUTING.md                   # adding a mod, the local loop, releasing
```

## Creating a mod

Copy `template/` to `mods/<name>/`, list it in `.claude-plugin/marketplace.json`, and run `scripts/check.sh`. [CONTRIBUTING.md](CONTRIBUTING.md) walks through it, including how edits reach an installed mod.

## License

[MIT](LICENSE)
