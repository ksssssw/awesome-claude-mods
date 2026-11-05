// Pure functions of the logcat mod: parsing adb output, filtering, colors and
// the "which package is mine" rules. Nothing here touches the engine.

export type Level = 'V' | 'D' | 'I' | 'W' | 'E' | 'F'

// Lowest to highest; a minimum level keeps everything at or above it
export const LEVELS: readonly Level[] = ['V', 'D', 'I', 'W', 'E', 'F']

// The floors the pane's picker offers, named as Android Studio's Log level menu names them: each shows its
// level and everything above it, so Verbose is every line; F alone is never a useful floor
export const LEVEL_OPTIONS: readonly { value: Level; label: string }[] = [
  { value: 'V', label: 'Verbose' },
  { value: 'D', label: 'Debug' },
  { value: 'I', label: 'Info' },
  { value: 'W', label: 'Warn' },
  { value: 'E', label: 'Error' },
]

// The pane's floor when it opens: every line, as Android Studio starts
export const DEFAULT_LEVEL: Level = 'V'

export type Entry = {
  // The day as logcat prints it, `MM-DD`; with `time` it names the moment a reconnect resumes from
  date: string
  time: string
  pid: number
  tid: number
  level: Level
  tag: string
  message: string
  // Set as the pane takes the line in: one number per line, rising, so a selection names lines that stay put
  seq?: number
}

// Android Studio's Darcula logcat scheme
export const COLORS: Record<Level, string> = {
  V: '#BBBBBB',
  D: '#6897BB',
  I: '#6A8759',
  W: '#BBB529',
  E: '#FF6B68',
  F: '#FF6B68',
}

export type Style = {
  color: string
  // The whole line takes the color, not only the level and the tag
  isWhole: boolean
  isBold: boolean
  isDim: boolean
}

export function styleOf(level: Level): Style {
  return {
    color: COLORS[level],
    isWhole: level === 'W' || level === 'E' || level === 'F',
    isBold: level === 'F',
    isDim: level === 'V',
  }
}

// `adb logcat -v threadtime`: "11-02 14:03:21.123  1234  5678 D Tag     : message"
const THREADTIME = /^(\d\d-\d\d) (\d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+(\d+) ([VDIWEFAS]) (.*?)\s*: ?(.*)$/

export function parseLine(line: string): Entry | undefined {
  if (line.startsWith('--------- ')) return undefined
  const m = THREADTIME.exec(line)
  if (!m) return undefined
  const raw = m[5] ?? ''
  if (raw === 'S') return undefined
  const level: Level = raw === 'A' ? 'F' : (raw as Level)
  return { date: m[1] ?? '', time: m[2] ?? '', pid: Number(m[3]), tid: Number(m[4]), level, tag: m[6] ?? '', message: m[7] ?? '' }
}

// Chunks arrive cut anywhere; the tail that has no newline yet waits for the next one
export function splitLines(carry: string, chunk: string): { lines: string[]; carry: string } {
  const whole = carry + chunk
  const parts = whole.split(/\r?\n/)
  const rest = parts.pop() ?? ''
  return { lines: parts, carry: rest }
}

export function rankOf(level: Level): number {
  return LEVELS.indexOf(level)
}

export function isAtLeast(level: Level, min: Level): boolean {
  return rankOf(level) >= rankOf(min)
}

export function asLevel(value: unknown, fallback: Level): Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value) ? (value as Level) : fallback
}

// The pane's light filter: a floor on the level and a case-insensitive substring of the tag or the message
export function passesFilter(entry: Entry, min: Level, text: string): boolean {
  if (!isAtLeast(entry.level, min)) return false
  const needle = text.trim().toLowerCase()
  if (needle === '') return true
  return entry.tag.toLowerCase().includes(needle) || entry.message.toLowerCase().includes(needle)
}

// `MM-DD HH:MM:SS.mmm`, what `logcat -T` takes and what orders two entries of one day
export function stampOf(entry: Entry): string {
  return `${entry.date} ${entry.time}`
}

// A package name as adb's shell may see it: letters, digits, dots and underscores alone
export function isPackageName(value: string): boolean {
  return /^[A-Za-z0-9_.]+$/.test(value)
}

export function formatLine(entry: Entry): string {
  return `${entry.time}  ${entry.level}/${entry.tag}: ${entry.message}`
}

// The last `limit` entries that pass, oldest first
export function tail(entries: readonly Entry[], min: Level, text: string, limit: number): Entry[] {
  const out: Entry[] = []
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    const entry = entries[i]
    if (entry && passesFilter(entry, min, text)) out.push(entry)
  }
  return out.reverse()
}

// A bounded list that drops its oldest entries; a plain array trimmed in batches
export class RingBuffer<T> {
  private items: T[] = []
  constructor(readonly capacity: number) {}
  push(item: T) {
    this.items.push(item)
    if (this.items.length > this.capacity * 1.5) this.items = this.items.slice(-this.capacity)
  }
  get size() {
    return Math.min(this.items.length, this.capacity)
  }
  toArray(): readonly T[] {
    return this.items.length > this.capacity ? this.items.slice(-this.capacity) : this.items
  }
  clear() {
    this.items = []
  }
}

// `applicationId "com.x"` or `applicationId = "com.x"` in a build.gradle(.kts);
// `applicationIdSuffix` does not match since a word character follows the name
const APPLICATION_ID = /\bapplicationId\s*=?\s*["']([A-Za-z0-9_.]+)["']/

export function applicationIdFrom(gradle: string): string | undefined {
  const m = APPLICATION_ID.exec(gradle)
  return m?.[1]
}

// Every applicationId a build file sets, in order: string literals and version catalog references
// (`libs.versions.appId.get()`, Groovy's `libs.versions.appId.get()` without the call too), the ones a
// catalog names resolved through `catalog`; a reference the catalog does not hold is left out
const ANY_APPLICATION_ID = /\bapplicationId\s*=?\s*(?:["']([A-Za-z0-9_.]+)["']|libs\.versions\.([A-Za-z0-9_.]+?)(?:\.get\(\))?(?=[\s)]|$))/gm

export function applicationIdsFrom(gradle: string, catalog: Readonly<Record<string, string>> = {}): string[] {
  const out: string[] = []
  for (const m of gradle.matchAll(ANY_APPLICATION_ID)) {
    const id = m[1] ?? (m[2] !== undefined ? catalog[catalogKey(m[2])] : undefined)
    if (id && isPackageName(id) && !out.includes(id)) out.push(id)
  }
  return out
}

// Gradle turns `-`, `_` and `.` in a catalog alias into the accessor's dots and ignores case
// in matching them: both sides are brought to one spelling
export function catalogKey(alias: string): string {
  return alias.replace(/[-_.]/g, '').toLowerCase()
}

// The `[versions]` table of a `libs.versions.toml`: `alias = "value"` lines, keyed by catalogKey
export function parseVersionCatalog(toml: string): Record<string, string> {
  const out: Record<string, string> = {}
  let isVersions = false
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const table = /^\[([^\]]+)\]$/.exec(line)
    if (table) {
      isVersions = table[1]?.trim() === 'versions'
      continue
    }
    if (!isVersions) continue
    const m = /^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']*)["']/.exec(line)
    if (m?.[1] && m[2] !== undefined) out[catalogKey(m[1])] = m[2]
  }
  return out
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

export type Pick = { chosen: InstalledPackage; candidates: InstalledPackage[] }

// The base id itself when installed, else the first flavor of it (`base.debug`)
export function pickPackage(installed: readonly InstalledPackage[], base: string): Pick | undefined {
  const candidates = installed.filter(p => p.name === base || p.name.startsWith(base + '.'))
  const first = candidates[0]
  if (!first) return undefined
  const exact = candidates.find(p => p.name === base)
  return { chosen: exact ?? first, candidates }
}

// The repo's apps that are on the device: for each id the repo sets, in the order found, the installed
// package it names (itself first, then its flavors); each package once
export function installedCandidates(installed: readonly InstalledPackage[], ids: readonly string[]): InstalledPackage[] {
  const out: InstalledPackage[] = []
  for (const id of ids) {
    const exact = installed.find(p => p.name === id)
    const flavors = installed.filter(p => p.name.startsWith(id + '.'))
    for (const p of exact ? [exact, ...flavors] : flavors) if (!out.some(o => o.name === p.name)) out.push(p)
  }
  return out
}

// Of the candidates, the one on screen when it is among them, else the first
export function chooseCandidate(candidates: readonly InstalledPackage[], foreground: string | undefined): InstalledPackage | undefined {
  return candidates.find(p => p.name === foreground) ?? candidates[0]
}

// The package of the resumed activity in `dumpsys activity activities`:
// "topResumedActivity=ActivityRecord{… u0 com.x/.MainActivity t12}" or "mResumedActivity: ActivityRecord{…}"
export function parseResumedPackage(out: string): string | undefined {
  for (const line of out.split(/\r?\n/)) {
    if (!/(?:topResumedActivity|mResumedActivity|ResumedActivity)\b/.test(line)) continue
    const m = /\s([A-Za-z0-9_.]+)\/[A-Za-z0-9_.$]+/.exec(line)
    if (m?.[1]) return m[1]
  }
  return undefined
}

export type Device = { serial: string; model?: string }

// `adb devices -l`: "R3CY40JZPDM            device usb:... product:q7qksx model:SM_F966N ..."
export function parseDevices(out: string): Device[] {
  const list: Device[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\S+)\s+device(\s|$)(.*)$/.exec(line.trim())
    const serial = m?.[1]
    if (!m || !serial || serial === 'List') continue
    const model = /model:(\S+)/.exec(m[3] ?? '')?.[1]?.replace(/_/g, ' ')
    list.push({ serial, model })
  }
  return list
}

// `backlog` is a count of lines on the first start, or a `MM-DD HH:MM:SS.mmm` stamp to resume from
export function logcatArgv(adb: string, serial: string, filter: { uid?: number; pid?: number }, backlog: number | string): string[] {
  const argv = [adb, '-s', serial, 'logcat', '-v', 'threadtime', '-T', String(backlog)]
  if (filter.uid !== undefined) argv.push(`--uid=${filter.uid}`)
  else if (filter.pid !== undefined) argv.push(`--pid=${filter.pid}`)
  return argv
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

// Cells a character takes in a monospaced terminal: two for the wide East Asian ranges
// (Hangul, CJK, kana, fullwidth forms, most emoji), none for combining marks and joiners, else one
export function cellWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0
  if (c === 0x200d || (c >= 0x300 && c <= 0x36f) || (c >= 0xfe00 && c <= 0xfe0f)) return 0
  if (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0x303e) ||
    (c >= 0x3041 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xa960 && c <= 0xa97f) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )
    return 2
  return 1
}

export function textWidth(text: string): number {
  let w = 0
  for (const ch of text) w += cellWidth(ch)
  return w
}

// Cuts `text` into pieces the first `first` cells wide and the rest `rest` wide; at least one piece
export function cutCells(text: string, first: number, rest: number): string[] {
  const out: string[] = []
  let piece = ''
  let used = 0
  let room = Math.max(1, first)
  for (const ch of text) {
    const w = cellWidth(ch)
    if (used + w > room && piece !== '') {
      out.push(piece)
      piece = ''
      used = 0
      room = Math.max(1, rest)
    }
    piece += ch
    used += w
  }
  out.push(piece)
  return out
}

// What goes before the message on a terminal row: `HH:MM:SS.mmm  L/Tag: `
export function headOf(entry: Entry): string {
  return `${entry.time}  ${entry.level}/${entry.tag}: `
}

// Under the time, where a wrapped line's later rows start
export const WRAP_INDENT = 14

// The message of a line cut to the region's columns: the first piece after the head, the rest under
// the indent. A head wider than the row leaves the message all to the later rows
export function wrapMessage(entry: Entry, columns: number): string[] {
  const cols = Math.max(WRAP_INDENT + 8, columns)
  const first = cols - textWidth(headOf(entry))
  const rest = cols - WRAP_INDENT
  if (first < 4) return ['', ...cutCells(entry.message, rest, rest)]
  return cutCells(entry.message, first, rest)
}

// The rows a line takes: one, or under wrap as many as its message is cut into
export function rowsOf(entry: Entry, columns: number, isWrap: boolean): number {
  return isWrap && columns > 0 ? wrapMessage(entry, columns).length : 1
}

// Which lines fill `rows` rows ending `offset` lines from the end: the window drawn, oldest first,
// and how many rows of its first line fall above the top (a wrapped line cut by the edge)
export function windowOf(heights: readonly number[], offset: number, rows: number): { start: number; end: number; cut: number } {
  const end = Math.max(0, heights.length - offset)
  let start = end
  let used = 0
  while (start > 0 && used < rows) {
    start--
    used += heights[start] ?? 1
  }
  return { start, end, cut: Math.max(0, used - rows) }
}
