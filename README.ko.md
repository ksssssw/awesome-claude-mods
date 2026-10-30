<h1 align="center">Awesome Claude Mods</h1>

<p align="center">
  Claude Code 터미널을 바꾸는, 토큰을 쓰지 않는 작은 mod 모음
</p>

<p align="center">
  <a href="https://github.com/ksssssw/awesome-claude-mods/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ksssssw/awesome-claude-mods/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Claude Code 2.1.287+" src="https://img.shields.io/badge/Claude%20Code-2.1.287%2B-d97757.svg">
  <a href="CONTRIBUTING.ko.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"></a>
</p>

<p align="center">
  <a href="README.md">English</a> | 한국어
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
│ ⠹ SearchPage.tsx 수정 중                                                  00:02 │
│   이번 턴  읽기 1 · 수정 1 · 명령 2 ─ SearchPage.tsx                             │
│   $ start the dev server ─ npm run dev                                    03:10 │
╰─────────────────────────────────────────────────────────────────────────────────╯
```
<p align="center"><sub><a href="mods/step-tracker/README.ko.md">step-tracker</a>: Claude가 하는 일을 프롬프트 위에 보여 줍니다 (<code>language: ko</code> 설정 화면)</sub></p>

> [!WARNING]
> mod는 Claude Code 세션 안에서 코드를 실행합니다. 설치하기 전에 소스를 읽어 보고, 믿을 수 있는 곳에서만 업데이트하세요.

## 목차

- [mod란?](#mod란)
- [빠른 시작](#빠른-시작)
- [mod 목록](#mod-목록)
- [원칙](#원칙)
- [레포 구조](#레포-구조)
- [mod 만들기](#mod-만들기)
- [라이선스](#라이선스)

## mod란?

mod는 hooks module을 가진 Claude Code 플러그인입니다. 세션 안에서 돌아가는 코드로, Claude Code가 그리는 화면이나 동작을 바꿉니다. 프롬프트 위에 band를 그리거나, 대화 옆에 pane을 열거나, 상태 줄을 바꾸거나, 슬래시 명령을 추가하거나, 도구 호출을 지켜볼 수 있습니다.

스킬과 MCP 서버는 Claude에게 새 지식이나 도구를 주고, Claude가 그 내용을 읽습니다. mod는 Claude 바깥의 화면에서 동작하므로 대화에 아무것도 더하지 않을 수 있습니다. Claude Code 2.1.287 이상이 필요합니다.

## 빠른 시작

이 레포를 마켓플레이스로 한 번 추가합니다.

```
/plugin marketplace add ksssssw/awesome-claude-mods
```

마켓플레이스를 추가해도 아무것도 설치되지 않습니다. 원하는 mod만 골라 설치합니다.

```
/plugin install step-tracker@awesome-claude-mods
```

셸에서는 한 줄로 둘 다 할 수 있습니다: `claude plugin install step-tracker --marketplace ksssssw/awesome-claude-mods`

**켜기와 끄기**는 mod마다 따로 합니다. `/plugin`의 **Installed** 탭에서 하거나 셸에서 합니다. 꺼도 설치는 남아 있습니다.

```bash
claude plugin disable step-tracker@awesome-claude-mods
claude plugin enable step-tracker@awesome-claude-mods
```

**범위**: `/plugin install`이 물을 때 사용자 전체(모든 프로젝트) 또는 특정 프로젝트만 고릅니다.

**업데이트와 제거**:

```bash
claude plugin marketplace update awesome-claude-mods
claude plugin update step-tracker@awesome-claude-mods
claude plugin uninstall step-tracker@awesome-claude-mods
```

## mod 목록

| Mod | 하는 일 | 위치 | 토큰 | 버전 |
| --- | --- | --- | --- | --- |
| [step-tracker](mods/step-tracker/README.ko.md) | 계획 단계, 지금 하는 일, 방금 끝낸 호출, 걸어 다니는 캐릭터가 있는 실시간 활동 그래프, 백그라운드 에이전트와 셸, 브랜치를 테두리 상자 하나에 보여 줍니다 | 프롬프트 위 band | 0 | 0.7.0 |

## 원칙

- **기본은 토큰 0입니다.** mod는 지켜보고 그리기만 합니다. 모델을 호출하거나 Claude가 읽는 내용을 늘리는 기능은 직접 켜야 하고 문서에 밝힙니다.
- **터미널이 먼저입니다.** 터미널에 맞춰 만들고, 다른 화면에서도 깨지지 않게 합니다.
- mod가 그리는 화면에 **이모지를 쓰지 않습니다**.
- **데이터를 밖으로 보내지 않습니다.** mod는 세션 데이터를 어디에도 전송하지 않습니다.

## 레포 구조

```
awesome-claude-mods/
├── .claude-plugin/marketplace.json   # 마켓플레이스: 모든 mod와 버전
├── mods/<name>/                      # mod 하나 = 플러그인 하나, README와 CHANGELOG 포함
├── template/                         # 새 mod를 시작할 때 복사하는, 실제로 동작하는 mod
├── scripts/check.sh                  # 모든 mod를 검증·테스트·검사 (CI도 실행)
└── CONTRIBUTING.ko.md                # mod 추가, 로컬 작업 순서, 릴리스
```

## mod 만들기

`template/`을 `mods/<name>/`으로 복사하고, `.claude-plugin/marketplace.json`에 등록한 뒤 `scripts/check.sh`를 실행합니다. 자세한 내용은 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md)에 있습니다. 수정 내용이 설치된 mod에 반영되는 방식도 거기에 설명되어 있습니다.

## 라이선스

[MIT](LICENSE)
