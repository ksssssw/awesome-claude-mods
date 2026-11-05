import { expect, test } from 'claude-code/testing'

import {
  applicationIdFrom,
  applicationIdsFrom,
  chooseCandidate,
  cutCells,
  installedCandidates,
  parseResumedPackage,
  parseVersionCatalog,
  textWidth,
  windowOf,
  wrapMessage,
  formatLine,
  isPackageName,
  logcatArgv,
  parseDevices,
  parseLine,
  parsePackageList,
  passesFilter,
  pickPackage,
  RingBuffer,
  splitLines,
  stampOf,
  styleOf,
  tail,
} from '../hooks/model'

const LINE = '11-02 14:03:21.123  1234  5678 D MyTag   : hello world'

test('a threadtime line parses into its fields', async () => {
  const entry = parseLine(LINE)
  expect(entry).toBeDefined()
  expect(entry?.date).toBe('11-02')
  expect(entry?.time).toBe('14:03:21.123')
  expect(stampOf(entry!)).toBe('11-02 14:03:21.123')
  expect(entry?.pid).toBe(1234)
  expect(entry?.tid).toBe(5678)
  expect(entry?.level).toBe('D')
  expect(entry?.tag).toBe('MyTag')
  expect(entry?.message).toBe('hello world')
  expect(formatLine(entry!)).toBe('14:03:21.123  D/MyTag: hello world')
})

test('buffer headers, silent lines and noise are dropped; assert reads as fatal', async () => {
  expect(parseLine('--------- beginning of main')).toBeUndefined()
  expect(parseLine('11-02 14:03:21.123  1234  5678 S Tag: x')).toBeUndefined()
  expect(parseLine('not a logcat line')).toBeUndefined()
  expect(parseLine('11-02 14:03:21.123  1234  5678 A DEBUG   : crash')?.level).toBe('F')
  expect(parseLine('11-02 14:03:21.123  1234  5678 I Tag     : ')?.message).toBe('')
})

test('chunks cut mid-line are joined at the next chunk', async () => {
  const first = splitLines('', 'a\nb\npart')
  expect(first.lines).toEqual(['a', 'b'])
  expect(first.carry).toBe('part')
  const second = splitLines(first.carry, 'ial\r\nc\n')
  expect(second.lines).toEqual(['partial', 'c'])
  expect(second.carry).toBe('')
})

test('the filter keeps the level floor and matches tag or message without case', async () => {
  const entry = parseLine(LINE)!
  expect(passesFilter(entry, 'V', '')).toBe(true)
  expect(passesFilter(entry, 'D', '')).toBe(true)
  expect(passesFilter(entry, 'I', '')).toBe(false)
  expect(passesFilter(entry, 'V', 'mytag')).toBe(true)
  expect(passesFilter(entry, 'V', 'WORLD')).toBe(true)
  expect(passesFilter(entry, 'V', 'nope')).toBe(false)
})

test('tail answers the newest matching lines, oldest first', async () => {
  const entries = ['V', 'E', 'W', 'E', 'D'].map((l, i) => parseLine(`11-02 14:03:2${i}.000  1 1 ${l} T: m${i}`)!)
  expect(tail(entries, 'W', '', 10).map(e => e.message)).toEqual(['m1', 'm2', 'm3'])
  expect(tail(entries, 'W', '', 2).map(e => e.message)).toEqual(['m2', 'm3'])
})

test('warnings, errors and fatals color the whole line; the rest only the head', async () => {
  expect(styleOf('V')).toEqual({ color: '#BBBBBB', isWhole: false, isBold: false, isDim: true })
  expect(styleOf('D').isWhole).toBe(false)
  expect(styleOf('I').isWhole).toBe(false)
  expect(styleOf('W')).toEqual({ color: '#BBB529', isWhole: true, isBold: false, isDim: false })
  expect(styleOf('E').color).toBe('#FF6B68')
  expect(styleOf('F').isBold).toBe(true)
})

test('the ring buffer keeps its newest entries', async () => {
  const ring = new RingBuffer<number>(3)
  for (let i = 0; i < 10; i++) ring.push(i)
  expect(ring.toArray()).toEqual([7, 8, 9])
  expect(ring.size).toBe(3)
  ring.clear()
  expect(ring.toArray()).toEqual([])
})

test('applicationId is read from groovy and kotlin gradle files, never the suffix', async () => {
  const groovy = `android {\n  defaultConfig {\n    applicationId "com.example.app"\n    applicationIdSuffix ".debug"\n  }\n}`
  const kts = `android {\n    defaultConfig {\n        applicationId = "com.example.kts"\n    }\n    buildTypes { debug { applicationIdSuffix = ".debug" } }\n}`
  expect(applicationIdFrom(groovy)).toBe('com.example.app')
  expect(applicationIdFrom(kts)).toBe('com.example.kts')
  expect(applicationIdFrom(`buildTypes { debug { applicationIdSuffix = ".debug" } }`)).toBeUndefined()
  expect(applicationIdFrom('plugins { id("com.android.library") }')).toBeUndefined()
})

test('the installed package is the base id, else its first flavor', async () => {
  const installed = parsePackageList('package:com.example.app.debug uid:10234\npackage:com.example.app uid:10235\npackage:com.example.apple uid:10236\n')
  expect(installed).toHaveLength(3)
  const exact = pickPackage(installed, 'com.example.app')
  expect(exact?.chosen).toEqual({ name: 'com.example.app', uid: 10235 })
  expect(exact?.candidates.map(p => p.name)).toEqual(['com.example.app.debug', 'com.example.app'])
  const flavor = pickPackage(installed.filter(p => p.name !== 'com.example.app'), 'com.example.app')
  expect(flavor?.chosen.name).toBe('com.example.app.debug')
  expect(pickPackage(installed, 'com.other')).toBeUndefined()
})

test('adb devices lists only devices that are ready, with their model', async () => {
  const out = 'List of devices attached\nR3CY40JZPDM            device usb:538050560X product:q7qksx model:SM_F966N device:q7q transport_id:1\nemulator-5554          offline\n\n'
  expect(parseDevices(out)).toEqual([{ serial: 'R3CY40JZPDM', model: 'SM F966N' }])
})

test('the logcat command filters by uid, else by pid, else not at all, and resumes from a stamp', async () => {
  expect(logcatArgv('adb', 'S', { uid: 10 }, 500)).toEqual(['adb', '-s', 'S', 'logcat', '-v', 'threadtime', '-T', '500', '--uid=10'])
  expect(logcatArgv('adb', 'S', { pid: 7 }, 500)).toContain('--pid=7')
  expect(logcatArgv('adb', 'S', {}, 500)).toHaveLength(8)
  expect(logcatArgv('adb', 'S', {}, '11-02 14:03:21.123')).toContain('11-02 14:03:21.123')
})

test('a package name holds letters, digits, dots and underscores alone', async () => {
  expect(isPackageName('com.example.app_2')).toBe(true)
  expect(isPackageName('com.x; reboot')).toBe(false)
  expect(isPackageName('com.x rm')).toBe(false)
  expect(isPackageName('')).toBe(false)
})

test('build files name their app ids as literals or version catalog references', async () => {
  const catalog = parseVersionCatalog('# ids\n[versions]\nandroidApplicationId = "com.real.store" # main\nhub-application-id = \'com.real.hub\'\n[libraries]\nx = "not.a.version"\n')
  expect(catalog).toEqual({ androidapplicationid: 'com.real.store', hubapplicationid: 'com.real.hub' })
  const kts = [
    'defaultConfig { applicationId = libs.versions.androidApplicationId.get() }',
    'getByName("hub") { applicationId = libs.versions.hub.application.id.get() }',
    'getByName("same") { applicationId = libs.versions.androidApplicationId.get() }',
    'getByName("lost") { applicationId = libs.versions.missing.get() }',
    'getByName("lit") { applicationId = "com.lit"; applicationIdSuffix = ".dev" }',
  ].join('\n')
  expect(applicationIdsFrom(kts, catalog)).toEqual(['com.real.store', 'com.real.hub', 'com.lit'])
  expect(applicationIdsFrom('applicationId libs.versions.androidApplicationId\n', catalog)).toEqual(['com.real.store'])
  expect(applicationIdsFrom('applicationId "com.groovy"', {})).toEqual(['com.groovy'])
})

test('the repo apps on the device keep the order found, flavors after their base, the one on screen chosen', async () => {
  const installed = parsePackageList('package:com.b uid:2\npackage:com.a.debug uid:3\npackage:com.a uid:1\npackage:com.z uid:9\n')
  const found = installedCandidates(installed, ['com.sample', 'com.a', 'com.b', 'com.a.debug'])
  expect(found.map(p => p.name)).toEqual(['com.a', 'com.a.debug', 'com.b'])
  expect(chooseCandidate(found, 'com.b')?.name).toBe('com.b')
  expect(chooseCandidate(found, 'com.z')?.name).toBe('com.a')
  expect(chooseCandidate([], 'com.z')).toBeUndefined()
})

test('the resumed activity names the package on screen', async () => {
  expect(parseResumedPackage('  topResumedActivity=ActivityRecord{8f2 u0 com.x.app/.ui.Main t31}\n')).toBe('com.x.app')
  expect(parseResumedPackage('    mResumedActivity: ActivityRecord{1 u0 com.y/com.y.Splash t2}')).toBe('com.y')
  expect(parseResumedPackage('nothing here')).toBeUndefined()
})

test('wrapping counts wide characters as two cells and indents the later rows under the time', async () => {
  expect(textWidth('a한b')).toBe(4)
  expect(cutCells('가나다라', 4, 4)).toEqual(['가나', '다라'])
  expect(cutCells('', 4, 4)).toEqual([''])
  const entry = parseLine('11-02 14:03:21.123  1234  5678 D Tag     : 0123456789abcdefghij')!
  // `14:03:21.123  D/Tag: ` is 21 cells: 9 left on the first row of 30, 16 on each later one
  expect(wrapMessage(entry, 30)).toEqual(['012345678', '9abcdefghij'])
})

test('the window fills its rows back from the offset, cutting a tall first line at the top', async () => {
  expect(windowOf([1, 1, 1, 1], 0, 2)).toEqual({ start: 2, end: 4, cut: 0 })
  expect(windowOf([1, 3, 1], 0, 3)).toEqual({ start: 1, end: 3, cut: 1 })
  expect(windowOf([2, 2], 1, 5)).toEqual({ start: 0, end: 1, cut: 0 })
})
