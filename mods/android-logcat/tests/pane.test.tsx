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

// Nothing sits beneath the plugin: these hooks stand for the engine and for adb
function engine(on: On) {
  const clock = mock.clock(on)
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
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: LINES.slice(0, 40) }
    yield { stream: 'stdout' as const, text: LINES.slice(40) + '\n' }
    await new Promise<never>(() => {})
    return { value: { code: 0, signal: null } }
  })
  return clock
}

// What the engine stamps on a command the person typed
const COMMAND = { origin: { isPerson: true }, presentation: { isFullscreen: true } }

async function turnOn($: Engine, clock: ReturnType<typeof mock.clock>) {
  await $.command.run({ command: 'logcat', args: 'com.example.app', ...COMMAND } as never)
  // The capture resolves adb, the device and the package, then reads the lines; the redraw timer runs
  for (let i = 0; i < 5; i++) await clock.advance(100)
}

test('the pane is empty until /logcat, then shows the device, the package and colored lines', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await before.find({ type: 'Text', text: /off/ })).toBeDefined()
  await before.unmount()

  await turnOn($, clock)

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

test('the level picker and the text filter narrow what is shown', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, clock)

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
  const clock = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, clock)

  // A plugin tool's answer is its own `result`; the model reads it as text
  const errors = await $.tool.call({ tool: 'mcp__android-logcat__logcat_read', level: 'E' } as never)
  expect(errors.result).toContain('E/Crash: java.lang.IllegalStateException')
  expect(errors.result).not.toContain('W/Net')

  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
  const off = await $.tool.call({ tool: 'mcp__android-logcat__logcat_read' } as never)
  expect(off.result).toContain('logcat is off')
})

test('the lines region scrolls back by key and by the buttons, and follows again on f', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, clock)

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
  const clock = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, clock)

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 6 } }, surface: 'terminal' })
  await ui.select({ key: 'level', value: 'V' })
  const moved = await $.ui.scroll({ component: 'Pane', requestId: 'logcat', offset: 0, by: -2, bodyRows: 6, contentRows: 6, origin: { kind: 'person' } } as never)
  expect(moved).toEqual({})
  expect(await ui.find({ type: 'Text', text: /verbose noise/, in: 'lines' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /E\/Crash:/, in: 'lines' })).toBeUndefined()
  await ui.unmount()
  await $.command.run({ command: 'logcat', args: 'off', ...COMMAND } as never)
})
