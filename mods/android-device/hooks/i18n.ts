// Every phrase the pane, the command and the tools draw, in each language the `language` option offers
export type Language = 'en' | 'ko'

export type Strings = {
  commandDescription: string
  argumentHint: string
  title: string
  turnedOn: string
  turnedOff: string
  alreadyOff: string
  failed: string
  badPackage: (arg: string) => string
  badSerial: (arg: string) => string
  noSuchDevice: (arg: string) => string
  selected: (label: string) => string
  queued: (file: string) => string
  noSuchFile: (path: string) => string
  packageSet: (pkg: string) => string
  nothingPending: string
  refreshed: string
  noAdb: string
  noDevice: string
  pickDevice: string
  needDevice: string
  needPackage: string
  toolOff: string
  notAndroidRepo: string
  noApks: string
  packageNotSet: string
  dropHint: string
  // Blocks
  device: string
  app: string
  install: string
  last: string
  capture: string
  connected: (n: number) => string
  usb: string
  wifi: string
  unauthorized: string
  offline: string
  batteryLabel: string
  storageLabel: string
  freeOf: (free: string, total: string) => string
  screenOn: string
  screenOff: string
  api: (release: string, sdk: string) => string
  installedState: string
  notInstalled: string
  disabled: string
  running: (pid: number) => string
  updated: (stamp: string) => string
  firstInstalled: (stamp: string) => string
  version: (name: string, code: string) => string
  builtAt: (stamp: string) => string
  pendingFile: (file: string) => string
  installing: (file: string, seconds: number) => string
  failedLine: (code: string) => string
  askDowngrade: string
  askTestOnly: string
  askReinstall: (pkg: string) => string
  askRetry: (message: string) => string
  downgradeAfterD: string
  downgradeRelease: string
  askUninstall: (pkg: string) => string
  askClear: (pkg: string) => string
  recording: (clock: string) => string
  savedTo: (dir: string) => string
  // Buttons
  yes: string
  no: string
  refresh: string
  switchDevice: string
  launch: string
  stop: string
  uninstall: string
  clearData: string
  installButton: string
  pickApk: string
  cancel: string
  screenshot: string
  record: string
  stopRecord: string
  pullApk: string
  shotLabel: string
  videoLabel: string
  apkLabel: string
  open: string
  reveal: string
  play: string
  stopPlay: string
  closeItem: string
  openFailed: string
  preparing: string
  playing: (clock: string) => string
  splits: (count: number) => string
  noFfmpeg: string
  // Results
  installed: (pkg: string, version: string) => string
  installFailed: (code: string, message: string) => string
  retryHint: (flag: string) => string
  reinstallHint: string
  launched: (pkg: string) => string
  launchFailed: (pkg: string) => string
  stopped: (pkg: string) => string
  uninstalled: (pkg: string) => string
  uninstallFailed: (pkg: string, reason: string) => string
  cleared: (pkg: string) => string
  clearFailed: (pkg: string) => string
  screenshotSaved: (path: string) => string
  recordingStarted: string
  recordingSaved: (path: string) => string
  captureFailed: string
  noForeground: string
  pulled: (pkg: string, path: string) => string
  pulledSplits: (pkg: string, count: number, dir: string) => string
  pullFailed: (pkg: string) => string
  busy: string
  statusLine: (model: string, pkg: string, version: string) => string
  statusInstalling: (file: string) => string
  statusRecording: (clock: string) => string
  // Tools
  toolDeviceList: string
  toolApkList: string
  toolApkInstall: string
  toolPackageInfo: string
  toolAppLaunch: string
  toolAppStop: string
  toolScreenshot: string
  toolApkPull: string
  noneConnected: string
  noneInstalledInfo: (pkg: string) => string
}

const EN: Strings = {
  commandDescription: 'Show the connected Android device and the repo’s app on it in a pane; install an APK; again to hide',
  argumentHint: '[off | select <serial|n> | install <path> | apk | package <name> | launch | stop | uninstall | clear | screenshot | record | pull | refresh]',
  title: 'adb',
  turnedOn: 'adb on',
  turnedOff: 'adb off',
  alreadyOff: 'adb is already off',
  failed: 'adb could not run; see the debug log',
  badPackage: arg => `not a package name: ${arg}`,
  badSerial: arg => `not a device serial: ${arg}`,
  noSuchDevice: arg => `no connected device matches ${arg}`,
  selected: label => `device: ${label}`,
  queued: file => `${file} is waiting in the adb pane; press i there to install it`,
  noSuchFile: path => `no such file: ${path}`,
  packageSet: pkg => `package: ${pkg}`,
  nothingPending: 'no APK is waiting; drop one on the terminal or /adb install <path>',
  refreshed: 'refreshed',
  noAdb: 'adb not found: put it on PATH or set ANDROID_HOME',
  noDevice: 'no device connected',
  pickDevice: 'several devices: press d to pick one',
  needDevice: 'pick a device first',
  needPackage: 'no package known: /adb package <name>',
  toolOff: 'adb is off. Ask the person to run /adb first.',
  notAndroidRepo: 'not an Android repo',
  noApks: 'no APK under a build folder; build first',
  packageNotSet: 'package not set: /adb package <name>, or open an Android repo',
  dropHint: 'drop an .apk on the terminal, or /adb install <path>',
  device: 'Device',
  app: 'App',
  install: 'Install',
  last: 'Last',
  capture: 'Capture',
  connected: n => `${n} connected`,
  usb: 'USB',
  wifi: 'Wi-Fi',
  unauthorized: 'unauthorized: accept the prompt on the device',
  offline: 'offline',
  batteryLabel: 'Battery',
  storageLabel: 'Storage',
  freeOf: (free, total) => `${free} free of ${total}`,
  screenOn: 'screen on',
  screenOff: 'screen off',
  api: (release, sdk) => `Android ${release} (API ${sdk})`,
  installedState: 'installed',
  notInstalled: 'not installed',
  disabled: 'disabled',
  running: pid => `running (pid ${pid})`,
  updated: stamp => `updated ${stamp}`,
  firstInstalled: stamp => `installed ${stamp}`,
  version: (name, code) => `v${name} (${code})`,
  builtAt: stamp => `built ${stamp}`,
  pendingFile: file => `${file} waiting`,
  installing: (file, seconds) => `installing ${file}… ${seconds}s`,
  failedLine: code => `FAILED ${code}`,
  askDowngrade: 'Retry with -d (allow a downgrade)?',
  askTestOnly: 'Retry with -t (allow a test-only APK)?',
  askReinstall: pkg => `Uninstall ${pkg} (its data is lost) and install again?`,
  askRetry: message => `${message || 'install failed'} — retry?`,
  downgradeAfterD: 'still a downgrade with -d',
  downgradeRelease: 'a release build cannot be downgraded',
  askUninstall: pkg => `Uninstall ${pkg}? Its data is lost.`,
  askClear: pkg => `Clear all data of ${pkg}?`,
  recording: clock => `recording ${clock}`,
  savedTo: dir => `→ ${dir}`,
  yes: 'Yes',
  no: 'No',
  refresh: 'Refresh',
  switchDevice: 'Switch device',
  launch: 'Launch',
  stop: 'Stop',
  uninstall: 'Uninstall',
  clearData: 'Clear data',
  installButton: 'Install',
  pickApk: 'Pick APK',
  cancel: 'Cancel',
  screenshot: 'Screenshot',
  record: 'Record',
  stopRecord: 'Stop recording',
  pullApk: 'Pull APK',
  shotLabel: 'Shot',
  videoLabel: 'Video',
  apkLabel: 'APK',
  open: 'Open',
  reveal: 'Folder',
  play: '\u25b6 Play',
  stopPlay: '\u25a0 Stop',
  closeItem: 'Close',
  openFailed: 'could not open the file',
  preparing: 'preparing frames\u2026',
  playing: clock => `playing ${clock}`,
  splits: count => `+${count} split${count === 1 ? '' : 's'}`,
  noFfmpeg: 'no ffmpeg: opening the recording in the system player',
  installed: (pkg, version) => `installed ${pkg} ${version}`,
  installFailed: (code, message) => `install failed: ${code}${message ? ` (${message})` : ''}`,
  retryHint: flag => `Press y in the adb pane, or call apk_install again with ${flag}, to retry.`,
  reinstallHint: 'Press y in the adb pane to uninstall the installed app (its data is lost; a system app goes back to its factory copy) and install again.',
  launched: pkg => `launched ${pkg}`,
  launchFailed: pkg => `could not launch ${pkg}: no launcher activity or not installed`,
  stopped: pkg => `stopped ${pkg}`,
  uninstalled: pkg => `uninstalled ${pkg}`,
  uninstallFailed: (pkg, reason) => `could not uninstall ${pkg}: ${reason}`,
  cleared: pkg => `cleared the data of ${pkg}`,
  clearFailed: pkg => `could not clear ${pkg}`,
  screenshotSaved: path => `screenshot saved: ${path}`,
  recordingStarted: 'recording; press v again to stop (3 minutes at most)',
  recordingSaved: path => `recording saved: ${path}`,
  captureFailed: 'capture failed; see the debug log',
  noForeground: 'no app in the foreground',
  pulled: (pkg, path) => `pulled ${pkg}: ${path}`,
  pulledSplits: (pkg, count, dir) => `pulled ${pkg}: ${count} files (base and splits) into ${dir}`,
  pullFailed: pkg => `could not pull ${pkg}`,
  busy: 'another install or capture is running',
  statusLine: (model, pkg, version) => `adb ${model}${pkg ? ` · ${pkg}${version ? ` ${version}` : ''}` : ''}`,
  statusInstalling: file => `adb installing ${file}…`,
  statusRecording: clock => `adb recording ${clock}`,
  toolDeviceList: 'Lists the Android devices adb sees: serial, model, state and which one the adb pane has chosen.',
  toolApkList: 'Lists the APK files under the build folders of the working directory, newest first.',
  toolApkInstall: 'Installs an APK on the chosen device (adb install -r). On failure the answer says why and what a retry would add; pass allowDowngrade or allowTestOnly only after the person agreed.',
  toolPackageInfo: 'Reads the installed state of a package on the chosen device: version name and code, install and update times, installer, whether it runs. Default: the repo’s app.',
  toolAppLaunch: 'Launches a package on the chosen device. Default: the repo’s app.',
  toolAppStop: 'Force-stops a package on the chosen device. Default: the repo’s app.',
  toolScreenshot: 'Takes a screenshot of the chosen device and answers the saved file’s path.',
  toolApkPull: 'Pulls the APK of the app in the foreground of the chosen device (or of the package named) into the capture folder and answers the saved path. Split APKs come as several files.',
  noneConnected: 'no device connected',
  noneInstalledInfo: pkg => `${pkg} is not installed on the device`,
}

const KO: Strings = {
  commandDescription: '연결된 안드로이드 단말과 레포 앱의 상태를 패널로 보여 주고 APK를 설치합니다. 다시 치면 숨깁니다',
  argumentHint: '[off | select <serial|n> | install <path> | apk | package <name> | launch | stop | uninstall | clear | screenshot | record | pull | refresh]',
  title: 'adb',
  turnedOn: 'adb 켬',
  turnedOff: 'adb 끔',
  alreadyOff: 'adb가 이미 꺼져 있습니다',
  failed: 'adb를 실행하지 못했습니다. 디버그 로그를 보세요',
  badPackage: arg => `패키지 이름이 아닙니다: ${arg}`,
  badSerial: arg => `단말 시리얼이 아닙니다: ${arg}`,
  noSuchDevice: arg => `${arg}에 맞는 연결된 단말이 없습니다`,
  selected: label => `단말: ${label}`,
  queued: file => `${file}이(가) adb 패널에서 기다립니다. 패널에서 i를 누르면 설치합니다`,
  noSuchFile: path => `파일이 없습니다: ${path}`,
  packageSet: pkg => `패키지: ${pkg}`,
  nothingPending: '대기 중인 APK가 없습니다. 터미널에 apk를 끌어다 놓거나 /adb install <경로>',
  refreshed: '새로 고쳤습니다',
  noAdb: 'adb를 찾을 수 없습니다. PATH에 두거나 ANDROID_HOME을 설정하세요',
  noDevice: '연결된 단말이 없습니다',
  pickDevice: '단말이 여러 대입니다. d를 눌러 고르세요',
  needDevice: '먼저 단말을 고르세요',
  needPackage: '패키지를 모릅니다: /adb package <이름>',
  toolOff: 'adb가 꺼져 있습니다. 먼저 /adb를 실행해 달라고 하세요.',
  notAndroidRepo: '안드로이드 레포가 아닙니다',
  noApks: 'build 폴더에 APK가 없습니다. 먼저 빌드하세요',
  packageNotSet: '패키지가 없습니다: /adb package <이름>, 또는 안드로이드 레포를 여세요',
  dropHint: '터미널에 .apk를 끌어다 놓거나 /adb install <경로>',
  device: '단말',
  app: '앱',
  install: '설치',
  last: '최근',
  capture: '캡처',
  connected: n => `${n}대 연결`,
  usb: 'USB',
  wifi: 'Wi-Fi',
  unauthorized: '승인 필요: 단말의 확인 창을 수락하세요',
  offline: '오프라인',
  batteryLabel: '배터리',
  storageLabel: '저장공간',
  freeOf: (free, total) => `${total} 중 ${free} 여유`,
  screenOn: '화면 켜짐',
  screenOff: '화면 꺼짐',
  api: (release, sdk) => `Android ${release} (API ${sdk})`,
  installedState: '설치됨',
  notInstalled: '미설치',
  disabled: '비활성',
  running: pid => `실행 중 (pid ${pid})`,
  updated: stamp => `업데이트 ${stamp}`,
  firstInstalled: stamp => `설치 ${stamp}`,
  version: (name, code) => `v${name} (${code})`,
  builtAt: stamp => `빌드 ${stamp}`,
  pendingFile: file => `${file} 대기 중`,
  installing: (file, seconds) => `${file} 설치 중… ${seconds}초`,
  failedLine: code => `실패 ${code}`,
  askDowngrade: '-d(다운그레이드 허용)를 붙여 다시 설치할까요?',
  askTestOnly: '-t(테스트 전용 APK 허용)를 붙여 다시 설치할까요?',
  askReinstall: pkg => `${pkg}을(를) 삭제(앱 데이터 사라짐)하고 다시 설치할까요?`,
  askRetry: message => `${message || '설치 실패'} — 다시 시도할까요?`,
  downgradeAfterD: '-d를 붙여도 다운그레이드 거부',
  downgradeRelease: 'release 빌드는 다운그레이드할 수 없음',
  askUninstall: pkg => `${pkg}을(를) 삭제할까요? 앱 데이터가 사라집니다.`,
  askClear: pkg => `${pkg}의 데이터를 모두 지울까요?`,
  recording: clock => `녹화 중 ${clock}`,
  savedTo: dir => `→ ${dir}`,
  yes: '예',
  no: '아니요',
  refresh: '새로 고침',
  switchDevice: '단말 바꾸기',
  launch: '실행',
  stop: '종료',
  uninstall: '삭제',
  clearData: '데이터 초기화',
  installButton: '설치',
  pickApk: 'APK 고르기',
  cancel: '취소',
  screenshot: '스크린샷',
  record: '녹화',
  stopRecord: '녹화 정지',
  pullApk: 'APK 추출',
  shotLabel: '화면',
  videoLabel: '녹화',
  apkLabel: 'APK',
  open: '열기',
  reveal: '폴더',
  play: '\u25b6 재생',
  stopPlay: '\u25a0 정지',
  closeItem: '닫기',
  openFailed: '파일을 열지 못했습니다',
  preparing: '프레임 준비 중\u2026',
  playing: clock => `재생 중 ${clock}`,
  splits: count => `split ${count}개`,
  noFfmpeg: 'ffmpeg가 없어 시스템 플레이어로 엽니다',
  installed: (pkg, version) => `${pkg} ${version} 설치됨`,
  installFailed: (code, message) => `설치 실패: ${code}${message ? ` (${message})` : ''}`,
  retryHint: flag => `adb 패널에서 y를 누르거나 ${flag}로 apk_install을 다시 부르면 재시도합니다.`,
  reinstallHint: 'adb 패널에서 y를 누르면 설치된 앱을 삭제(데이터 사라짐, 시스템 앱은 공장 버전으로 복귀)하고 다시 설치합니다.',
  launched: pkg => `${pkg} 실행함`,
  launchFailed: pkg => `${pkg}을(를) 실행하지 못했습니다. 런처 액티비티가 없거나 미설치입니다`,
  stopped: pkg => `${pkg} 종료함`,
  uninstalled: pkg => `${pkg} 삭제함`,
  uninstallFailed: (pkg, reason) => `${pkg}을(를) 삭제하지 못했습니다: ${reason}`,
  cleared: pkg => `${pkg}의 데이터를 지웠습니다`,
  clearFailed: pkg => `${pkg}의 데이터를 지우지 못했습니다`,
  screenshotSaved: path => `스크린샷 저장: ${path}`,
  recordingStarted: '녹화 중. v를 다시 누르면 멈춥니다(최대 3분)',
  recordingSaved: path => `녹화 저장: ${path}`,
  captureFailed: '캡처에 실패했습니다. 디버그 로그를 보세요',
  noForeground: '포그라운드에 앱이 없습니다',
  pulled: (pkg, path) => `${pkg} 추출: ${path}`,
  pulledSplits: (pkg, count, dir) => `${pkg} 추출: 파일 ${count}개(base와 split)를 ${dir}에 저장`,
  pullFailed: pkg => `${pkg}을(를) 추출하지 못했습니다`,
  busy: '다른 설치나 캡처가 진행 중입니다',
  statusLine: (model, pkg, version) => `adb ${model}${pkg ? ` · ${pkg}${version ? ` ${version}` : ''}` : ''}`,
  statusInstalling: file => `adb ${file} 설치 중…`,
  statusRecording: clock => `adb 녹화 중 ${clock}`,
  toolDeviceList: 'adb가 보는 안드로이드 단말 목록: 시리얼, 모델, 상태, adb 패널이 고른 단말.',
  toolApkList: '작업 디렉터리의 build 폴더 아래 APK 파일 목록, 최신순.',
  toolApkInstall: '고른 단말에 APK를 설치합니다(adb install -r). 실패하면 이유와 재시도에 붙을 플래그를 알려 줍니다. allowDowngrade·allowTestOnly는 사용자가 동의한 뒤에만 넘기세요.',
  toolPackageInfo: '고른 단말에 설치된 패키지의 상태: 버전 이름·코드, 설치·업데이트 시각, 설치 경로, 실행 여부. 기본은 레포의 앱.',
  toolAppLaunch: '고른 단말에서 패키지를 실행합니다. 기본은 레포의 앱.',
  toolAppStop: '고른 단말에서 패키지를 강제 종료합니다. 기본은 레포의 앱.',
  toolScreenshot: '고른 단말의 스크린샷을 찍고 저장된 파일 경로를 알려 줍니다.',
  toolApkPull: '고른 단말에서 포그라운드 앱(또는 지정한 패키지)의 APK를 캡처 폴더로 추출하고 저장 경로를 알려 줍니다. split APK는 여러 파일로 나옵니다.',
  noneConnected: '연결된 단말이 없습니다',
  noneInstalledInfo: pkg => `${pkg}이(가) 단말에 없습니다`,
}

const TABLES: Record<Language, Strings> = { en: EN, ko: KO }

let current: Strings = EN

export function setLanguage(language: unknown) {
  current = TABLES[language === 'ko' ? 'ko' : 'en']
}

export function t(): Strings {
  return current
}
