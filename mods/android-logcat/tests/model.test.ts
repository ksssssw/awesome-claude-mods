import { expect, test } from 'claude-code/testing'

import {
  applicationIdFrom,
  formatLine,
  logcatArgv,
  parseDevices,
  parseLine,
  parsePackageList,
  passesFilter,
  pickPackage,
  RingBuffer,
  splitLines,
  styleOf,
  tail,
} from '../hooks/model'

const LINE = '11-02 14:03:21.123  1234  5678 D MyTag   : hello world'

test('a threadtime line parses into its fields', async () => {
  const entry = parseLine(LINE)
  expect(entry).toBeDefined()
  expect(entry?.time).toBe('14:03:21.123')
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

test('the logcat command filters by uid, else by pid, else not at all', async () => {
  expect(logcatArgv('adb', 'S', { uid: 10 }, 500)).toEqual(['adb', '-s', 'S', 'logcat', '-v', 'threadtime', '-T', '500', '--uid=10'])
  expect(logcatArgv('adb', 'S', { pid: 7 }, 500)).toContain('--pid=7')
  expect(logcatArgv('adb', 'S', {}, 500)).toHaveLength(8)
})
