# My Mod

English | [한국어](README.ko.md)

One or two sentences on what the mod shows or changes in Claude Code, and why someone would want it. Say whether it costs tokens: a mod here costs none unless it says otherwise.

```
/plugin install my-mod --marketplace ksssssw/awesome-claude-mods
```

![my-mod](assets/screenshot.png)

## What it shows

What appears where (band above the prompt, a pane, the status line) and what each part means.

## Behavior

When it appears and disappears, what it reads and when, and what it never does.

## Configuration

Commands it adds and options it takes, or "None".

## Known limitations

What it cannot do yet, and the surfaces or setups where it behaves differently.

## Development

```bash
claude plugin validate mods/my-mod --profile directory
claude plugin test mods/my-mod
claude --plugin-dir mods/my-mod
```

Changes are listed in [CHANGELOG.md](CHANGELOG.md).
