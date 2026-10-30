# My Mod

[English](README.md) | 한국어

이 mod가 Claude Code에서 무엇을 보여 주거나 바꾸는지, 왜 쓰면 좋은지 한두 문장으로 씁니다. 토큰을 쓰는지도 밝힙니다. 따로 적지 않으면 이 레포의 mod는 토큰을 쓰지 않습니다.

```
/plugin install my-mod --marketplace ksssssw/awesome-claude-mods
```

![my-mod](assets/screenshot.png)

## 보여 주는 것

어디에(프롬프트 위 band, pane, 상태 줄) 무엇이 나오고 각 부분이 무슨 뜻인지 씁니다.

## 동작 규칙

언제 나타나고 사라지는지, 무엇을 언제 읽는지, 절대 하지 않는 일은 무엇인지 씁니다.

## 설정

추가하는 명령과 옵션을 씁니다. 없으면 "없음"이라고 씁니다.

## 알려진 제약

아직 못 하는 일과, 다르게 동작하는 화면이나 환경을 씁니다.

## 개발

```bash
claude plugin validate mods/my-mod --profile directory
claude plugin test mods/my-mod
claude --plugin-dir mods/my-mod
```

변경 내역은 [CHANGELOG.md](CHANGELOG.md)를 보세요.
