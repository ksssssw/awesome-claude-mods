import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PANE = {
  plugin: 'android-device',
  component: 'Pane',
  requestId: 'adb',
  props: {
    title: 'adb',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 16 },
    view: {},
  },
} as const

const ONE = 'List of devices attached\nSERIAL1 device usb:1-1 product:panther model:Pixel_8 device:panther transport_id:3\n'
const TWO = ONE + 'SERIAL2 device product:q7qksx model:SM_F966N device:q7q transport_id:5\n'

const DUMPSYS = [
  '  Package [com.example.app.debug] (5a1b2c3):',
  '    versionCode=2310 minSdk=24 targetSdk=34',
  '    versionName=2.3.1',
  '    firstInstallTime=2026-10-01 09:00:00',
  '    lastUpdateTime=2026-11-02 14:20:11',
  '    installerPackageName=null',
  '    User 0: installed=true hidden=false enabled=0',
].join('\n')

const APK = '/repo/app/build/outputs/apk/debug/app-debug.apk'
const DROPPED = '/drops/app-release.apk'

const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const entry = (name: string, kind: 'file' | 'dir', mtimeMs = 0) => ({ name, kind, size: 10, mtimeMs, isLink: false })

type Adb = {
  clock: ReturnType<typeof mock.clock>
  // What the plugin put in the prompt box, in order
  fills: string[]
  // Every argv run, in order
  runs: string[][]
  // What `adb devices -l` answers
  devices: string
  // What the next `adb install` answers
  install: string
  // Whether the app is installed, for `cmd package list` and `dumpsys package`
  isInstalled: boolean
}

// Nothing sits beneath the plugin: these hooks stand for the engine, for adb and for the repo on disk
function engine(on: On, devices = ONE): Adb {
  const clock = mock.clock(on)
  const adb: Adb = { clock, fills: [], runs: [], devices, install: 'Performing Streamed Install\nSuccess\n', isInstalled: true }
  mock.env(on, { HOME: '/tmp/nobody' })
  on('command.register', () => ({ value: { command: 'adb' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__android-device__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('prompt.submit', (_, e) => ({ text: (e as { text: string }).text }))
  on('prompt.fill', (_, e) => {
    adb.fills.push(e.text)
    return { isFilled: true }
  })
  on('fs.exists', (_, e) => ({ value: e.path === APK || e.path === DROPPED }))
  on('fs.list', (_, e) => {
    switch (e.path) {
      case '/repo':
        return { value: [entry('settings.gradle.kts', 'file'), entry('app', 'dir'), entry('build.gradle.kts', 'file')] }
      case '/repo/app':
        return { value: [entry('build.gradle.kts', 'file'), entry('build', 'dir'), entry('src', 'dir')] }
      case '/repo/app/build/outputs/apk':
        return { value: [entry('debug', 'dir'), entry('release', 'dir')] }
      case '/repo/app/build/outputs/apk/debug':
        return { value: [entry('app-debug.apk', 'file', 3000), entry('output-metadata.json', 'file')] }
      case '/repo/app/build/outputs/apk/release':
        return { value: [entry('app-release.apk', 'file', 1000)] }
      default:
        throw new Error('ENOENT')
    }
  })
  on('fs.read', (_, e) => {
    if (e.path === '/repo/app/build.gradle.kts') return { value: 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.app" } }' }
    if (e.path === '/repo/build.gradle.kts') return { value: 'plugins { id("com.android.application") version "8.5.0" apply false }' }
    throw new Error('ENOENT')
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    adb.runs.push(argv)
    const line = argv.join(' ')
    if (line === 'adb version') return ran('Android Debug Bridge version 1.0.41\n')
    if (line === 'aapt version') return ran('', 1)
    if (line.includes('devices -l')) return ran(adb.devices)
    if (line.includes('getprop ro.product.model')) return ran(argv[2] === 'SERIAL2' ? 'SM-F966N\n' : 'Pixel 8\n')
    if (line.includes('getprop ro.product.manufacturer')) return ran('Google\n')
    if (line.includes('getprop ro.build.version.release')) return ran('14\n')
    if (line.includes('getprop ro.build.version.sdk')) return ran('34\n')
    if (line.includes('dumpsys battery')) return ran('  level: 82\n')
    if (line.includes('dumpsys power')) return ran('Display Power: state=ON\n')
    if (line.includes('df /data')) return ran('Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-5 112345678 42000000 22347776 66% /data\n')
    if (line.includes('list packages')) return ran(adb.isInstalled ? 'package:com.example.app.debug uid:10234\n' : '')
    if (line.includes('dumpsys package')) return ran(adb.isInstalled ? DUMPSYS : 'Unable to find package: com.example.app\n')
    if (line.includes('pidof -s')) return ran(adb.isInstalled ? '12345\n' : '', adb.isInstalled ? 0 : 1)
    if (argv[3] === 'install') return ran(adb.install, adb.install.includes('Success') ? 0 : 1)
    if (argv[3] === 'uninstall') return ran('Success\n')
    if (line.includes('monkey')) return ran('Events injected: 1\n')
    if (line.includes('am force-stop')) return ran('')
    if (line.includes('pm clear')) return ran('Success\n')
    if (line.includes('dumpsys activity activities')) return ran('  topResumedActivity=ActivityRecord{1 u0 com.example.app.debug/.MainActivity t5}\n')
    if (line.includes('pm path')) return ran('package:/data/app/~~x==/com.example.app.debug-y==/base.apk\n')
    if (line.includes('screencap') || argv[3] === 'pull' || line.includes(' rm -f')) return ran('')
    return ran('', 1)
  })
  return adb
}

// What the engine stamps on a command the person typed
const COMMAND = { origin: { isPerson: true }, presentation: { isFullscreen: true } }

async function turnOn($: Engine, { clock }: Adb, args = '') {
  await $.command.run({ command: 'adb', args, ...COMMAND } as never)
  // The first refresh lists the devices and reads the chosen one; the redraw timer runs
  for (let i = 0; i < 5; i++) await clock.advance(100)
}

const settle = async ({ clock }: Adb) => {
  for (let i = 0; i < 5; i++) await clock.advance(100)
}

test('the pane is off until /adb, then shows the device and the app installed on it, on both surfaces', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await before.find({ type: 'Text', text: /off/ })).toBeDefined()
  await before.unmount()

  await turnOn($, adb)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Pixel 8 · Google · USB · device/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /SERIAL1 · Android 14 \(API 34\) · screen on/ })).toBeDefined()
  // The gauges, labeled; how many cells fill is barCells's, tested on its own
  expect(await ui.find({ type: 'Text', text: /^Battery/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Storage/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /82%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /21\.3 GB free of 107\.1 GB/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /com\.example\.app\.debug/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /v2\.3\.1 \(2310\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /running \(pid 12345\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'launch' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'pick-apk' })).toBeDefined()
  // One device: no switch button, no install waiting
  expect(await ui.find({ type: 'Button', key: 'switch' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'install' })).toBeUndefined()
  await ui.unmount()

  // The desktop draws the same facts with captions and colored strips instead of glyphs
  const gui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await gui.find({ type: 'Text', text: /^DEVICE$/ })).toBeDefined()
  expect(await gui.find({ type: 'Text', text: /Pixel 8 · Google · USB · device/ })).toBeDefined()
  expect(await gui.find({ type: 'Text', text: /82%/ })).toBeDefined()
  expect(await gui.find({ type: 'Button', key: 'launch' })).toBeDefined()
  await gui.unmount()
  await $.command.run({ command: 'adb', args: 'off', ...COMMAND } as never)
})

test('with two devices none is chosen until d and a digit pick one', async ($, on) => {
  const adb = engine(on, TWO)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /several devices/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 connected/ })).toBeDefined()
  await ui.press({ key: 'switch' })
  expect(await ui.find({ type: 'Button', key: 'device-2', text: /SM F966N/ })).toBeDefined()
  await ui.press({ key: 'device-2' })
  await settle(adb)
  expect(await ui.find({ type: 'Text', text: /SM-F966N · Google/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'device-2' })).toBeUndefined()
  await ui.unmount()

  // The choice is what the tools and the command see
  const list = await $.tool.call({ tool: 'mcp__android-device__device_list' } as never)
  expect(list.result).toContain('* SERIAL2')
  const picked = await $.command.run({ command: 'adb', args: 'select 1', ...COMMAND } as never)
  expect(picked.text).toContain('SERIAL1')
  await $.command.run({ command: 'adb', args: 'off', ...COMMAND } as never)
})

test('an .apk path alone in the prompt is dropped and waits in the Install block; i installs it', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const dropped = await $.prompt.submit({ text: ' /drops/app-release.apk ', origin: { kind: 'composer' } } as never)
  expect(dropped.drop).toContain('app-release.apk')
  await settle(adb)
  // The path left the box once the drop settled
  expect(adb.fills).toEqual([''])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /app-release\.apk waiting/ })).toBeDefined()

  await ui.press({ key: 'install' })
  await settle(adb)
  const installed = adb.runs.find(argv => argv[3] === 'install')
  expect(installed).toEqual(['adb', '-s', 'SERIAL1', 'install', '-r', DROPPED])
  expect(await ui.find({ type: 'Text', text: /^app-release\.apk$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^v2\.3\.1 \(2310\) · / })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'install' })).toBeUndefined()
  await ui.unmount()

  // A prompt that is not a path alone goes to the model untouched
  const spoken = await $.prompt.submit({ text: 'install /drops/app-release.apk please', origin: { kind: 'composer' } } as never)
  expect(spoken.text).toBe('install /drops/app-release.apk please')
  const missing = await $.prompt.submit({ text: '/drops/missing.apk', origin: { kind: 'composer' } } as never)
  expect(missing.text).toBe('/drops/missing.apk')
  await $.command.run({ command: 'adb', args: 'off', ...COMMAND } as never)
})

test('a downgrade failure asks before -d is added; y retries with it, n keeps the APK waiting', async ($, on) => {
  const adb = engine(on)
  adb.install = 'adb: failed to install app-debug.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Update version code 10 is older than current 2310]\n'
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb, `install ${APK}`)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'install' })
  await settle(adb)
  expect(await ui.find({ type: 'Text', text: /FAILED INSTALL_FAILED_VERSION_DOWNGRADE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Retry with -d/ })).toBeDefined()
  // The question locks the other keys
  expect(await ui.find({ type: 'Button', key: 'launch' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'install' })).toBeUndefined()

  await ui.press({ key: 'no' })
  expect(await ui.find({ type: 'Text', text: /Retry with -d/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'install' })).toBeDefined()

  await ui.press({ key: 'install' })
  await settle(adb)
  adb.install = 'Success\n'
  await ui.press({ key: 'yes' })
  await settle(adb)
  const installs = adb.runs.filter(argv => argv[3] === 'install')
  expect(installs).toHaveLength(3)
  expect(installs[2]).toEqual(['adb', '-s', 'SERIAL1', 'install', '-r', '-d', APK])
  expect(await ui.find({ type: 'Text', text: /^app-debug\.apk$/ })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'adb', args: 'off', ...COMMAND } as never)
})

test('uninstall asks first: n runs nothing, y runs adb uninstall', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'uninstall' })
  expect(await ui.find({ type: 'Text', text: /Uninstall com\.example\.app\.debug\? Its data is lost/ })).toBeDefined()
  await ui.press({ key: 'no' })
  expect(adb.runs.find(argv => argv[3] === 'uninstall')).toBeUndefined()

  await ui.press({ key: 'uninstall' })
  await ui.press({ key: 'yes' })
  await settle(adb)
  expect(adb.runs.find(argv => argv[3] === 'uninstall')).toEqual(['adb', '-s', 'SERIAL1', 'uninstall', 'com.example.app.debug'])
  await ui.unmount()
  await $.command.run({ command: 'adb', args: 'off', ...COMMAND } as never)
})

test('a picks an APK of the repo, newest first', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'pick-apk' })
  expect(await ui.find({ type: 'Button', key: 'apk-1', text: /app-debug\.apk/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'apk-2', text: /app-release\.apk/ })).toBeDefined()
  await ui.press({ key: 'apk-1' })
  expect(await ui.find({ type: 'Text', text: /app-debug\.apk waiting/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /app\/build\/outputs\/apk\/debug/ })).toBeDefined()
  await ui.unmount()

  const listed = await $.tool.call({ tool: 'mcp__android-device__apk_list' } as never)
  expect((listed.result as string).split('\n')[0]).toContain('app-debug.apk')
  await $.command.run({ command: 'adb', args: 'off', ...COMMAND } as never)
})

test('the tools wait behind ToolSearch while off, and apk_install tells the model what a retry needs', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const off = await $.tool.call({ tool: 'mcp__android-device__package_info' } as never)
  expect(off.result).toContain('off')

  await turnOn($, adb)
  const info = await $.tool.call({ tool: 'mcp__android-device__package_info' } as never)
  expect(info.result).toContain('versionName: 2.3.1')
  expect(info.result).toContain('running: yes (pid 12345)')

  adb.install = 'Failure [INSTALL_FAILED_VERSION_DOWNGRADE]\n'
  const failed = await $.tool.call({ tool: 'mcp__android-device__apk_install', path: 'app/build/outputs/apk/debug/app-debug.apk' } as never)
  expect(failed.result).toContain('INSTALL_FAILED_VERSION_DOWNGRADE')
  expect(failed.result).toContain('allowDowngrade')
  expect(adb.runs.filter(argv => argv[3] === 'install')).toHaveLength(1)

  adb.install = 'Success\n'
  const again = await $.tool.call({ tool: 'mcp__android-device__apk_install', path: APK, allowDowngrade: true } as never)
  expect(again.result).toContain('installed com.example.app.debug v2.3.1 (2310)')
  expect(adb.runs.filter(argv => argv[3] === 'install')[1]).toContain('-d')

  const launched = await $.tool.call({ tool: 'mcp__android-device__app_launch' } as never)
  expect(launched.result).toContain('launched com.example.app.debug')
  const shot = await $.tool.call({ tool: 'mcp__android-device__screenshot' } as never)
  expect(shot.result).toMatch(/^\/tmp\/nobody\/Downloads\/Pixel_8_\d{8}-\d{6}\.png$/)
  const pulled = await $.tool.call({ tool: 'mcp__android-device__apk_pull' } as never)
  expect(pulled.result).toContain('/tmp/nobody/Downloads/com.example.app.debug_2.3.1_2310.apk')
  expect(adb.runs.find(argv => argv[3] === 'pull' && argv[4]?.endsWith('base.apk'))).toBeDefined()
  await $.command.run({ command: 'adb', args: 'off', ...COMMAND } as never)
})

test('a package argument the device shell could misread is refused', async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({ command: 'adb', args: 'package com.x; reboot', ...COMMAND } as never)
  expect(answer.text).toContain('not a package name')
  const serial = await $.command.run({ command: 'adb', args: 'select x; reboot', ...COMMAND } as never)
  expect(serial.text).toContain('not a device serial')
  expect(adb.runs.filter(argv => argv.includes('shell') && argv.join(' ').includes('reboot'))).toHaveLength(0)
  await $.command.run({ command: 'adb', args: 'off', ...COMMAND } as never)
})

test('with language set to ko the pane draws in Korean', { options: { language: 'ko' } }, async ($, on) => {
  const adb = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOn($, adb)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /설치됨/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'launch', text: /실행/ })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'adb', args: 'off', ...COMMAND } as never)
})
