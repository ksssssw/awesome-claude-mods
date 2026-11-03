import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PANE = {
  plugin: 'android-logcat',
  component: 'Pane',
  requestId: 'logcat',
  props: {
    title: 'logcat',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const LINES = [
  '--------- beginning of main',
  '11-02 14:03:21.001  1234  1234 V Quiet   : verbose noise',
  '11-02 14:03:21.002  1234  1234 D Net     : GET /api/items',
  '11-02 14:03:21.003  1234  1234 I App     : started',
  '11-02 14:03:21.004  1234  1234 W Net     : slow response',
  '11-02 14:03:21.005  1234  1234 E Crash   : java.lang.IllegalStateException',
].join('\n')

const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

const MORE = ['11-02 14:03:22.000  1234  1234 I App     : later one', '11-02 14:03:22.001  1234  1234 E Crash   : later two'].join('\n')

type Adb = {
  clock: ReturnType<typeof mock.clock>
  // Every logcat argv spawned, in order
  spawns: string[][]
  // Lets the running child print MORE
  release: () => void
  // Whether the first child ends on its own after its lines (a dropped connection)
  endFirst: boolean
}

// Nothing sits beneath the plugin: these hooks stand for the engine and for adb
function engine(on: On, endFirst = false): Adb {
  const clock = mock.clock(on)
  const adb: Adb = { clock, spawns: [], release: () => undefined, endFirst }
  mock.env(on, { HOME: '/tmp/nobody' })
  on('command.register', () => ({ value: { command: 'logcat' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__android-logcat__logcat_read' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    if (argv.endsWith('adb version')) return ran('Android Debug Bridge version 1.0.41\n')
    if (argv.includes('devices -l')) return ran('List of devices attached\nSERIAL1 device model:Pixel_8\n')
    if (argv.includes('list packages')) return ran('package:com.example.app.debug uid:10234\n')
    return ran('', 1)
  })
  on('process.spawn', async function* (_, e) {
    adb.spawns.push([...e.argv])
    const isFirst = adb.spawns.length === 1
    yield { stream: 'stdout' as const, text: LINES.slice(0, 40) }
    yield { stream: 'stdout' as const, text: LINES.slice(40) + '\n' }
    if (isFirst && adb.endFirst) return { value: { code: 1, signal: null } }
    await new Promise<void>(resolve => {
      adb.release = resolve
    })
    yield { stream: 'stdout' as const, text: MORE + '\n' }
    await new Promise<never>(() => {})
    return { value: { code: 0, signal: null } }
  })
  return adb
}

// What the engine stamps on a command the person typed
const COMMAND = { origin: { isPerson: true }, presentation: { isFullscreen: true } }

async function turnOn($: Engine, { clock }: Adb) {
  await $.command.run({ command: 'logcat', args: 'com.example.app', ...COMMAND } as never)
  // The capture resolves adb, the device and the package, then reads the lines; the redraw timer runs
  for (let i = 0; i < 5; i++) await clock.advance(100)
}

test('the pane is empty until /logcat, then shows the device, the package and colored lines', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await before.find({ type: 'Text', text: /off/ })).toBeDefined()
  await before.unmount()

  await turnOn($, adb)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /com\.example\.app\.debug/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Pixel 8/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /W\/Net:/, in: 'lines' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /D\/Net:/, in: 'lines' })).toBeDefined()
  // Debug is the default floor: verbose stays out
  expect(await ui.find({ type: 'Text', text: /verbose noise/, in: 'lines' })).toBeUndefined()
  await ui.unmount()
  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
})

test('the desktop draws the lines monospaced with a level badge, and the buttons without hotkeys', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /com\.example\.app\.debug/ })).toBeDefined()
  // The pane's title bar names it: no second logcat title
  expect(await ui.find({ type: 'Text', text: /^logcat$/ })).toBeUndefined()
  // The level a badge on its color, the tag and the message apart; every line in the monospaced face
  const badge = await ui.find({ type: 'Text', text: /^ E $/, in: 'lines' })
  expect(badge?.props.backgroundColor).toBe('#FF6B68')
  expect(await ui.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^java\.lang\.IllegalStateException$/, in: 'lines' }))?.props.color).toBe('#FF6B68')
  for (const button of await ui.findAll({ type: 'Button' })) expect(button.props.hotkey).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'pause' }))?.props.variant).toBe('primary')
  expect((await ui.find({ type: 'Button', key: 'follow' }))?.props.dimColor).toBe(true)
  await ui.unmount()

  // The terminal keeps its hotkeys and its level/tag heads
  const tui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await tui.find({ type: 'Button', key: 'pause' }))?.props.hotkey).toBe('p')
  expect(await tui.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeDefined()
  await tui.unmount()
  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
})

test('the level picker and the text filter narrow what is shown', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.select({ key: 'level', value: 'W' })
  expect(await ui.find({ type: 'Text', text: /D\/Net:/, in: 'lines' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /W\/Net:/, in: 'lines' })).toBeDefined()

  await ui.select({ key: 'level', value: 'V' })
  await ui.input({ key: 'filter', text: 'net', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /verbose noise/, in: 'lines' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /GET \/api\/items/, in: 'lines' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /slow response/, in: 'lines' })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
})

test('logcat_read answers the newest matching lines, and says so while off', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)

  // A plugin tool's answer is its own `result`; the model reads it as text
  const errors = await $.tool.call({ tool: 'mcp__android-logcat__logcat_read', level: 'E' } as never)
  expect(errors.result).toContain('E/Crash: java.lang.IllegalStateException')
  expect(errors.result).not.toContain('W/Net')

  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
  const off = await $.tool.call({ tool: 'mcp__android-logcat__logcat_read' } as never)
  expect(off.result).toContain('logcat is off')
})

test('the lines region scrolls back by key and by the buttons, and follows again on f', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 6 } }, surface: 'terminal' })
  await ui.select({ key: 'level', value: 'V' })
  // Three rows for the lines: of five, the newest three show
  expect(await ui.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /verbose noise/, in: 'lines' })).toBeUndefined()

  await ui.press({ key: 'older' })
  expect(await ui.find({ type: 'Text', text: /verbose noise/, in: 'lines' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /newer lines below/, in: 'lines' })).toBeDefined()

  await ui.press({ key: 'follow' })
  expect(await ui.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeDefined()

  await ui.post({ scroll: 'up' }, { in: 'lines' })
  expect(await ui.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeUndefined()
  await ui.post({ scroll: 'newest' }, { in: 'lines' })
  expect(await ui.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
})

test('the wheel over the pane scrolls the lines and leaves the window alone', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 6 } }, surface: 'terminal' })
  await ui.select({ key: 'level', value: 'V' })
  const moved = await $.ui.scroll({ component: 'Pane', requestId: 'logcat', offset: 0, by: -2, bodyRows: 6, contentRows: 6, origin: { kind: 'person' } } as never)
  expect(moved).toEqual({})
  expect(await ui.find({ type: 'Text', text: /verbose noise/, in: 'lines' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeUndefined()
  await ui.unmount()
  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
})

test('a reconnect resumes from the last line instead of reading the backlog again', async ($, on) => {
  const adb = engine(on, true)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)
  // The first child ended: the loop waits, then spawns again
  for (let i = 0; i < 30; i++) await adb.clock.advance(100)

  expect(adb.spawns).toHaveLength(2)
  expect(adb.spawns[0]).toContain('500')
  expect(adb.spawns[1]).toContain('11-02 14:03:21.005')
  const all = await $.tool.call({ tool: 'mcp__android-logcat__logcat_read', level: 'E' } as never)
  expect((all.result as string).split('\n')).toHaveLength(1)
  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
})

test('a package argument the device shell could misread is refused', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({ command: 'logcat', args: 'com.x; reboot', ...COMMAND } as never)
  expect(answer.text).toContain('not a package name')
  expect(adb.spawns).toHaveLength(0)
})

test('turning logcat off and on again starts unpaused and at the newest line', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)
  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await first.press({ key: 'pause' })
  expect(await first.find({ type: 'Button', key: 'pause', text: /Resume/ })).toBeDefined()
  await first.unmount()
  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)

  await turnOn($, adb)
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Button', key: 'pause', text: /Pause/ })).toBeDefined()
  expect(await again.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeDefined()
  await again.unmount()
  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
})

test('while scrolled up the rows stay put as lines arrive, and f shows the new ones', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 6 } }, surface: 'terminal' })
  await ui.select({ key: 'level', value: 'V' })
  await ui.press({ key: 'older' })
  expect(await ui.find({ type: 'Text', text: /verbose noise/, in: 'lines' })).toBeDefined()

  adb.release()
  for (let i = 0; i < 5; i++) await adb.clock.advance(100)
  // Two more lines arrived; a state write redraws the mount (the timer's invalidate is the surface's)
  await ui.select({ key: 'level', value: 'V' })
  // The view holds, the note counts them
  expect(await ui.find({ type: 'Text', text: /verbose noise/, in: 'lines' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /later/, in: 'lines' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /4 newer lines/, in: 'lines' })).toBeDefined()

  await ui.press({ key: 'follow' })
  expect(await ui.find({ type: 'Text', text: /later two/, in: 'lines' })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
})
