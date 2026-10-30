# 기여 안내

[English](CONTRIBUTING.md) | 한국어

mod 하나는 `mods/` 아래의 Claude Code 플러그인 하나이고, `.claude-plugin/marketplace.json`에 등록됩니다. 이 문서는 mod를 추가하는 방법, 고칠 때의 로컬 작업 순서, 릴리스 방법을 설명합니다.

## 필요한 것

- Claude Code 2.1.287 이상(`claude --version`으로 확인)
- Node.js(`scripts/check.sh`에 필요)
- git

## 원칙

- **기본은 토큰 0입니다.** mod는 지켜보고 그리기만 합니다. 모델을 호출하거나 Claude가 읽는 내용에 무언가를 더하는 것이 mod의 목적이라면, 그 기능은 사용자가 직접 켜야 하고 README에 토큰을 얼마나 쓰는지 적어야 합니다.
- **터미널이 먼저입니다.** 터미널에 맞춰 그린 뒤, 다른 화면에서도 깨지지 않게 합니다.
- mod가 그리는 화면에 **이모지를 쓰지 않습니다**.
- **데이터를 밖으로 보내지 않습니다.** mod는 세션 데이터를 어디에도 전송하지 않습니다.

## mod 추가하기

1. 템플릿을 복사하고 이름을 바꿉니다.
   ```bash
   cp -R template mods/my-mod
   ```
   `.claude-plugin/plugin.json`, `types/index.d.ts`, `hooks/register.tsx`, 테스트, README 두 개에서 `my-mod`를 새 이름으로 바꿉니다.
2. `.claude-plugin/marketplace.json`에 항목을 추가합니다. `version`은 `plugin.json`과 같아야 합니다.
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
3. `README.md`와 `README.ko.md`의 Mods 표에 한 줄을 추가합니다.
4. `scripts/check.sh`를 통과시킨 뒤 PR을 엽니다.

hooks API 참고 문서는 Claude Code에 들어 있습니다. Claude에게 "mod 만들어줘"라고 하면 `plugin-authoring` 스킬을 불러옵니다.

## mod 이름은 바꾸지 않습니다

`name`은 사용자가 설치할 때 쓰는 이름(slug)입니다. 공개한 뒤에 바꾸면 기존 설치가 깨지므로 바꾸지 않습니다. 화면에 보이는 이름만 바꾸려면 `displayName`을 쓰세요. 꼭 이름을 바꿔야 한다면 `marketplace.json`에 `"renames": { "old-name": "new-name" }`을 추가해서 기존 설치가 새 이름으로 옮겨 가게 합니다.

## 로컬 작업 순서

clone한 폴더를 마켓플레이스로 한 번 추가하고, 거기서 설치합니다.

```bash
claude plugin marketplace add /path/to/awesome-claude-mods
claude plugin install my-mod@awesome-claude-mods
```

이 레포처럼 폴더이고 `source`가 상대 경로인 마켓플레이스는 폴더를 직접 읽습니다. 파일을 고치고 `/reload-plugins`를 실행하면 세션에 바로 반영됩니다. `claude plugin list`의 `Read from:`에 폴더가 보이면 이 방식입니다. 작업하는 동안에는 버전을 올릴 필요가 없습니다.

가장 빠르게 반복하려면 mod 폴더를 직접 로드하는 세션을 띄웁니다. 저장할 때마다 다시 로드됩니다. 설치본이 켜져 있으면 band가 두 번 그려지므로 `/plugin`에서 먼저 끕니다.

```bash
claude --plugin-dir mods/my-mod
```

GitHub에서 설치한 사용자는 설치할 때 만든 사본으로 돌아갑니다. 그래서 `mods/my-mod/.claude-plugin/plugin.json`과 `.claude-plugin/marketplace.json` 두 곳의 버전을 올려야 변경이 전달되고, 사용자는 아래 명령으로 받습니다.

```bash
claude plugin marketplace update awesome-claude-mods
claude plugin update my-mod@awesome-claude-mods
```

## 검사

```bash
scripts/check.sh            # 모든 mod와 템플릿: validate, test, 버전 일치, 금지 문자열
scripts/check.sh --history  # 모든 커밋의 diff와 메시지까지 검사. push 전에 실행
```

CI는 PR마다 `scripts/check.sh --history`를 실행합니다.

### 개인·회사 정보가 들어가지 않게

이 레포는 public입니다. 예시, 테스트, 스크린샷에는 가상의 프로젝트(`my-app`, `feat/search-filter`)만 씁니다. 실제 회사, 고객사, 개인 프로젝트의 이름, 경로, 브랜치를 쓰지 않습니다. 스크린샷을 찍기 전에는 터미널 제목, 프롬프트, 경로에 개인 정보가 보이지 않는지 확인합니다.

`scripts/check.sh`는 홈 디렉터리 절대 경로와 이메일 주소를 항상 걸러 냅니다. 여기에 더해 `~/.config/awesome-claude-mods/forbidden.txt`에서 추가 패턴을 읽습니다. 한 줄에 확장 정규식 하나를 쓰고, 대소문자는 구분하지 않습니다. 절대 공개하면 안 되는 이름을 여기에 적어 두세요. 이 파일은 내 컴퓨터에만 있습니다.

이 clone에서는 커밋 작성자를 GitHub noreply 주소로 설정해서, 회사 이메일이나 장비 이름이 커밋 기록에 남지 않게 합니다.

```bash
git config user.name your-github-name
git config user.email <id>+<your-github-name>@users.noreply.github.com
```

## 릴리스

1. 버전을 올리고(semver), mod의 `CHANGELOG.md` 맨 위에 새 절을 추가합니다.
2. PR을 `main`에 merge합니다. 사용자는 `claude plugin marketplace update awesome-claude-mods`와 `claude plugin update <mod>@awesome-claude-mods`로 받습니다.
3. 원하면 `<mod>-v<버전>`(`step-tracker-v0.6.0`) 태그를 붙이고, 해당 CHANGELOG 절을 본문으로 GitHub Release를 만듭니다.

## PR

`main`은 보호되어 있습니다. 모든 변경은 CI를 통과한 PR로 들어가고 squash merge합니다. PR 템플릿의 체크리스트를 채워 주세요.
