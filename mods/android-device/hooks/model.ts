// Pure functions of the device mod: parsing adb's output, telling an APK path from a prompt,
// classifying an install failure, naming a capture. Nothing here touches the engine.

import type { Failure, Retry } from '../types'

export type DeviceState = 'device' | 'unauthorized' | 'offline' | 'other'
export type Transport = 'usb' | 'wifi' | 'unknown'

export type Device = { serial: string; state: DeviceState; model?: string; transport: Transport }

// `adb devices -l`: "R3CY40JZPDM   device usb:1-1 product:q7qksx model:SM_F966N device:q7q transport_id:3"
// A Wi-Fi device is "192.168.0.5:5555" or "adb-R3CY..._tcp." and carries no usb: field
export function parseDevices(out: string): Device[] {
  const list: Device[] = []
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    const m = /^(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(line)
    const serial = m?.[1]
    const word = m?.[2]
    if (!m || !serial || !word || serial === 'List' || serial.startsWith('*')) continue
    const rest = m[3] ?? ''
    const state: DeviceState = word === 'device' || word === 'unauthorized' || word === 'offline' ? word : 'other'
    const model = /model:(\S+)/.exec(rest)?.[1]?.replace(/_/g, ' ')
    const isTcp = /:\d+$/.test(serial) || serial.includes('_tcp')
    const transport: Transport = /\busb:/.test(rest) ? 'usb' : isTcp ? 'wifi' : 'unknown'
    list.push({ serial, state, model, transport })
  }
  return list
}

// Keeps the chosen device while it is online; else the preferred one when it is; else the only online one; else none
export function chooseSerial(devices: readonly Device[], chosen: string, preferred: string): string {
  const online = devices.filter(d => d.state === 'device')
  if (chosen && online.some(d => d.serial === chosen)) return chosen
  if (preferred && online.some(d => d.serial === preferred)) return preferred
  return online.length === 1 ? online[0]!.serial : ''
}

// A serial as adb's -s takes it: letters, digits, dots, colons, dashes and underscores alone
export function isSerial(value: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(value)
}

// A package name as adb's shell may see it: letters, digits, dots and underscores alone
export function isPackageName(value: string): boolean {
  return /^[A-Za-z0-9_.]+$/.test(value)
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

// `applicationId "com.x"` or `applicationId = "com.x"` in a build.gradle(.kts);
// `applicationIdSuffix` does not match since a word character follows the name
const APPLICATION_ID = /\bapplicationId\s*=?\s*["']([A-Za-z0-9_.]+)["']/g

export function applicationIdsFrom(gradle: string): string[] {
  const ids: string[] = []
  for (const m of gradle.matchAll(APPLICATION_ID)) {
    const id = m[1]
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

// A build.gradle(.kts) that applies the application plugin: `id("com.android.application")`,
// `apply plugin: 'com.android.application'` or the `alias(libs.plugins.android.application)` form
export function isApplicationModule(gradle: string): boolean {
  return /com\.android\.application|alias\(\s*libs\.plugins\.android\.application\s*\)|\bandroidApplication\b/.test(gradle)
}

export type DeviceInfo = {
  model?: string
  manufacturer?: string
  release?: string
  sdk?: string
  battery?: number
  screen?: 'on' | 'off'
  storage?: Storage
}

export type Storage = { freeBytes: number; totalBytes: number }

// `dumpsys battery`: "  level: 82"
export function parseBattery(out: string): number | undefined {
  const n = Number(/^\s*level:\s*(\d+)/m.exec(out)?.[1])
  return Number.isInteger(n) ? n : undefined
}

// `dumpsys power`: "mWakefulness=Awake" (older) or "Display Power: state=ON" (newer)
export function parseScreen(out: string): 'on' | 'off' | undefined {
  const display = /Display Power: state=(\w+)/.exec(out)?.[1]
  if (display) return display === 'ON' || display === 'VR' ? 'on' : 'off'
  const wake = /mWakefulness=(\w+)/.exec(out)?.[1]
  if (wake) return wake === 'Awake' || wake === 'Dreaming' ? 'on' : 'off'
  return undefined
}

// `df /data`: "Filesystem  1K-blocks  Used  Available Use% Mounted on\n/dev/block/dm-5 112 42 70 38% /data"
export function parseDf(out: string): Storage | undefined {
  const lines = out.trim().split(/\r?\n/)
  const row = lines.find((line, i) => i > 0 && /^\S+\s+\d+\s+\d+\s+\d+/.test(line))
  const cols = row?.trim().split(/\s+/)
  const total = Number(cols?.[1])
  const available = Number(cols?.[3])
  if (!Number.isFinite(total) || !Number.isFinite(available) || total <= 0) return undefined
  return { freeBytes: available * 1024, totalBytes: total * 1024 }
}

// How many of `width` cells a ratio fills: none below zero, all above one, at least one once anything is there
export function barCells(ratio: number, width: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0
  if (ratio >= 1) return width
  return Math.max(1, Math.round(ratio * width))
}

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

export type AppInfo = {
  package: string
  versionName?: string
  versionCode?: number
  firstInstall?: string
  lastUpdate?: string
  installer?: string
  isEnabled: boolean
  pid?: number
}

// `dumpsys package <pkg>`; undefined when the device has no such package
export function parseDumpsysPackage(out: string, pkg: string): AppInfo | undefined {
  if (!out.includes(`Package [${pkg}]`)) return undefined
  const section = out.slice(out.indexOf(`Package [${pkg}]`))
  const field = (name: string) => new RegExp(`^\\s*${name}=(\\S+)`, 'm').exec(section)?.[1]
  const versionCode = Number(field('versionCode'))
  const stamp = (name: string) => {
    const m = new RegExp(`^\\s*${name}=(\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d)`, 'm').exec(section)
    return m?.[1]
  }
  // `enabled=` under "User 0:": 0 default, 1 enabled, 2 disabled, 3 disabled by the user
  const enabled = /^\s*User \d+:.*\benabled=(\d)/m.exec(section)?.[1]
  const installer = field('installerPackageName')
  return {
    package: pkg,
    versionName: field('versionName'),
    versionCode: Number.isInteger(versionCode) ? versionCode : undefined,
    firstInstall: stamp('firstInstallTime'),
    lastUpdate: stamp('lastUpdateTime'),
    installer: installer && installer !== 'null' ? installer : undefined,
    isEnabled: enabled !== '2' && enabled !== '3',
  }
}

export type InstalledPackage = { name: string; uid: number }

// `cmd package list packages -U`: "package:com.x uid:10234" per line
export function parsePackageList(out: string): InstalledPackage[] {
  const list: InstalledPackage[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^package:(\S+)\s+uid:(\d+)/.exec(line.trim())
    if (m) list.push({ name: m[1] ?? '', uid: Number(m[2]) })
  }
  return list
}

// The base id itself when installed, else its first flavor (`base.debug`)
export function pickPackage(installed: readonly InstalledPackage[], base: string): string | undefined {
  const candidates = installed.filter(p => p.name === base || p.name.startsWith(base + '.'))
  return candidates.find(p => p.name === base)?.name ?? candidates[0]?.name
}

// `adb install` prints "Success", or "Failure [INSTALL_FAILED_X: detail]", or an adb error of its own
export function installSucceeded(output: string): boolean {
  return /^Success\b/m.test(output)
}

export function classifyFailure(output: string): Failure {
  const m = /Failure \[([A-Z_]+)(?::\s*([^\]]*))?\]/.exec(output)
  const code = m?.[1] ?? (/unauthorized/i.test(output) ? 'DEVICE_UNAUTHORIZED' : /offline/i.test(output) ? 'DEVICE_OFFLINE' : /no devices|device '.*' not found|not found/i.test(output) ? 'DEVICE_NOT_FOUND' : 'INSTALL_FAILED')
  const message = (m?.[2] ?? output.trim().split(/\r?\n/).filter(Boolean).pop() ?? '').trim()
  const retry: Retry =
    code === 'INSTALL_FAILED_VERSION_DOWNGRADE' ? 'downgrade'
    : code === 'INSTALL_FAILED_TEST_ONLY' ? 'test-only'
    : code === 'INSTALL_FAILED_UPDATE_INCOMPATIBLE' || code === 'INSTALL_FAILED_SHARED_USER_INCOMPATIBLE' ? 'reinstall'
    : 'same'
  return { code, message, retry }
}

// The flag a retry adds; a reinstall adds none, it uninstalls first
export function flagOf(retry: Retry): string | undefined {
  return retry === 'downgrade' ? '-d' : retry === 'test-only' ? '-t' : undefined
}

// The one `.apk` path a prompt holds, as a terminal drop pastes it: quoted, or spaces escaped with a backslash
export function apkPathOf(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '' || /[\r\n]/.test(trimmed)) return undefined
  const quoted = /^(["'])(.+)\1$/.exec(trimmed)
  let path: string
  if (quoted) path = quoted[2]!
  else {
    // A space not escaped means more than one word: not a path alone
    if (/(?<!\\)\s/.test(trimmed)) return undefined
    path = trimmed.replace(/\\(.)/g, '$1')
  }
  return /\.apk$/i.test(path) ? path : undefined
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '' : path.slice(0, i)
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/')
}

export function relativeTo(root: string, path: string): string {
  return path.startsWith(root + '/') ? path.slice(root.length + 1) : path
}

// `aapt dump badging`: "package: name='com.x' versionCode='2310' versionName='2.3.1' ..."
// `isDebuggable`: the "application-debuggable" line, which only a debug build prints
export type Badging = { package: string; versionCode?: number; versionName?: string; isDebuggable: boolean }

export function parseBadging(out: string): Badging | undefined {
  const name = /^package: .*?\bname='([^']+)'/m.exec(out)?.[1]
  if (!name) return undefined
  const code = Number(/\bversionCode='(\d+)'/.exec(out)?.[1])
  return {
    package: name,
    versionCode: Number.isInteger(code) ? code : undefined,
    versionName: /\bversionName='([^']*)'/.exec(out)?.[1],
    isDebuggable: /^application-debuggable/m.test(out),
  }
}

// A downgrade that `-d` cannot do: the flag was already there, or the APK is a release build, which a
// user-build device never downgrades. The way left is an uninstall (back to the factory copy, for a
// system app) and a fresh install, so the question changes to that one.
export function refineFailure(failure: Failure, flags: readonly string[], apk: Badging | undefined, messages: { afterD: string; release: string }): Failure {
  if (failure.retry !== 'downgrade') return failure
  if (flags.includes('-d')) return { ...failure, retry: 'reinstall', message: messages.afterD }
  if (apk && !apk.isDebuggable) return { ...failure, retry: 'reinstall', message: messages.release }
  return failure
}

export type Apk = { path: string; size: number; mtimeMs: number }

export function sortApks(list: readonly Apk[]): Apk[] {
  return [...list].sort((a, b) => b.mtimeMs - a.mtimeMs)
}

// "Pixel_7_20261102-142011.png": the model with its spaces folded, the local time, the extension
export function captureName(model: string | undefined, at: Date, ext: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  const base = (model ?? 'device').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'device'
  return `${base}_${stamp}.${ext}`
}

// "11-02 14:20" from a millisecond time, in local time
export function formatStamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// "11-02 14:20" from dumpsys's "2026-11-02 14:20:11"
export function shortStamp(stamp: string | undefined): string | undefined {
  const m = /^\d{4}-(\d\d-\d\d \d\d:\d\d)/.exec(stamp ?? '')
  return m?.[1]
}

export function formatDuration(ms: number): string {
  return ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// Build-tools folders are "34.0.0", "35.0.1": the highest wins
export function newestVersion(names: readonly string[]): string | undefined {
  const parse = (name: string) => name.split('.').map(part => Number.parseInt(part, 10) || 0)
  return [...names]
    .filter(name => /^\d+(\.\d+)*/.test(name))
    .sort((a, b) => {
      const x = parse(a)
      const y = parse(b)
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const diff = (y[i] ?? 0) - (x[i] ?? 0)
        if (diff !== 0) return diff
      }
      return 0
    })[0]
}

// `dumpsys activity activities`: "topResumedActivity=ActivityRecord{23586482 u0 com.x/.MainActivity t1784}" (older: "mResumedActivity:")
export function foregroundPackage(out: string): string | undefined {
  const m = /(?:topResumedActivity=|ResumedActivity: )ActivityRecord\{[^}]*?\su\d+\s([A-Za-z0-9_.]+)\//.exec(out)
  return m?.[1]
}

// `pm path <pkg>`: "package:/data/app/.../base.apk" per line, the splits after the base
export function parsePmPath(out: string): string[] {
  const paths: string[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^package:(\S+)$/.exec(line.trim())
    if (m?.[1]) paths.push(m[1])
  }
  return paths
}

// "com.x_2.3.1_2310.apk", or for a split "com.x_2.3.1_2310_split_config.en.apk"
export function pulledName(pkg: string, versionName: string | undefined, versionCode: number | undefined, remote: string): string {
  const stem = [pkg, versionName, versionCode].filter(v => v !== undefined && v !== '').join('_').replace(/[^A-Za-z0-9_.-]+/g, '_')
  const file = basename(remote)
  return file === 'base.apk' ? `${stem}.apk` : `${stem}_${file}`
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// A PNG's width and height from its IHDR, read off the first 32 base64 characters; undefined when it is not a PNG
export function pngSize(base64: string): { width: number; height: number } | undefined {
  const head = base64.slice(0, 32)
  if (head.length < 32) return undefined
  const bytes: number[] = []
  for (let i = 0; i < 32; i += 4) {
    const n = [0, 1, 2, 3].map(k => B64.indexOf(head[i + k] ?? ''))
    if (n.some(v => v < 0)) return undefined
    const v = (n[0]! << 18) | (n[1]! << 12) | (n[2]! << 6) | n[3]!
    bytes.push((v >> 16) & 255, (v >> 8) & 255, v & 255)
  }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (sig.some((b, i) => bytes[i] !== b)) return undefined
  const u32 = (at: number) => ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!
  const width = u32(16)
  const height = u32(20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

// The cells a picture of width x height takes within maxColumns x maxRows, a cell being about twice as tall as wide
export function fitCells(width: number, height: number, maxColumns: number, maxRows: number): { columns: number; rows: number } {
  const clamp = (n: number) => Math.max(1, Math.min(255, Math.round(n)))
  const ratio = (2 * width) / height
  let rows = maxRows
  let columns = rows * ratio
  if (columns > maxColumns) {
    columns = maxColumns
    rows = columns / ratio
  }
  return { columns: clamp(columns), rows: clamp(rows) }
}

// "~/Downloads/x.png" for a path under home; the path as it is elsewhere
export function tildePath(path: string, home: string | undefined): string {
  if (!home) return path
  const root = home.replace(/\/+$/, '')
  return path === root ? '~' : path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path
}

// A vendor skin over Android, as its own prop names it: Samsung's One UI from `ro.build.version.oneui`
// ("60100" is 6.1, "80500" is 8.5). Another skin is one more entry in SKINS.
export type Skin = { name: string; version: string }

export const SKIN_PROPS = ['ro.build.version.oneui'] as const

const SKINS: { prop: (typeof SKIN_PROPS)[number]; name: string; version: (value: string) => string | undefined }[] = [
  {
    prop: 'ro.build.version.oneui',
    name: 'One UI',
    version: value => {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 10000) return undefined
      return `${Math.floor(n / 10000)}.${Math.floor((n % 10000) / 100)}`
    },
  },
]

export function skinOf(props: Readonly<Record<string, string | undefined>>): Skin | undefined {
  for (const skin of SKINS) {
    const value = props[skin.prop]?.trim()
    const version = value ? skin.version(value) : undefined
    if (version) return { name: skin.name, version }
  }
  return undefined
}

// The hardware a device reports, read once when the Spec block is first unfolded
export type Cluster = { count: number; minKhz?: number; maxKhz?: number }
export type BatteryHealth = 'good' | 'overheat' | 'dead' | 'overVoltage' | 'failure' | 'cold' | 'unknown'
export type Specs = {
  soc?: string
  cores?: number
  clusters: Cluster[]
  governors: string[]
  abis: string[]
  gpu?: string
  gles?: string
  memTotalKb?: number
  memAvailableKb?: number
  swapTotalKb?: number
  swapFreeKb?: number
  width?: number
  height?: number
  dpi?: number
  hz?: number
  fingerprint?: string
  patch?: string
  kernel?: string
  bootloader?: string
  buildType?: string
  health?: BatteryHealth
  tempC?: number
  voltageMv?: number
  technology?: string
  cycles?: number
}

// `getprop` with no name: "[ro.soc.model]: [SM8550]" per line
export function parseProps(out: string): Record<string, string> {
  const props: Record<string, string> = {}
  for (const line of out.split(/\r?\n/)) {
    const m = /^\[([^\]]+)\]: \[(.*)\]$/.exec(line.trim())
    if (m?.[1] && m[2] !== undefined && m[2] !== '') props[m[1]] = m[2]
  }
  return props
}

// `grep -H . <files>`: "path:value" per line, a file of several lines giving several
export function parseGrep(out: string): [string, string][] {
  const pairs: [string, string][] = []
  for (const line of out.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) pairs.push([line.slice(0, i), line.slice(i + 1).trim()])
  }
  return pairs
}

// The files SYSFS_FILES names, read in one `grep -H .` on the device; the globs expand in the device's shell
export const SYSFS_FILES = [
  '/sys/devices/system/cpu/possible',
  '/sys/devices/system/cpu/cpu[0-9]*/cpufreq/cpuinfo_min_freq',
  '/sys/devices/system/cpu/cpu[0-9]*/cpufreq/cpuinfo_max_freq',
  '/sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_governor',
  '/proc/meminfo',
  '/proc/sys/kernel/osrelease',
  '/sys/class/power_supply/battery/cycle_count',
] as const

// "0-7" or "0-3,4-7" or "0,2-3": how many CPUs
export function countCpus(range: string): number | undefined {
  let n = 0
  for (const part of range.trim().split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
    if (!m) return undefined
    n += m[2] === undefined ? 1 : Number(m[2]) - Number(m[1]) + 1
  }
  return n > 0 ? n : undefined
}

const positive = (value: string | undefined) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

// The cores, their clusters (cores of the same frequency range, slowest first), the governors, the memory, the kernel and the battery's cycles
export function sysfsSpecs(pairs: readonly [string, string][]): Pick<Specs, 'cores' | 'clusters' | 'governors' | 'memTotalKb' | 'memAvailableKb' | 'swapTotalKb' | 'swapFreeKb' | 'kernel' | 'cycles'> {
  const cpus = new Map<number, { min?: number; max?: number }>()
  const governors: string[] = []
  const mem: Record<string, number> = {}
  let possible: number | undefined
  let kernel: string | undefined
  let cycles: number | undefined
  for (const [path, value] of pairs) {
    if (path === '/sys/devices/system/cpu/possible') possible = countCpus(value)
    else if (path === '/proc/sys/kernel/osrelease') kernel = value || undefined
    else if (path === '/sys/class/power_supply/battery/cycle_count') cycles = Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : undefined
    else if (path === '/proc/meminfo') {
      const m = /^(\w+):\s*(\d+)\s*kB/.exec(value)
      if (m?.[1]) mem[m[1]] = Number(m[2])
    } else {
      const m = /^\/sys\/devices\/system\/cpu\/cpu(\d+)\/cpufreq\/(cpuinfo_min_freq|cpuinfo_max_freq|scaling_governor)$/.exec(path)
      if (!m) continue
      const cpu = Number(m[1])
      const entry = cpus.get(cpu) ?? {}
      if (m[2] === 'cpuinfo_min_freq') entry.min = positive(value)
      else if (m[2] === 'cpuinfo_max_freq') entry.max = positive(value)
      else if (value && !governors.includes(value)) governors.push(value)
      cpus.set(cpu, entry)
    }
  }
  const clusters: Cluster[] = []
  for (const cpu of [...cpus.keys()].sort((a, b) => a - b)) {
    const { min, max } = cpus.get(cpu)!
    if (max === undefined) continue
    const same = clusters.find(c => c.maxKhz === max && c.minKhz === min)
    if (same) same.count++
    else clusters.push({ count: 1, minKhz: min, maxKhz: max })
  }
  clusters.sort((a, b) => (a.maxKhz ?? 0) - (b.maxKhz ?? 0))
  return {
    cores: possible ?? (cpus.size > 0 ? cpus.size : undefined),
    clusters,
    governors,
    memTotalKb: mem.MemTotal,
    memAvailableKb: mem.MemAvailable,
    swapTotalKb: mem.SwapTotal || undefined,
    swapFreeKb: mem.SwapTotal ? mem.SwapFree : undefined,
    kernel,
    cycles,
  }
}

// The SoC, the ABIs and the build from the props: `ro.soc.*` (Android 12 and later), else the board, else the hardware
export function propSpecs(props: Readonly<Record<string, string>>): Pick<Specs, 'soc' | 'abis' | 'dpi' | 'fingerprint' | 'patch' | 'bootloader' | 'buildType'> {
  const model = props['ro.soc.model']
  const maker = props['ro.soc.manufacturer']
  const platform = props['ro.board.platform']
  const soc =
    model ? [maker, model].filter(Boolean).join(' ') + (platform && platform.toLowerCase() !== model.toLowerCase() ? ` (${platform})` : '')
    : (platform ?? props['ro.hardware'])
  const abis = (props['ro.product.cpu.abilist'] ?? props['ro.product.cpu.abi'] ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const bootloader = props['ro.bootloader'] ?? props['ro.boot.bootloader']
  return {
    soc,
    abis,
    dpi: positive(props['ro.sf.lcd_density']),
    fingerprint: props['ro.build.fingerprint'],
    patch: props['ro.build.version.security_patch'],
    bootloader: bootloader && bootloader !== 'unknown' ? bootloader : undefined,
    buildType: props['ro.build.type'],
  }
}

// `dumpsys SurfaceFlinger`: "GLES: Qualcomm, Adreno (TM) 740, OpenGL ES 3.2 V@0676.32 ..."
export function parseGles(out: string): { gpu?: string; gles?: string } {
  const m = /^\s*GLES:\s*([^,\n]+),\s*([^,\n]+),\s*(OpenGL ES[^\sV]*\s*[\d.]+)?/m.exec(out)
  if (!m) return {}
  const vendor = m[1]!.trim()
  const renderer = m[2]!.trim()
  return { gpu: renderer.toLowerCase().includes(vendor.toLowerCase()) ? renderer : `${vendor} ${renderer}`, gles: m[3]?.trim() }
}

// The highest refresh rate among the display's modes in `dumpsys display` ("fps=120.0"); else SurfaceFlinger's "refresh-rate : 60.000 fps"
export function parseRefreshRate(display: string, surfaceFlinger = ''): number | undefined {
  let best = 0
  for (const m of display.matchAll(/\bfps=(\d+(?:\.\d+)?)/g)) best = Math.max(best, Number(m[1]))
  if (best <= 0) best = Number(/refresh-rate\s*:\s*(\d+(?:\.\d+)?)/.exec(surfaceFlinger)?.[1] ?? 0)
  return best > 0 ? Math.round(best) : undefined
}

// `wm size`: "Physical size: 1080x2400" (an "Override size:" line may follow)
export function parseWmSize(out: string): { width?: number; height?: number } {
  const m = /Physical size:\s*(\d+)x(\d+)/.exec(out)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : {}
}

const HEALTH: Record<string, BatteryHealth> = { '2': 'good', '3': 'overheat', '4': 'dead', '5': 'overVoltage', '6': 'failure', '7': 'cold' }

// `dumpsys battery`: "  health: 2", "  temperature: 285" (tenths of a degree), "  voltage: 4123" (mV), "  technology: Li-ion"
export function parseBatteryDetail(out: string): Pick<Specs, 'health' | 'tempC' | 'voltageMv' | 'technology'> {
  const field = (name: string) => new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm').exec(out)?.[1]?.trim()
  const health = field('health')
  const temp = Number(field('temperature'))
  const voltage = Number(field('voltage'))
  const technology = field('technology')
  return {
    health: health === undefined ? undefined : (HEALTH[health] ?? 'unknown'),
    tempC: Number.isFinite(temp) && field('temperature') !== undefined ? temp / 10 : undefined,
    // Some devices report volts, not millivolts
    voltageMv: Number.isFinite(voltage) && voltage > 0 ? (voltage < 100 ? voltage * 1000 : voltage) : undefined,
    technology: technology && technology !== 'Unknown' ? technology : undefined,
  }
}

// "1.96 GHz" from kHz
export function formatGhz(khz: number): string {
  return `${(khz / 1_000_000).toFixed(2)} GHz`
}

// "4 × 0.31–1.96 GHz", or "4 × 1.96 GHz" without a minimum
export function formatCluster(c: Cluster): string {
  if (c.maxKhz === undefined) return `${c.count}`
  const range = c.minKhz !== undefined ? `${(c.minKhz / 1_000_000).toFixed(2)}–${formatGhz(c.maxKhz)}` : formatGhz(c.maxKhz)
  return `${c.count} × ${range}`
}

// How many terminal cells a string takes: a Hangul or CJK character takes two
export function cellWidth(text: string): number {
  let n = 0
  for (const ch of text) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1
  return n
}

export function padCells(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - cellWidth(text)))
}
