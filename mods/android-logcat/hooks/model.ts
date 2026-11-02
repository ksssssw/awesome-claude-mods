// Pure functions of the logcat mod: parsing adb output, filtering, colors and
// the "which package is mine" rules. Nothing here touches the engine.

export type Level = 'V' | 'D' | 'I' | 'W' | 'E' | 'F'

// Lowest to highest; a minimum level keeps everything at or above it
export const LEVELS: readonly Level[] = ['V', 'D', 'I', 'W', 'E', 'F']

// The floors the pane's picker offers: everything (verbose and up), then D to E; F alone is never a useful floor
export const LEVEL_OPTIONS: readonly { value: Level; label: string }[] = [
  { value: 'V', label: 'All' },
  { value: 'D', label: 'D' },
  { value: 'I', label: 'I' },
  { value: 'W', label: 'W' },
  { value: 'E', label: 'E' },
]

export type Entry = {
  time: string
  pid: number
  tid: number
  level: Level
  tag: string
  message: string
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
const THREADTIME = /^\d\d-\d\d (\d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+(\d+) ([VDIWEFAS]) (.*?)\s*: ?(.*)$/

export function parseLine(line: string): Entry | undefined {
  if (line.startsWith('--------- ')) return undefined
  const m = THREADTIME.exec(line)
  if (!m) return undefined
  const raw = m[4] ?? ''
  if (raw === 'S') return undefined
  const level: Level = raw === 'A' ? 'F' : (raw as Level)
  return { time: m[1] ?? '', pid: Number(m[2]), tid: Number(m[3]), level, tag: m[5] ?? '', message: m[6] ?? '' }
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

export function logcatArgv(adb: string, serial: string, filter: { uid?: number; pid?: number }, backlog: number): string[] {
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
