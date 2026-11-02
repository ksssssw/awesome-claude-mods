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
