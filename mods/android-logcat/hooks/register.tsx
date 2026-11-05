import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { detectApplicationIds, findAdb, foregroundPackage, listDevices, listInstalled, pidOf } from './adb'
import { setLanguage, t } from './i18n'
import type { LinesProps } from './lines'
import { line } from './line'
import {
  asLevel,
  chooseCandidate,
  clampInt,
  DEFAULT_LEVEL,
  formatLine,
  installedCandidates,
  isPackageName,
  LEVEL_OPTIONS,
  logcatArgv,
  parseLine,
  pickPackage,
  RingBuffer,
  splitLines,
  stampOf,
  tail,
} from './model'
import type { Entry, InstalledPackage, Level } from './model'

const PLUGIN = 'android-logcat'
const PANE = 'logcat'
const COMMAND = 'logcat'
const TOOL = 'logcat_read'

// Lines asked of adb when the capture starts, so the pane is not empty at first
const BACKLOG = 500
// How long to wait before looking for adb, a device or the app again
const RETRY_MS = 5000
// Without a uid the capture follows the pid, asked again this often
const PID_POLL_MS = 2000
// At most this often the pane is redrawn while lines arrive
const REDRAW_MS = 100
const TOOL_LINES = 100
const TOOL_LINES_MAX = 500
// Lines the pane draws: more than fit, so the person scrolls back through them with the arrows
const SCROLLBACK = 300
// The override and the remembered value that follow every process instead of one app
const ALL = '*'
// $.store keys: the package each repo follows, by its root; whether lines wrap
const STORE_PACKAGES = 'packages'
const STORE_WRAP = 'wrap'

// What survives a hot reload: on or off, the package the person named, the filters
const isOn = atom({ plugin: 'android-logcat', key: 'isOn' } as const, false)
const override = atom({ plugin: 'android-logcat', key: 'override' } as const, null)
const level = atom({ plugin: 'android-logcat', key: 'level' } as const, DEFAULT_LEVEL)
const filter = atom({ plugin: 'android-logcat', key: 'filter' } as const, '')
const isPaused = atom({ plugin: 'android-logcat', key: 'isPaused' } as const, false)
// A write redraws the pane, which is how a press or a key moves the lines
const scroll = atom({ plugin: 'android-logcat', key: 'scroll' } as const, 0)
const isWrap = atom({ plugin: 'android-logcat', key: 'isWrap' } as const, true)
const selectionEpoch = atom({ plugin: 'android-logcat', key: 'selectionEpoch' } as const, 0)

type Status =
  | { kind: 'off' | 'starting' | 'no-adb' | 'no-device' }
  | { kind: 'not-installed'; package: string; choices: string[] }
  // The repo sets app ids, and none of them is on the device
  | { kind: 'none-installed'; count: number }
  | { kind: 'reconnecting'; package: string; reason?: string }
  | { kind: 'error'; reason: string }
  | { kind: 'live'; package: string; isAll: boolean; choices: string[]; uid?: number; pid?: number; serial: string; model?: string }

type Capture = {
  controller: AbortController
  // The running child's stream, so a stop ends it even while no line arrives
  stream?: AsyncGenerator<unknown, unknown>
  // Found once per capture: the adb to run, the package named over the repo's (null: none, so the repo's
  // apps on the device), and the app ids the repo's build files set
  adb?: string
  named?: string | null
  ids?: string[]
  // The repo's app picked the first time, kept while it stays installed so a reconnect does not hop
  autoPick?: string
  // Set once a `--uid` child ended without a line: the device refuses it, so the pid path is taken
  avoidUid: boolean
  // The newest line's stamp, where a reconnect resumes from instead of the backlog
  lastStamp?: string
}

// Lost on a reload: the capture restarts and asks adb for its backlog again
let options = { package: '', serial: '', rows: 20, bufferLines: 2000 }
let buffer = new RingBuffer<Entry>(options.bufferLines)
let counts = { errors: 0, warnings: 0 }
let status: Status = { kind: 'off' }
let isDirty = false
let isPausedNow = false
let frozen: readonly Entry[] = []
// What the pane shows while scrolled up: a snapshot, so the rows under the person's eyes stay put
let held: readonly Entry[] | undefined
// Lines that arrived while `held` stood
let arrivedSinceHeld = 0
let capture: Capture | undefined
let isToolRegistered = false
let lastStatusLine: string | undefined
// Rows the lines region had at the last draw, for paging
let lastRoom = 10
// Where the session runs: the git repository's root, else the working folder; what a remembered package is kept by
let repoRoot = ''
// Rising number given each line as it comes in, what a selection names lines by
let nextSeq = 0
// Set while a selection in the lines region holds the view; whether the view followed the newest before it
let isSelecting = false
let wasFollowing = false

function setStatus(next: Status) {
  status = next
  isDirty = true
}

function ingest(entry: Entry) {
  entry.seq = nextSeq++
  buffer.push(entry)
  if (entry.level === 'E' || entry.level === 'F') counts.errors++
  else if (entry.level === 'W') counts.warnings++
  if (held) arrivedSinceHeld++
  isDirty = true
}

function clear() {
  isSelecting = false
  buffer.clear()
  frozen = []
  held = undefined
  arrivedSinceHeld = 0
  counts = { errors: 0, warnings: 0 }
  isDirty = true
}

// The lines the pane draws from: the pause's snapshot, else the scroll's, else the live buffer
function viewed(): readonly Entry[] {
  return isPausedNow ? frozen : (held ?? buffer.toArray())
}

function stopCapture() {
  if (!capture) return
  capture.controller.abort()
  void capture.stream?.return(undefined)
  capture = undefined
}

function startCapture($: EngineInterface) {
  stopCapture()
  const self: Capture = { controller: new AbortController(), avoidUid: false }
  capture = self
  setStatus({ kind: 'starting' })
  void run($, self)
}

async function run($: EngineInterface, self: Capture) {
  const { signal } = self.controller
  // False when the wait failed for a reason other than our own stop: the engine is gone, so the loop ends
  const sleep = (ms: number) =>
    $.clock.sleep(ms, { signal }).then(
      () => true,
      () => signal.aborted,
    )

  while (!signal.aborted) {
    try {
      if (!(await step($, self, sleep))) return
    } catch (error) {
      // A call on `$` failed (the engine busy, a refused read): say so and try again
      if (signal.aborted) return
      setStatus({ kind: 'error', reason: error instanceof Error ? error.message : String(error) })
      if (!(await sleep(RETRY_MS))) return
    }
  }
}

type Sleep = (ms: number) => Promise<boolean>

// One pass: find adb, a device and the app, then follow logcat until the child ends. False ends the loop.
async function step($: EngineInterface, self: Capture, sleep: Sleep): Promise<boolean> {
  const { signal } = self.controller
  const adb = self.adb ?? (await findAdb($))
  if (signal.aborted) return false
  if (!adb) {
    setStatus({ kind: 'no-adb' })
    return sleep(RETRY_MS)
  }
  self.adb = adb

  const devices = await listDevices($, adb)
  const device = options.serial ? devices.find(d => d.serial === options.serial) : devices[0]
  if (!device) {
    setStatus({ kind: 'no-device' })
    return sleep(RETRY_MS)
  }

  if (self.named === undefined) self.named = await namedPackage($)
  if (self.ids === undefined) self.ids = repoRoot ? await detectApplicationIds($, repoRoot) : []
  const named = self.named
  const ids = self.ids
  const installed = (await listInstalled($, adb, device.serial)) ?? []
  const fromRepo = installedCandidates(installed, ids)
  const choices = fromRepo.map(p => p.name)
  void offerChoices($, choices)

  let spec: { uid?: number; pid?: number } = {}
  let pkg: string | undefined
  if (named && named !== ALL) {
    // A package the person named: itself, or the first of its flavors; by pid where the uid path is refused
    const picked = self.avoidUid ? undefined : pickPackage(installed, named)
    pkg = picked?.chosen.name ?? named
    if (picked) spec = { uid: picked.chosen.uid }
    else {
      const pid = await pidOf($, adb, device.serial, named)
      if (pid === undefined) {
        setStatus({ kind: 'not-installed', package: named, choices })
        return sleep(RETRY_MS)
      }
      spec = { pid }
    }
  } else if (named !== ALL && ids.length > 0) {
    // The repo's apps that are on the device: the one picked before, else the one on screen, else the first
    if (fromRepo.length === 0) {
      setStatus({ kind: 'none-installed', count: ids.length })
      return sleep(RETRY_MS)
    }
    const kept = fromRepo.find(p => p.name === self.autoPick)
    const chosen: InstalledPackage | undefined =
      kept ?? chooseCandidate(fromRepo, fromRepo.length > 1 ? await foregroundPackage($, adb, device.serial) : undefined)
    if (!chosen) return sleep(RETRY_MS)
    self.autoPick = chosen.name
    pkg = chosen.name
    if (!self.avoidUid) spec = { uid: chosen.uid }
    else {
      const pid = await pidOf($, adb, device.serial, chosen.name)
      if (pid === undefined) {
        setStatus({ kind: 'not-installed', package: chosen.name, choices })
        return sleep(RETRY_MS)
      }
      spec = { pid }
    }
  }
  if (signal.aborted) return false

  setStatus({ kind: 'live', package: pkg ?? '', isAll: !pkg, choices, ...spec, serial: device.serial, model: device.model })
  // The first child brings a backlog; a later one resumes where the last line left off, so nothing is read twice
  const resumeFrom = self.lastStamp
  const stream = $.process.spawn({ argv: logcatArgv(adb, device.serial, spec, resumeFrom ?? BACKLOG) })
  self.stream = stream

  // A pid changes when the app restarts: end this child so the loop resolves it again
  let poll: Timer | undefined
  if (spec.pid !== undefined && pkg) {
    const watched = pkg
    const was = spec.pid
    poll = $.clock.every(PID_POLL_MS, async () => {
      const now = await pidOf($, adb, device.serial, watched)
      if (now !== undefined && now !== was) void stream.return(undefined as never)
    })
  }

  let carry = ''
  let stderr = ''
  let sawLine = false
  try {
    for await (const chunk of stream) {
      if (signal.aborted) break
      if (chunk.stream === 'stderr') {
        stderr = (stderr + chunk.text).slice(-300)
        continue
      }
      const split = splitLines(carry, chunk.text)
      carry = split.carry
      for (const text of split.lines) {
        const entry = parseLine(text)
        if (!entry) continue
        sawLine = true
        const stamp = stampOf(entry)
        // `-T <stamp>` repeats the line at that moment: skip what was already read
        if (resumeFrom !== undefined && stamp <= resumeFrom) continue
        self.lastStamp = stamp
        ingest(entry)
      }
    }
  } catch (error) {
    stderr = error instanceof Error ? error.message : String(error)
  } finally {
    poll?.cancel()
    self.stream = undefined
  }
  if (signal.aborted) return false
  // A `--uid` child that printed nothing was refused (an old logcat): follow the pid from here on
  if (spec.uid !== undefined && !sawLine) self.avoidUid = true
  const reason = stderr.trim().split('\n').pop()
  setStatus({ kind: 'reconnecting', package: pkg ?? '', reason: reason || undefined })
  return sleep(RETRY_MS / 2)
}

type Scroll = 'up' | 'down' | 'pageup' | 'pagedown' | 'oldest' | 'newest'

// Moves the view; leaving the end holds a snapshot so the rows stay put, and reaching it again follows the live lines
async function scrollBy($: EngineInterface, kind: Scroll | number) {
  const page = Math.max(1, lastRoom - 1)
  const total = await visibleNow($)
  const max = Math.max(0, total - lastRoom)
  let landed = 0
  await update($, scroll, offset => {
    const next =
      typeof kind === 'number' ? offset - kind
      : kind === 'up' ? offset + 1
      : kind === 'down' ? offset - 1
      : kind === 'pageup' ? offset + page
      : kind === 'pagedown' ? offset - page
      : kind === 'oldest' ? max
      : 0
    landed = Math.min(max, Math.max(0, next))
    return landed
  })
  if (landed > 0 && held === undefined) {
    held = buffer.toArray().slice()
    arrivedSinceHeld = 0
  } else if (landed === 0 && held !== undefined && !isSelecting) {
    held = undefined
    arrivedSinceHeld = 0
    isDirty = true
  }
}

async function visibleNow($: EngineInterface): Promise<number> {
  return visibleCount(asLevel(await read($, level), DEFAULT_LEVEL), await read($, filter))
}

// The package named over the repo's apps: this session's, else the one remembered for the repo, else the option
async function namedPackage($: EngineInterface): Promise<string | null> {
  const session = await read($, override)
  if (session) return session
  const remembered = (await rememberedPackages($))[repoRoot]
  if (remembered) return remembered
  return options.package || null
}

async function rememberedPackages($: EngineInterface): Promise<Record<string, string>> {
  try {
    const value = await $.store.get(STORE_PACKAGES)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const out: Record<string, string> = {}
    for (const [root, pkg] of Object.entries(value as Record<string, unknown>)) {
      if (typeof pkg === 'string' && (pkg === ALL || isPackageName(pkg))) out[root] = pkg
    }
    return out
  } catch {
    return {}
  }
}

// Keeps `pkg` as the repo's app for later sessions; undefined forgets it
async function remember($: EngineInterface, pkg: string | undefined) {
  if (!repoRoot) return
  const all = await rememberedPackages($)
  if (pkg === undefined) delete all[repoRoot]
  else all[repoRoot] = pkg
  try {
    await $.store.set(STORE_PACKAGES, all)
  } catch {
    // a full or refused store: this session still follows it
  }
}

async function findRepoRoot($: EngineInterface): Promise<string> {
  try {
    const repo = await $.session.repo()
    if (repo?.root) return repo.root
  } catch {
    // no git: the working folder
  }
  try {
    return await $.session.cwd()
  } catch {
    return ''
  }
}

// The command's hint names the repo's apps on the device, so the person sees what to type
let lastHint = ''
async function offerChoices($: EngineInterface, choices: readonly string[]) {
  const hint = choices.length > 0 ? `[off | clear | auto | ${choices.join(' | ')}]` : t().argumentHint
  if (hint === lastHint) return
  lastHint = hint
  try {
    await $.command.register({ name: COMMAND, description: t().commandDescription, argumentHint: hint })
  } catch {
    // the hint stays as it was
  }
}

// Follows `pkg` from now on, in this session and for this repo, the lines of the last one cleared
async function follow($: EngineInterface, pkg: string) {
  await update($, override, () => pkg)
  await remember($, pkg)
  await turnOn($)
}

// Drops the lines region's selection and lets the view follow again where it did before
async function endSelection($: EngineInterface) {
  if (!isSelecting) return
  isSelecting = false
  if (wasFollowing && (await read($, scroll)) === 0) {
    held = undefined
    arrivedSinceHeld = 0
  }
  wasFollowing = false
  isDirty = true
  await update($, selectionEpoch, n => n + 1)
}

function visibleCount(min: Level, text: string): number {
  return tail(viewed(), min, text, SCROLLBACK).length
}

async function ensureTool($: EngineInterface) {
  if (isToolRegistered) return
  await $.tool.register({
    name: TOOL,
    description:
      'Reads the most recent lines of the Android logcat the person is following in the logcat pane (their app only, unless they chose otherwise). Use it to look at errors, warnings or a tag while debugging. Lines read `HH:MM:SS.mmm  L/Tag: message`.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['V', 'D', 'I', 'W', 'E', 'F'], description: 'Lowest level to include (V verbose, D debug, I info, W warn, E error, F fatal). Default V.' },
        filter: { type: 'string', description: 'Case-insensitive text the tag or the message must contain.' },
        lines: { type: 'number', description: `How many of the newest matching lines, 1 to ${TOOL_LINES_MAX}. Default ${TOOL_LINES}.` },
      },
    },
    isDeferred: false,
  })
  isToolRegistered = true
}

async function turnOn($: EngineInterface) {
  repoRoot = await findRepoRoot($)
  await update($, isOn, () => true)
  await ensureTool($)
  $.ui.invalidate('tool.describe')
  clear()
  isPausedNow = false
  await update($, isPaused, () => false)
  await update($, scroll, () => 0)
  startCapture($)
  await $.ui.open({ id: PANE, title: t().paneTitle, rows: options.rows })
}

// Stops the capture and forgets the on state; the pane is closed by the caller or already closing
async function turnOff($: EngineInterface) {
  stopCapture()
  setStatus({ kind: 'off' })
  await update($, isOn, () => false)
  await update($, override, () => null)
  $.ui.invalidate('tool.describe')
  $.ui.status(undefined)
  lastStatusLine = undefined
}

function packageLabel(): string {
  if (status.kind === 'live') {
    if (status.isAll) return t().allProcesses
    return status.choices.length > 1 && status.choices.includes(status.package) ? t().oneOf(status.package, status.choices.length) : status.package
  }
  if (status.kind === 'not-installed' || status.kind === 'reconnecting') return status.package
  return ''
}

function statusText(): { text: string; color: string } {
  switch (status.kind) {
    case 'off':
      return { text: t().off, color: 'inactive' }
    case 'starting':
      return { text: t().starting, color: 'warning' }
    case 'reconnecting':
      return { text: status.reason ? `${t().reconnecting}: ${status.reason}` : t().reconnecting, color: 'warning' }
    case 'error':
      return { text: t().error(status.reason), color: 'error' }
    case 'no-adb':
      return { text: t().noAdb, color: 'error' }
    case 'no-device':
      return { text: t().noDevice, color: 'error' }
    case 'not-installed':
      return { text: t().notInstalled(status.package), color: 'error' }
    case 'none-installed':
      return { text: t().noneInstalled(status.count), color: 'error' }
    case 'live':
      return isPausedNow ? { text: t().paused, color: 'warning' } : { text: t().live, color: 'success' }
  }
}

export const register: Register = (on, opts) => {
  setLanguage(opts.language)
  options = {
    package: typeof opts.package === 'string' && isPackageName(opts.package.trim()) ? opts.package.trim() : '',
    serial: typeof opts.serial === 'string' ? opts.serial.trim() : '',
    rows: clampInt(opts.rows, 20, 5, 200),
    bufferLines: clampInt(opts.bufferLines, 2000, 100, 50_000),
  }
  buffer = new RingBuffer<Entry>(options.bufferLines)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: t().commandDescription, argumentHint: t().argumentHint })
    const started = await next(e)

    isPausedNow = await read($, isPaused)
    try {
      const wrap = await $.store.get(STORE_WRAP)
      if (typeof wrap === 'boolean') await update($, isWrap, () => wrap)
    } catch {
      // the default stands
    }
    $.clock.every(REDRAW_MS, () => {
      if (!isDirty) return
      isDirty = false
      if (!isPausedNow) $.ui.invalidate('ui.render')
      if (status.kind === 'off') return
      const line = t().statusLine(packageLabel() || '...', counts.errors, counts.warnings)
      if (line !== lastStatusLine) {
        lastStatusLine = line
        $.ui.status(line)
      }
    })

    // A reload ended the child; the state says it was on, so it comes back by itself
    if (await read($, isOn)) {
      await ensureTool($)
      repoRoot = await findRepoRoot($)
      setStatus({ kind: 'reconnecting', package: '' })
      startCapture($)
      void $.ui.open({ id: PANE, title: t().paneTitle, rows: options.rows })
    }
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    const wasOn = await read($, isOn)
    if (arg === 'off') {
      if (!wasOn) return { text: t().alreadyOff }
      await turnOff($)
      await $.ui.close({ id: PANE })
      return { text: t().turnedOff }
    }
    if (arg === 'clear') {
      clear()
      $.ui.invalidate('ui.render')
      return { text: t().cleared }
    }
    if (arg === 'auto') {
      // Forgets the repo's remembered package and goes back to the repo's own apps
      repoRoot = await findRepoRoot($)
      await remember($, undefined)
      await update($, override, () => null)
      await turnOn($)
      return { text: t().turnedOnAuto }
    }
    if (arg !== '') {
      if (!isPackageName(arg)) return { text: t().badPackage(arg) }
      repoRoot = await findRepoRoot($)
      await follow($, arg)
      return { text: t().turnedOn(arg) }
    }
    if (wasOn) {
      await turnOff($)
      await $.ui.close({ id: PANE })
      return { text: t().turnedOff }
    }
    await turnOn($)
    const named = await namedPackage($)
    return { text: named === ALL ? t().turnedOn(t().allProcesses) : named ? t().turnedOn(named) : t().turnedOnAuto }
  }).catch(($, e, next) => (next.called ? next(e) : { text: t().failed }))

  // The person's close mark or key is the off switch too; the plugin's own close already turned it off
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await turnOff($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The lines region posts the keys it got; the buttons do the same through scrollBy
  on('ui.message', { element: 'lines' }, async ($, e) => {
    const data = e.data as { scroll?: Scroll; select?: 'begin'; copy?: string; count?: number } | null
    if (data?.select === 'begin' && !isSelecting) {
      // The rows under the pointer hold still: a snapshot of what is shown, the capture going on behind it
      isSelecting = true
      wasFollowing = held === undefined
      if (held === undefined && !isPausedNow) {
        held = buffer.toArray().slice()
        arrivedSinceHeld = 0
      }
    }
    if (data?.scroll) await scrollBy($, data.scroll)
    if (typeof data?.copy === 'string' && data.copy !== '') {
      const copied = await $.ui.copy({ text: data.copy, surface: e.surface })
      const count = typeof data.count === 'number' ? data.count : data.copy.split('\n').length
      $.ui.toast(copied.isCopied ? t().copied(count) : t().copyFailed)
      await endSelection($)
    }
    return {}
  })

  // The wheel and the scroll keys over the pane move the lines, not the window: the header stays put
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.origin.kind === 'person' && e.by !== 0) await scrollBy($, e.by)
    return {}
  }).catch(() => ({}))

  // While off the tool waits behind ToolSearch and costs the prompt nothing but its name
  on('tool.describe', { tool: 'mcp__android-logcat__logcat_read' }, async ($, e, next) => {
    const described = await next(e)
    return { ...described, isDeferred: !(await read($, isOn)) }
  })

  on('tool.call', { tool: 'mcp__android-logcat__logcat_read' }, async ($, e) => {
    if (!(await read($, isOn))) return { result: t().toolOff }
    const input = e as unknown as { level?: unknown; filter?: unknown; lines?: unknown }
    const min = asLevel(input.level, 'V')
    const text = typeof input.filter === 'string' ? input.filter : ''
    const limit = clampInt(input.lines, TOOL_LINES, 1, TOOL_LINES_MAX)
    const lines = tail(buffer.toArray(), min, text, limit).map(formatLine)
    return { result: lines.length === 0 ? t().empty : lines.join('\n') }
  }).catch(() => ({ deny: 'logcat_read failed' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : undefined
    const Select = 'Select' in table ? table.Select : undefined
    const Client = 'Client' in table ? table.Client : undefined
    // The terminal shows each Button's hotkey; a pointer surface draws the Buttons alone, the scrolling ones dim
    const isTui = e.surface === 'terminal'
    const hk = (key: string) => (isTui ? key : undefined)

    const min = asLevel(await read($, level), DEFAULT_LEVEL)
    const wrap = await read($, isWrap)
    const epoch = await read($, selectionEpoch)
    const text = await read($, filter)
    const paused = await read($, isPaused)
    const shown = tail(viewed(), min, text, SCROLLBACK)
    // Header, controls and filter take three rows in the terminal; a pointer surface's native select, buttons and
    // field stand taller than a line of text, so there they take about five
    const room = Math.max(1, (e.props.scroll?.bodyRows ?? options.rows) - (isTui ? 3 : 5))
    lastRoom = room
    const offset = Math.min(await read($, scroll), Math.max(0, shown.length - room))
    const scrollTo = (kind: Scroll) => {
      void (async () => {
        if (kind === 'newest') await endSelection($)
        await scrollBy($, kind)
      })()
    }
    const toggleWrap = async () => {
      const next = !(await read($, isWrap))
      await update($, isWrap, () => next)
      try {
        await $.store.set(STORE_WRAP, next)
      } catch {
        // this session keeps it
      }
    }
    // The repo's apps on the device to switch to, and every process; the one followed now first when it is none of them
    const choices = status.kind === 'live' || status.kind === 'not-installed' ? status.choices : []
    const current = status.kind === 'live' ? (status.isAll ? ALL : status.package) : status.kind === 'not-installed' ? status.package : ''
    const appOptions = [
      ...(current && current !== ALL && !choices.includes(current) ? [{ value: current, label: current }] : []),
      ...choices.map(name => ({ value: name, label: name })),
      { value: ALL, label: t().allProcesses },
    ]
    const hasAppPicker = current !== '' && (choices.length >= 2 || (choices.length >= 1 && !choices.includes(current)))
    const state = statusText()
    const pkg = packageLabel()
    const extra =
      status.kind === 'live'
        ? [status.model, status.uid !== undefined ? `uid ${status.uid}` : status.pid !== undefined ? `pid ${status.pid}` : ''].filter(Boolean).join(' · ')
        : ''

    const togglePause = async () => {
      const next = !(await read($, isPaused))
      if (next) frozen = buffer.toArray().slice()
      isPausedNow = next
      await update($, isPaused, () => next)
    }
    const clearAll = () => {
      clear()
      void update($, scroll, () => 0)
      void update($, selectionEpoch, n => n + 1)
    }

    return (
      <Box flexDirection="column">
        {isTui ? (
          <Text wrap="truncate-end">
            <Text weight="bold">{t().paneTitle}</Text> <Text>{pkg}</Text> <Text dimColor>{extra}</Text> <Text color={state.color}>{state.text}</Text>
          </Text>
        ) : (
          // The pane's title bar names it: the package and device at the left, the state at the right
          <Box justifyContent="space-between" columnGap={1}>
            <Box flexShrink={1} overflow="hidden">
              <Text wrap="truncate-end">
                <Text weight="semibold">{pkg}</Text>{' '}
                <Text size="caption" dimColor>
                  {extra}
                </Text>
              </Text>
            </Box>
            <Text size="caption" color={state.color}>
              {state.text}
            </Text>
          </Box>
        )}
        <Box gap={1} alignItems="center" flexWrap="wrap">
          {Select && hasAppPicker && (
            <Select
              key="package"
              label={t().app}
              options={appOptions}
              value={current}
              onSelect={value => {
                if (value !== current && (value === ALL || isPackageName(value))) void follow($, value)
              }}
            />
          )}
          {Select && (
            <Select
              key="level"
              label={t().level}
              options={LEVEL_OPTIONS}
              value={min}
              onSelect={value => void update($, level, () => asLevel(value, DEFAULT_LEVEL))}
            />
          )}
          <Button key="pause" hotkey={hk('p')} variant={isTui ? undefined : 'primary'} onPress={() => void togglePause()}>
            {paused ? t().resume : t().pause}
          </Button>
          <Button key="clear" hotkey={hk('c')} dimColor={!isTui} onPress={clearAll}>
            {t().clear}
          </Button>
          <Button key="older" hotkey={hk('u')} dimColor={!isTui} onPress={() => scrollTo('pageup')}>
            {t().older}
          </Button>
          <Button key="newer" hotkey={hk('d')} dimColor={!isTui} onPress={() => scrollTo('pagedown')}>
            {t().newer}
          </Button>
          <Button key="follow" hotkey={hk('f')} dimColor={!isTui} onPress={() => scrollTo('newest')}>
            {t().follow}
          </Button>
          <Button key="wrap" hotkey={hk('w')} dimColor={!isTui} onPress={() => void toggleWrap()}>
            {wrap ? t().unwrap : t().wrap}
          </Button>
        </Box>
        {Input && (
          <Box width="100%">
            <Input
              key="filter"
              label={t().filter}
              placeholder={t().filterPlaceholder}
              value={text}
              onInput={value => void update($, filter, () => value)}
              onSubmit={value => void update($, filter, () => value)}
            />
          </Box>
        )}
        {Client ? (
          <Client
            key="lines"
            module="./lines.tsx"
            width="100%"
            height={room}
            props={linesProps(shown, offset, room, e.props.bodyColumns ?? 80, arrivedSinceHeld, isTui, wrap, epoch)}
          />
        ) : (
          <Box flexDirection="column">
            {shown.length === 0 && <Text dimColor>{t().empty}</Text>}
            {shown.slice(Math.max(0, shown.length - room - offset), shown.length - offset).map(entry => line(entry, Text, isTui))}
          </Box>
        )}
      </Box>
    )
  })
}

function linesProps(lines: Entry[], offset: number, rows: number, columns: number, newerCount: number, isTui: boolean, isWrap: boolean, epoch: number): LinesProps {
  return { lines, offset, rows, columns, newerCount, empty: t().empty, newer: t().newerLines, isTui, isWrap, epoch }
}
