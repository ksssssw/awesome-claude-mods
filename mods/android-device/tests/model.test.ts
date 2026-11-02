import { expect, test } from 'claude-code/testing'

import {
  apkPathOf,
  applicationIdsFrom,
  barCells,
  captureName,
  chooseSerial,
  classifyFailure,
  flagOf,
  isApplicationModule,
  isPackageName,
  isSerial,
  newestVersion,
  parseBadging,
  parseBattery,
  parseDevices,
  parseDf,
  parseDumpsysPackage,
  parseScreen,
  parsePmPath,
  foregroundPackage,
  pulledName,
  refineFailure,
  sortApks,
} from '../hooks/model'

const DEVICES = [
  'List of devices attached',
  'R3CY40JZPDM            device usb:1-1 product:q7qksx model:SM_F966N device:q7q transport_id:3',
  '192.168.0.5:5555       device product:panther model:Pixel_7 device:panther transport_id:5',
  'emulator-5554          unauthorized transport_id:7',
  'ZY22GXXXX              offline usb:2-1 transport_id:9',
  '',
].join('\n')

test('parseDevices reads the state, the model and the transport of each line', async () => {
  const list = parseDevices(DEVICES)
  expect(list).toHaveLength(4)
  expect(list[0]).toEqual({ serial: 'R3CY40JZPDM', state: 'device', model: 'SM F966N', transport: 'usb' })
  expect(list[1]).toEqual({ serial: '192.168.0.5:5555', state: 'device', model: 'Pixel 7', transport: 'wifi' })
  expect(list[2]?.state).toBe('unauthorized')
  expect(list[3]?.state).toBe('offline')
  expect(list[3]?.transport).toBe('usb')
})

test('chooseSerial keeps the chosen device, falls back to the preferred one, picks a lone device and else none', async () => {
  const list = parseDevices(DEVICES)
  expect(chooseSerial(list, '192.168.0.5:5555', '')).toBe('192.168.0.5:5555')
  expect(chooseSerial(list, 'gone', 'R3CY40JZPDM')).toBe('R3CY40JZPDM')
  expect(chooseSerial(list, '', '')).toBe('')
  expect(chooseSerial(list, 'emulator-5554', '')).toBe('')
  expect(chooseSerial(list.slice(0, 1), '', '')).toBe('R3CY40JZPDM')
  expect(chooseSerial([], 'R3CY40JZPDM', '')).toBe('')
})

test('a serial or a package the device shell could misread is refused', async () => {
  expect(isSerial('192.168.0.5:5555')).toBe(true)
  expect(isSerial('emulator-5554')).toBe(true)
  expect(isSerial('x; reboot')).toBe(false)
  expect(isPackageName('com.example.app_1')).toBe(true)
  expect(isPackageName('com.x; reboot')).toBe(false)
})

test('apkPathOf takes one .apk path alone, quoted or with escaped spaces, and nothing else', async () => {
  expect(apkPathOf('/builds/app-debug.apk')).toBe('/builds/app-debug.apk')
  expect(apkPathOf('  /builds/app-debug.apk\n')).toBe('/builds/app-debug.apk')
  expect(apkPathOf('/My\\ Builds/app\\ (1).apk')).toBe('/My Builds/app (1).apk')
  expect(apkPathOf("'/My Builds/app.apk'")).toBe('/My Builds/app.apk')
  expect(apkPathOf('"/My Builds/app.APK"')).toBe('/My Builds/app.APK')
  expect(apkPathOf('install /builds/app-debug.apk')).toBeUndefined()
  expect(apkPathOf('/builds/app-debug.zip')).toBeUndefined()
  expect(apkPathOf('look at /builds/app-debug.apk please')).toBeUndefined()
  expect(apkPathOf('')).toBeUndefined()
})

test('classifyFailure names the code and what a retry would add', async () => {
  const down = classifyFailure('adb: failed to install app.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Update version code 10 is older than current 12]')
  expect(down.code).toBe('INSTALL_FAILED_VERSION_DOWNGRADE')
  expect(down.retry).toBe('downgrade')
  expect(down.message).toContain('older than current')
  expect(flagOf(down.retry)).toBe('-d')

  const testOnly = classifyFailure('Failure [INSTALL_FAILED_TEST_ONLY: installPackageLI]')
  expect(testOnly.retry).toBe('test-only')
  expect(flagOf(testOnly.retry)).toBe('-t')

  const signed = classifyFailure('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.x signatures do not match newer version; ignoring!]')
  expect(signed.retry).toBe('reinstall')
  expect(flagOf(signed.retry)).toBeUndefined()

  const full = classifyFailure('Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]')
  expect(full.code).toBe('INSTALL_FAILED_INSUFFICIENT_STORAGE')
  expect(full.retry).toBe('same')

  const gone = classifyFailure('adb: device offline')
  expect(gone.code).toBe('DEVICE_OFFLINE')
  expect(gone.retry).toBe('same')
})

const DUMPSYS = [
  'Packages:',
  '  Package [com.example.app.debug] (5a1b2c3):',
  '    userId=10234',
  '    pkg=Package{1234 com.example.app.debug}',
  '    codePath=/data/app/~~x==/com.example.app.debug-y==',
  '    versionCode=2310 minSdk=24 targetSdk=34',
  '    versionName=2.3.1',
  '    timeStamp=2026-11-02 14:20:11',
  '    firstInstallTime=2026-10-01 09:00:00',
  '    lastUpdateTime=2026-11-02 14:20:11',
  '    installerPackageName=null',
  '    User 0: ceDataInode=1 installed=true hidden=false suspended=false stopped=false notLaunched=false enabled=0 instant=false virtual=false',
].join('\n')

test('parseDumpsysPackage reads the version, the times and whether the app is enabled', async () => {
  const info = parseDumpsysPackage(DUMPSYS, 'com.example.app.debug')
  expect(info).toBeDefined()
  expect(info?.versionName).toBe('2.3.1')
  expect(info?.versionCode).toBe(2310)
  expect(info?.firstInstall).toBe('2026-10-01 09:00:00')
  expect(info?.lastUpdate).toBe('2026-11-02 14:20:11')
  expect(info?.installer).toBeUndefined()
  expect(info?.isEnabled).toBe(true)
  expect(parseDumpsysPackage(DUMPSYS.replace('enabled=0', 'enabled=2'), 'com.example.app.debug')?.isEnabled).toBe(false)
  expect(parseDumpsysPackage('Unable to find package: com.other', 'com.other')).toBeUndefined()
})

test('the device readings parse battery, screen and free space', async () => {
  expect(parseBattery('Current Battery Service state:\n  AC powered: false\n  level: 82\n  scale: 100')).toBe(82)
  expect(parseScreen('Display Power: state=ON\nmWakefulness=Awake')).toBe('on')
  expect(parseScreen('Display Power: state=OFF')).toBe('off')
  expect(parseScreen('mWakefulness=Asleep')).toBe('off')
  expect(parseScreen('nothing here')).toBeUndefined()
  expect(parseDf('Filesystem      1K-blocks     Used Available Use% Mounted on\n/dev/block/dm-5 112345678 42000000  22347776  66% /data')).toEqual({ freeBytes: 22347776 * 1024, totalBytes: 112345678 * 1024 })
  expect(parseDf('df: /data: Permission denied')).toBeUndefined()
  expect(barCells(0.82, 10)).toBe(8)
  expect(barCells(0.01, 10)).toBe(1)
  expect(barCells(0, 10)).toBe(0)
  expect(barCells(1.5, 10)).toBe(10)
})

test('parseBadging reads the package and the versions of an APK', async () => {
  const out = "package: name='com.example.app' versionCode='2310' versionName='2.3.1' platformBuildVersionName='14'\nsdkVersion:'24'"
  expect(parseBadging(out)).toEqual({ package: 'com.example.app', versionCode: 2310, versionName: '2.3.1', isDebuggable: false })
  expect(parseBadging(out + '\napplication-debuggable\n')?.isDebuggable).toBe(true)
  expect(parseBadging('ERROR: dump failed')).toBeUndefined()
})

test('a downgrade -d cannot do becomes the uninstall-and-install question', async () => {
  const down = classifyFailure('Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Update version code 10 is older than current 12]')
  const messages = { afterD: 'still a downgrade with -d', release: 'a release build cannot be downgraded' }
  const debug = { package: 'com.x', isDebuggable: true }
  const release = { package: 'com.x', isDebuggable: false }
  expect(refineFailure(down, [], debug, messages).retry).toBe('downgrade')
  expect(refineFailure(down, [], undefined, messages).retry).toBe('downgrade')
  expect(refineFailure(down, [], release, messages)).toEqual({ ...down, retry: 'reinstall', message: messages.release })
  expect(refineFailure(down, ['-d'], debug, messages)).toEqual({ ...down, retry: 'reinstall', message: messages.afterD })
  const other = classifyFailure('Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]')
  expect(refineFailure(other, ['-d'], release, messages)).toBe(other)
})

test('the gradle readers find every applicationId and the application plugin', async () => {
  const kts = 'plugins {\n  alias(libs.plugins.android.application)\n}\nandroid {\n  defaultConfig { applicationId = "com.example.app" }\n  productFlavors { create("beta") { applicationIdSuffix = ".beta" } }\n}'
  expect(applicationIdsFrom(kts)).toEqual(['com.example.app'])
  expect(isApplicationModule(kts)).toBe(true)
  const groovy = "apply plugin: 'com.android.library'\nandroid { defaultConfig { applicationId \"com.example.lib\" } }"
  expect(isApplicationModule(groovy)).toBe(false)
  expect(applicationIdsFrom(groovy)).toEqual(['com.example.lib'])
})

test('APKs sort newest first and build-tools pick the highest version', async () => {
  const sorted = sortApks([
    { path: '/r/app/build/outputs/apk/release/app-release.apk', size: 1, mtimeMs: 100 },
    { path: '/r/app/build/outputs/apk/debug/app-debug.apk', size: 1, mtimeMs: 300 },
  ])
  expect(sorted[0]?.path).toContain('app-debug.apk')
  expect(newestVersion(['33.0.2', '35.0.0', '34.0.0', 'debian'])).toBe('35.0.0')
  expect(newestVersion([])).toBeUndefined()
})

test('captureName folds the model into a file name with the time', async () => {
  const at = new Date(2026, 10, 2, 14, 20, 11)
  expect(captureName('SM F966N', at, 'png')).toBe('SM_F966N_20261102-142011.png')
  expect(captureName(undefined, at, 'mp4')).toBe('device_20261102-142011.mp4')
})

test('the foreground app and its APK paths are read from dumpsys and pm path', async () => {
  const activities = '    topResumedActivity=ActivityRecord{23586482 u0 com.example.app/.MainActivity t1784}\n  ResumedActivity: ActivityRecord{23586482 u0 com.example.app/.MainActivity t1784}'
  expect(foregroundPackage(activities)).toBe('com.example.app')
  expect(foregroundPackage('    mResumedActivity: ActivityRecord{1 u0 com.old.app/.Main t3}')).toBe('com.old.app')
  expect(foregroundPackage('nothing')).toBeUndefined()
  const paths = parsePmPath('package:/data/app/~~x==/com.example.app-y==/base.apk\npackage:/data/app/~~x==/com.example.app-y==/split_config.en.apk\n')
  expect(paths).toHaveLength(2)
  expect(pulledName('com.example.app', '2.3.1', 2310, paths[0]!)).toBe('com.example.app_2.3.1_2310.apk')
  expect(pulledName('com.example.app', '2.3.1', 2310, paths[1]!)).toBe('com.example.app_2.3.1_2310_split_config.en.apk')
  expect(pulledName('com.example.app', undefined, undefined, paths[0]!)).toBe('com.example.app.apk')
})
