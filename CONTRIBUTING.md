# Contributing

English | [한국어](CONTRIBUTING.ko.md)

Each mod is one Claude Code plugin under `mods/`, listed in `.claude-plugin/marketplace.json`. This page covers adding a mod, the local loop for changing one, and releasing it.

## Requirements

- Claude Code 2.1.287 or later (`claude --version`)
- Node.js, for `scripts/check.sh`
- git

## Principles

- **Zero tokens by default.** A mod watches and draws. It does not call a model or add to what Claude reads unless that is the point of the mod, and then it is opt-in and the README says what it spends.
- **Terminal first.** Draw for the terminal, then make sure other surfaces degrade cleanly.
- **No emoji** in what a mod draws.
- **Nothing leaves the machine.** A mod does not send the session's data anywhere.

## Adding a mod

1. Copy the template and rename it:
   ```bash
   cp -R template mods/my-mod
   ```
   Replace `my-mod` in `.claude-plugin/plugin.json`, `types/index.d.ts`, `hooks/register.tsx`, the tests and both READMEs.
2. Add it to `.claude-plugin/marketplace.json` with the same `version` as its `plugin.json`:
   ```json
   {
     "name": "my-mod",
     "displayName": "My Mod",
     "description": "One sentence.",
     "version": "0.1.0",
     "author": { "name": "your-github-name", "url": "https://github.com/your-github-name" },
     "category": "productivity",
     "keywords": [],
     "source": "./mods/my-mod"
   }
   ```
3. Add a row to the Mods table in `README.md` and `README.ko.md`.
4. Run `scripts/check.sh` and open a pull request.

The authoring reference for the hooks API ships with Claude Code: ask Claude to "make a mod" and it loads the `plugin-authoring` skill.

## Mod names never change

A mod's `name` is the slug people install it under. Once it is published, do not change it: their install would break. To change how it is labeled, set `displayName`. If a rename is truly needed, add `"renames": { "old-name": "new-name" }` to `marketplace.json` so existing installs move over.

## The local loop

Add your clone as a marketplace once and install from it:

```bash
claude plugin marketplace add /path/to/awesome-claude-mods
claude plugin install my-mod@awesome-claude-mods
```

A marketplace that is a folder, with relative `source` paths like this one, is read from the folder itself. Edit a file, run `/reload-plugins`, and the session runs your change; `claude plugin list` shows `Read from:` with the folder. No version bump is needed while you work.

For the fastest loop, start a session on the mod's folder instead. It reloads on every save. Turn the installed copy off in `/plugin` first, or the mod draws twice.

```bash
claude --plugin-dir mods/my-mod
```

People who install from GitHub run a copy made at install time. They receive a change only when its version is raised in both `mods/my-mod/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` and they run:

```bash
claude plugin marketplace update awesome-claude-mods
claude plugin update my-mod@awesome-claude-mods
```

## Checks

```bash
scripts/check.sh            # every mod and the template: validate, test, versions, private strings
scripts/check.sh --history  # also every commit's diff and message; run it before pushing
```

CI runs `scripts/check.sh --history` on every pull request.

### Keeping private things out

This repository is public. Examples, tests and screenshots use made-up projects (`my-app`, `feat/search-filter`), never a real employer's, client's or private project's names, paths or branches. Before taking a screenshot, make sure the terminal title, prompt and paths show nothing personal.

`scripts/check.sh` always rejects absolute home paths and email addresses. It also reads extra patterns from `~/.config/awesome-claude-mods/forbidden.txt` (one extended regex per line, matched without case). Put the names you must never publish there: the file stays on your machine.

Set your commit identity to your GitHub noreply address in this clone, so no work email or machine name ends up in the history:

```bash
git config user.name your-github-name
git config user.email <id>+<your-github-name>@users.noreply.github.com
```

## Releasing

1. Raise the version (semver) and add a section at the top of the mod's `CHANGELOG.md`.
2. Merge the pull request into `main`. Users get it with `claude plugin marketplace update awesome-claude-mods` and `claude plugin update <mod>@awesome-claude-mods`.
3. Optionally tag it as `<mod>-v<version>` (`step-tracker-v0.6.0`) and publish a GitHub release whose notes are that CHANGELOG section.

## Pull requests

`main` is protected: every change goes through a pull request with CI passing, and is squash-merged. Fill in the checklist in the pull request template.
