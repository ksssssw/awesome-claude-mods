// Every phrase the pane and the command draw, in each language the `language` option offers
export type Language = 'en' | 'ko'

export type Strings = {
  commandDescription: string
  argumentHint: string
  paneTitle: string
  turnedOn: (pkg: string) => string
  turnedOff: string
  cleared: string
  alreadyOff: string
  failed: string
  level: string
  filter: string
  filterPlaceholder: string
  pause: string
  resume: string
  clear: string
  older: string
  newer: string
  follow: string
  newerLines: string
  off: string
  starting: string
  reconnecting: string
  live: string
  paused: string
  noAdb: string
  noDevice: string
  notInstalled: (pkg: string) => string
  allProcesses: string
  oneOf: (chosen: string, count: number) => string
  empty: string
  toolOff: string
  statusLine: (pkg: string, errors: number, warnings: number) => string
}

const EN: Strings = {
  commandDescription: 'Show the connected Android device\u2019s logcat in a pane; again to hide',
  argumentHint: '[off | clear | <package>]',
  paneTitle: 'logcat',
  turnedOn: pkg => `logcat on: ${pkg}`,
  turnedOff: 'logcat off',
  cleared: 'logcat cleared',
  alreadyOff: 'logcat is already off',
  failed: 'logcat could not run; see the debug log',
  level: 'Level',
  filter: 'Filter',
  filterPlaceholder: 'tag or message',
  pause: 'Pause',
  resume: 'Resume',
  clear: 'Clear',
  older: 'Older',
  newer: 'Newer',
  follow: 'Follow',
  newerLines: '{n} newer lines below; f follows the newest',
  off: 'off',
  starting: 'starting',
  reconnecting: 'reconnecting',
  live: 'live',
  paused: 'paused',
  noAdb: 'adb not found: put it on PATH or set ANDROID_HOME',
  noDevice: 'no device connected, retrying',
  notInstalled: pkg => `${pkg} is not installed on the device, retrying`,
  allProcesses: 'all processes',
  oneOf: (chosen, count) => `${chosen} (1 of ${count})`,
  empty: 'No lines match.',
  toolOff: 'logcat is off. Ask the person to run /logcat first.',
  statusLine: (pkg, errors, warnings) => `logcat ${pkg} \u00b7 E ${errors} W ${warnings}`,
}

const KO: Strings = {
  commandDescription: '연결된 안드로이드 단말의 logcat을 패널로 보여 줍니다. 다시 치면 숨깁니다',
  argumentHint: '[off | clear | <package>]',
  paneTitle: 'logcat',
  turnedOn: pkg => `logcat 켬: ${pkg}`,
  turnedOff: 'logcat 끔',
  cleared: 'logcat 비움',
  alreadyOff: 'logcat이 이미 꺼져 있습니다',
  failed: 'logcat을 실행하지 못했습니다. 디버그 로그를 보세요',
  level: '레벨',
  filter: '필터',
  filterPlaceholder: '태그 또는 메시지',
  pause: '일시정지',
  resume: '재개',
  clear: '비우기',
  older: '이전',
  newer: '이후',
  follow: '따라가기',
  newerLines: '아래에 {n}줄 더 있음. f를 누르면 최신을 따라갑니다',
  off: '꺼짐',
  starting: '시작 중',
  reconnecting: '다시 연결 중',
  live: '실시간',
  paused: '일시정지',
  noAdb: 'adb를 찾을 수 없습니다. PATH에 두거나 ANDROID_HOME을 설정하세요',
  noDevice: '연결된 단말이 없습니다. 다시 시도 중',
  notInstalled: pkg => `${pkg}이(가) 단말에 없습니다. 다시 시도 중`,
  allProcesses: '전체 프로세스',
  oneOf: (chosen, count) => `${chosen} (${count}개 중 1개)`,
  empty: '맞는 줄이 없습니다.',
  toolOff: 'logcat이 꺼져 있습니다. 먼저 /logcat을 실행해 달라고 하세요.',
  statusLine: (pkg, errors, warnings) => `logcat ${pkg} \u00b7 E ${errors} W ${warnings}`,
}

const TABLES: Record<Language, Strings> = { en: EN, ko: KO }

let current: Strings = EN

export function setLanguage(language: unknown) {
  current = TABLES[language === 'ko' ? 'ko' : 'en']
}

export function t(): Strings {
  return current
}
