import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { detectApplicationId, findAdb, listDevices, pidOf, resolvePackage } from './adb'
import { setLanguage, t } from './i18n'
import type { LinesProps } from './lines'
import { line } from './line'
import { asLevel, clampInt, formatLine, isPackageName, LEVEL_OPTIONS, logcatArgv, parseLine, RingBuffer, splitLines, stampOf, tail } from './model'
import type { Entry, Level } from './model'

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

// What survives a hot reload: on or off, the package the person named, the filters
const isOn = atom({ plugin: 'android-logcat', key: 'isOn' } as const, false)
const override = atom({ plugin: 'android-logcat', key: 'override' } as const, null)
const level = atom({ plugin: 'android-logcat', key: 'level' } as const, 'D')
const filter = atom({ plugin: 'android-logcat', key: 'filter' } as const, '')
const isPaused = atom({ plugin: 'android-logcat', key: 'isPaused' } as const, false)
// A write redraws the pane, which is how a press or a key moves the lines
const scroll = atom({ plugin: 'android-logcat', key: 'scroll' } as const, 0)

type Status =
  | { kind: 'off' | 'starting' | 'no-adb' | 'no-device' }
  | { kind: 'not-installed'; package: string }
  | { kind: 'reconnecting'; package: string; reason?: string }
  | { kind: 'error'; reason: string }
  | { kind: 'live'; package: string; isAll: boolean; candidates: number; uid?: number; pid?: number; serial: string; model?: string }

type Capture = {
  controller: AbortController
  // The running child's stream, so a stop ends it even while no line arrives
  stream?: AsyncGenerator<unknown, unknown>
  // Found once per capture: the adb to run and the repo's app (null: looked, none)
  adb?: string
  base?: string | null
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

function setStatus(next: Status) {
  status = next
  isDirty = true
}

function ingest(entry: Entry) {
  buffer.push(entry)
  if (entry.level === 'E' || entry.level === 'F') counts.errors++
  else if (entry.level === 'W') counts.warnings++
  if (held) arrivedSinceHeld++
  isDirty = true
}

function clear() {
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

  if (self.base === undefined) {
    self.base = (await read($, override)) ?? (options.package || undefined) ?? (await detectApplicationId($, await $.session.cwd())) ?? null
  }
  const base = self.base ?? undefined
  let spec: { uid?: number; pid?: number } = {}
  let pkg = base
  let candidates = 0
  if (base) {
    const picked = self.avoidUid ? undefined : await resolvePackage($, adb, device.serial, base)
    if (picked) {
      pkg = picked.chosen.name
      candidates = picked.candidates.length
      spec = { uid: picked.chosen.uid }
    } else {
      const pid = await pidOf($, adb, device.serial, base)
      if (pid === undefined) {
        setStatus({ kind: 'not-installed', package: base })
        return sleep(RETRY_MS)
      }
      spec = { pid }
    }
  }
  if (signal.aborted) return false

  setStatus({ kind: 'live', package: pkg ?? '', isAll: !pkg, candidates, ...spec, serial: device.serial, model: device.model })
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
  } else if (landed === 0 && held !== undefined) {
    held = undefined
    arrivedSinceHeld = 0
    isDirty = true
  }
}

async function visibleNow($: EngineInterface): Promise<number> {
  return visibleCount(asLevel(await read($, level), 'D'), await read($, filter))
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
    return status.candidates > 1 ? t().oneOf(status.package, status.candidates) : status.package
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
    if (arg !== '') {
      if (!isPackageName(arg)) return { text: t().badPackage(arg) }
      await update($, override, () => arg)
      await turnOn($)
      return { text: t().turnedOn(arg) }
    }
    if (wasOn) {
      await turnOff($)
      await $.ui.close({ id: PANE })
      return { text: t().turnedOff }
    }
    await turnOn($)
    return { text: t().turnedOn(options.package) }
  }).catch(($, e, next) => (next.called ? next(e) : { text: t().failed }))

  // The person's close mark or key is the off switch too; the plugin's own close already turned it off
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await turnOff($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The lines region posts the keys it got; the buttons do the same through scrollBy
  on('ui.message', { element: 'lines' }, async ($, e) => {
    const data = e.data as { scroll?: Scroll } | null
    if (data?.scroll) await scrollBy($, data.scroll)
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

    const min = asLevel(await read($, level), 'D')
    const text = await read($, filter)
    const paused = await read($, isPaused)
    const shown = tail(viewed(), min, text, SCROLLBACK)
    // Header, controls and filter take three rows; the lines get the rest
    const room = Math.max(1, (e.props.scroll?.bodyRows ?? options.rows) - 3)
    lastRoom = room
    const offset = Math.min(await read($, scroll), Math.max(0, shown.length - room))
    const scrollTo = (kind: Scroll) => void scrollBy($, kind)
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
    }

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold>{t().paneTitle}</Text> <Text>{pkg}</Text> <Text dimColor>{extra}</Text> <Text color={state.color}>{state.text}</Text>
        </Text>
        <Box gap={1}>
          {Select && (
            <Select
              key="level"
              label={t().level}
              options={LEVEL_OPTIONS}
              value={min}
              onSelect={value => void update($, level, () => asLevel(value, 'D'))}
            />
          )}
          <Button key="pause" hotkey="p" onPress={() => void togglePause()}>
            {paused ? t().resume : t().pause}
          </Button>
          <Button key="clear" hotkey="c" onPress={clearAll}>
            {t().clear}
          </Button>
          <Button key="older" hotkey="u" onPress={() => scrollTo('pageup')}>
            {t().older}
          </Button>
          <Button key="newer" hotkey="d" onPress={() => scrollTo('pagedown')}>
            {t().newer}
          </Button>
          <Button key="follow" hotkey="f" onPress={() => scrollTo('newest')}>
            {t().follow}
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
          <Client key="lines" module="./lines.tsx" height={room} props={linesProps(shown, offset, room, arrivedSinceHeld)} />
        ) : (
          <Box flexDirection="column">
            {shown.length === 0 && <Text dimColor>{t().empty}</Text>}
            {shown.slice(Math.max(0, shown.length - room - offset), shown.length - offset).map(entry => line(entry, Text))}
          </Box>
        )}
      </Box>
    )
  })
}

function linesProps(lines: Entry[], offset: number, rows: number, newerCount: number): LinesProps {
  return { lines, offset, rows, newerCount, empty: t().empty, newer: t().newerLines }
}
