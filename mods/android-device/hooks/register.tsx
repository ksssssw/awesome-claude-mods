import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer, ToolDescribeInput, ToolDescribeResult } from 'claude-code'

import type { Confirm, Failure, LastInstall, LastVideo, Pending, Pick, Recording } from '../types'
import {
  apkPaths,
  appInfo,
  badging,
  clearData,
  deviceInfo,
  deviceSkin,
  deviceSpecs,
  findAapt,
  findAdb,
  findFfmpeg,
  forceStop,
  foregroundApp,
  install,
  launch,
  listDevices,
  openFile,
  pull,
  pullFile,
  recordArgv,
  resolvePackage,
  scanRepo,
  screenshot,
  stopRecording,
  uninstall,
  videoFrames,
  videoPoster,
} from './adb'
import type { Repo } from './adb'
import { setLanguage, t } from './i18n'
import {
  apkPathOf,
  barCells,
  basename,
  captureName,
  cellWidth,
  chooseSerial,
  classifyFailure,
  dirname,
  flagOf,
  formatBytes,
  formatCluster,
  formatClock,
  formatDuration,
  fitCells,
  formatStamp,
  isAbsolute,
  isPackageName,
  clampInt,
  isSerial,
  padCells,
  pngSize,
  pulledName,
  refineFailure,
  relativeTo,
  shortStamp,
  tildePath,
} from './model'
import type { AppInfo, Badging, Device, DeviceInfo, Skin, Specs } from './model'

const PANE = 'adb'
const COMMAND = 'adb'

// How often the connected devices are listed, and the chosen one's state read
const DEVICES_MS = 2000
const STATUS_MS = 10_000
// At most this often the pane is redrawn while something changed
const REDRAW_MS = 100
// A second's tick for the install and recording counters
const TICK_MS = 1000
// Columns under which a block's detail line is split in two
const NARROW = 60
const LIST_MAX = 9
// After a drop, how long until the prompt box is emptied of the path
const CLEAR_BOX_MS = 100

// What survives a hot reload: on or off, the chosen device, the waiting APK and the open questions
const isOn = atom({ plugin: 'android-device', key: 'isOn' } as const, false)
const serial = atom({ plugin: 'android-device', key: 'serial' } as const, '')
const override = atom({ plugin: 'android-device', key: 'override' } as const, null)
const pending = atom({ plugin: 'android-device', key: 'pending' } as const, null)
const last = atom({ plugin: 'android-device', key: 'last' } as const, null)
const pick = atom({ plugin: 'android-device', key: 'pick' } as const, 'none')
const confirm = atom({ plugin: 'android-device', key: 'confirm' } as const, null)
const recording = atom({ plugin: 'android-device', key: 'recording' } as const, null)
const lastShot = atom({ plugin: 'android-device', key: 'lastShot' } as const, null)
const lastVideo = atom({ plugin: 'android-device', key: 'lastVideo' } as const, null)
const lastPull = atom({ plugin: 'android-device', key: 'lastPull' } as const, null)
const specOpen = atom({ plugin: 'android-device', key: 'specOpen' } as const, false)

type Options = { package: string; serial: string; outputDir: string; grantPermissions: boolean; rows: number }

// Lost on a reload: read again from adb and the repo when the pane comes back
let options: Options = { package: '', serial: '', outputDir: '', grantPermissions: false, rows: 16 }
let cwd = ''
let adbPath: string | undefined
// null: looked and found none, so the package of an APK is guessed from the repo
let aaptPath: string | null | undefined
let devices: Device[] = []
let info: DeviceInfo | undefined
// Read once per device: its skin (null: none) and, once the Spec block is unfolded, its hardware
const skins = new Map<string, Skin | null>()
const specs = new Map<string, Specs>()
let specsLoading: string | undefined
// The id the repo or the person names, and the installed package it resolves to (a flavor of it, or itself)
let base: string | undefined
let pkg: string | undefined
let app: AppInfo | undefined
let repo: Repo = { isAndroid: false, ids: [], apks: [] }
let busy: 'install' | 'capture' | undefined
let installStartedAt: number | undefined
let installingFile = ''
let nowMs = 0
// One line under the header: the last outcome or the reason an action did not run
let notice: string | undefined
let noticeColor: string | undefined
let isDirty = false
let timers: Timer[] = []
let recordStream: AsyncGenerator<unknown, unknown> | undefined
let recordingNow: Recording = null
let isToolRegistered = false
let lastStatusLine: string | undefined
// ffmpeg's path once looked for; null when there is none
let ffmpegPath: string | null | undefined
// A recording playing in the pane: its frames, the one shown and the timer that moves on
let player: { path: string; frames: string[]; i: number; timer: Timer } | undefined
let preparingVideo: string | undefined
// Frames a second of in-pane playback
const PLAY_FPS = 10

function mark() {
  isDirty = true
}

// A toast for an outcome; a warning line alone for why an action did not run
function say($: EngineInterface, text: string, toast = true) {
  notice = text
  noticeColor = toast ? undefined : 'warning'
  if (toast) $.ui.toast(text)
  mark()
}

function chosenDevice(s: string): Device | undefined {
  return devices.find(d => d.serial === s)
}

function deviceLabel(d: Device): string {
  return d.model ? `${d.model} (${d.serial})` : d.serial
}

async function packageBase($: EngineInterface): Promise<string | undefined> {
  return (await read($, override)) ?? (options.package || undefined) ?? repo.ids[0]
}

async function ensureAdb($: EngineInterface): Promise<string | undefined> {
  adbPath = adbPath ?? (await findAdb($))
  return adbPath
}

async function refreshRepo($: EngineInterface) {
  cwd = await $.session.cwd()
  repo = await scanRepo($, cwd)
  mark()
}

// Lists the devices; a lost or a new one changes the choice, and the choice's state is read again
async function refreshDevices($: EngineInterface) {
  const adb = await ensureAdb($)
  const before = JSON.stringify(devices)
  devices = adb ? await listDevices($, adb) : []
  const was = await read($, serial)
  const chosen = chooseSerial(devices, was, options.serial)
  if (chosen !== was) {
    await update($, serial, () => chosen)
    if (chosen) await refreshStatus($)
    else {
      info = undefined
      app = undefined
    }
  }
  if (JSON.stringify(devices) !== before) mark()
}

async function refreshStatus($: EngineInterface) {
  const adb = await ensureAdb($)
  const s = await read($, serial)
  if (!adb || !s) {
    info = undefined
    app = undefined
    mark()
    return
  }
  info = await deviceInfo($, adb, s)
  if (!skins.has(s)) skins.set(s, (await deviceSkin($, adb, s)) ?? null)
  if ((await read($, specOpen)) && !specs.has(s)) inBackground($, loadSpecs($))
  base = await packageBase($)
  pkg = base ? ((await resolvePackage($, adb, s, base)) ?? base) : undefined
  app = pkg ? await appInfo($, adb, s, pkg) : undefined
  mark()
}

// Reads the chosen device's hardware into the cache; another read for the same device waits for none
async function loadSpecs($: EngineInterface) {
  const adb = await ensureAdb($)
  const s = await read($, serial)
  if (!adb || !s || chosenDevice(s)?.state !== 'device' || specsLoading === s) return
  specsLoading = s
  mark()
  try {
    specs.set(s, await deviceSpecs($, adb, s))
  } finally {
    specsLoading = undefined
    mark()
  }
}

async function toggleSpecs($: EngineInterface) {
  const open = !(await read($, specOpen))
  await update($, specOpen, () => open)
  mark()
  if (open && !specs.has(await read($, serial))) await loadSpecs($)
}

// With force (Refresh), the chosen device's hardware is read again too, where the Spec block is unfolded
async function refreshAll($: EngineInterface, force = false) {
  if (force) {
    const s = await read($, serial)
    specs.delete(s)
    skins.delete(s)
  }
  await refreshRepo($)
  await refreshDevices($)
  await refreshStatus($)
}

// A refresh left running in the background: a failure (the engine busy, a refused read) is shown, never unheard
function inBackground($: EngineInterface, work: Promise<unknown>) {
  work.catch((error: unknown) => say($, error instanceof Error ? error.message : String(error), false))
}

// What an action needs: adb and a chosen online device; says why when either is missing
async function ready($: EngineInterface): Promise<{ adb: string; s: string } | undefined> {
  const adb = await ensureAdb($)
  if (!adb) {
    say($, t().noAdb, false)
    return undefined
  }
  const s = await read($, serial)
  if (!s || chosenDevice(s)?.state !== 'device') {
    say($, devices.length > 1 ? t().pickDevice : devices.length === 0 ? t().noDevice : t().needDevice, false)
    return undefined
  }
  if (busy) {
    say($, t().busy, false)
    return undefined
  }
  return { adb, s }
}

type InstallOutcome = { ok: true; last: NonNullable<LastInstall> } | { ok: false; failure: Failure } | { ok: false; reason: string }

// One `adb install -r` of the waiting APK; a failure is left in the Install block as a question
async function runInstall($: EngineInterface, p: NonNullable<Pending>): Promise<InstallOutcome> {
  const at = await ready($)
  if (!at) return { ok: false, reason: notice ?? t().failed }
  await update($, pending, () => ({ path: p.path, flags: p.flags }))
  const flags = options.grantPermissions && !p.flags.includes('-g') ? [...p.flags, '-g'] : p.flags
  busy = 'install'
  installingFile = basename(p.path)
  installStartedAt = await $.clock.now()
  mark()
  let outcome: InstallOutcome
  try {
    const ran = await install($, at.adb, at.s, p.path, flags)
    if (ran.ok) {
      const installed = await installedPackage($, at.adb, at.s, p.path)
      const d = chosenDevice(at.s)
      const done: NonNullable<LastInstall> = {
        file: basename(p.path),
        package: installed?.package ?? pkg ?? '',
        versionName: installed?.versionName,
        versionCode: installed?.versionCode,
        serial: at.s,
        model: info?.model ?? d?.model,
        ms: ran.ms,
        at: await $.clock.now(),
      }
      await update($, last, () => done)
      await update($, pending, () => null)
      say($, t().installed(done.package, versionText(done.versionName, done.versionCode)))
      outcome = { ok: true, last: done }
    } else {
      const failure = refineFailure(classifyFailure(ran.output), flags, await apkBadging($, p.path), { afterD: t().downgradeAfterD, release: t().downgradeRelease })
      await update($, pending, () => ({ path: p.path, flags: p.flags, failure }))
      say($, t().installFailed(failure.code, failure.message), false)
      outcome = { ok: false, failure }
    }
  } finally {
    busy = undefined
    installStartedAt = undefined
    mark()
  }
  await refreshStatus($)
  return outcome
}

// What aapt says of the APK, where the SDK's build-tools are installed
async function apkBadging($: EngineInterface, path: string): Promise<Badging | undefined> {
  aaptPath = aaptPath === undefined ? await findAapt($) : aaptPath
  return aaptPath ? badging($, aaptPath, path) : undefined
}

// The package the APK carries, read by aapt where there is one, else the repo's app as installed now
async function installedPackage($: EngineInterface, adb: string, s: string, path: string): Promise<AppInfo | undefined> {
  const fromApk = await apkBadging($, path)
  const name = fromApk?.package ?? (base ? ((await resolvePackage($, adb, s, base)) ?? base) : undefined)
  if (!name) return undefined
  return (await appInfo($, adb, s, name)) ?? { package: name, versionName: fromApk?.versionName, versionCode: fromApk?.versionCode, isEnabled: true }
}

function versionText(name: string | undefined, code: number | undefined): string {
  return t().version(name ?? '?', code === undefined ? '?' : String(code))
}

async function answerYes($: EngineInterface) {
  const question = await read($, confirm)
  if (question) {
    await update($, confirm, () => null)
    if (question.kind === 'uninstall') await doUninstall($)
    else await doClear($)
    return
  }
  const p = await read($, pending)
  if (!p?.failure) return
  if (p.failure.retry === 'reinstall') {
    const at = await ready($)
    if (!at) return
    const target = await targetPackage($, at.adb, at.s, p.path)
    if (target) await uninstall($, at.adb, at.s, target)
    await runInstall($, { path: p.path, flags: p.flags })
    return
  }
  const flag = flagOf(p.failure.retry)
  const flags = flag && !p.flags.includes(flag) ? [...p.flags, flag] : p.flags
  await runInstall($, { path: p.path, flags })
}

// The package an APK would replace: what the APK says, else the repo's app
async function targetPackage($: EngineInterface, adb: string, s: string, path: string): Promise<string | undefined> {
  const fromApk = await apkBadging($, path)
  return fromApk?.package ?? (base ? ((await resolvePackage($, adb, s, base)) ?? base) : undefined)
}

async function answerNo($: EngineInterface) {
  await update($, confirm, () => null)
  await update($, pending, p => (p?.failure ? { path: p.path, flags: p.flags } : p))
  mark()
}

async function doLaunch($: EngineInterface): Promise<string> {
  const at = await ready($)
  if (!at) return notice ?? t().failed
  if (!pkg) return t().needPackage
  const ok = await launch($, at.adb, at.s, pkg)
  say($, ok ? t().launched(pkg) : t().launchFailed(pkg))
  inBackground($, refreshStatus($))
  return notice ?? ''
}

async function doStop($: EngineInterface): Promise<string> {
  const at = await ready($)
  if (!at) return notice ?? t().failed
  if (!pkg) return t().needPackage
  await forceStop($, at.adb, at.s, pkg)
  say($, t().stopped(pkg))
  inBackground($, refreshStatus($))
  return notice ?? ''
}

async function doUninstall($: EngineInterface): Promise<string> {
  const at = await ready($)
  if (!at) return notice ?? t().failed
  if (!pkg) return t().needPackage
  const ran = await uninstall($, at.adb, at.s, pkg)
  const ok = ran !== undefined && ran.exitCode === 0 && /^Success/m.test(ran.stdout)
  say($, ok ? t().uninstalled(pkg) : t().uninstallFailed(pkg, (ran ? `${ran.stdout}\n${ran.stderr}` : '').trim().split(/\r?\n/).pop() ?? ''))
  inBackground($, refreshStatus($))
  return notice ?? ''
}

async function doClear($: EngineInterface): Promise<string> {
  const at = await ready($)
  if (!at) return notice ?? t().failed
  if (!pkg) return t().needPackage
  const ok = await clearData($, at.adb, at.s, pkg)
  say($, ok ? t().cleared(pkg) : t().clearFailed(pkg))
  inBackground($, refreshStatus($))
  return notice ?? ''
}

async function outputDir($: EngineInterface): Promise<string> {
  if (options.outputDir) return options.outputDir
  return `${(await $.env.get('HOME')) ?? '.'}/Downloads`
}

// Opens a capture in the system's viewer, or with reveal its folder with it selected
async function openPath($: EngineInterface, path: string, reveal = false): Promise<void> {
  if (!(await openFile($, path, reveal))) say($, t().openFailed, false)
}

async function sizeOf($: EngineInterface, png: string): Promise<{ width: number; height: number } | undefined> {
  return $.fs.read(png, { as: 'bytes' }).then(b => pngSize(b.base64), () => undefined)
}

// Where posters and frames go: the system's temporary folder, never the capture folder
async function cacheDir($: EngineInterface): Promise<string> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
  return `${tmp}/android-device`
}

async function ffmpeg($: EngineInterface): Promise<string | null> {
  if (ffmpegPath === undefined) ffmpegPath = await findFfmpeg($)
  return ffmpegPath
}

// A finished recording becomes the Video item: a poster frame where one can be made, its length and when
async function keepVideo($: EngineInterface, local: string, seconds: number) {
  const name = basename(local).replace(/\.mp4$/, '')
  const poster = await videoPoster($, await ffmpeg($), local, await cacheDir($), name)
  const size = poster ? await sizeOf($, poster) : undefined
  const when = await $.clock.now()
  stopVideo($)
  await update($, lastVideo, prev => ({ path: local, poster: size ? poster : undefined, ...size, seconds, at: when, generation: (prev?.generation ?? 0) + 1 }))
}

// Plays the recording in the pane, frame by frame; without ffmpeg, in the system player
async function playVideo($: EngineInterface, video: NonNullable<LastVideo>) {
  if (player || preparingVideo) return stopVideo($)
  const ff = await ffmpeg($)
  if (!ff) {
    say($, t().noFfmpeg, false)
    return openPath($, video.path)
  }
  const dir = `${await cacheDir($)}/${basename(video.path).replace(/\.mp4$/, '')}.frames`
  preparingVideo = video.path
  mark()
  try {
    let frames = await listFrames($, dir)
    if (frames.length === 0) {
      if (!(await videoFrames($, ff, video.path, dir, PLAY_FPS))) return say($, t().captureFailed, false)
      frames = await listFrames($, dir)
    }
    if (frames.length === 0 || preparingVideo !== video.path) return
    const playing = { path: video.path, frames, i: 0, timer: undefined as unknown as Timer }
    playing.timer = $.clock.every(Math.round(1000 / PLAY_FPS), () => {
      if (player !== playing) return
      playing.i++
      if (playing.i >= playing.frames.length) return stopVideo($)
      if (playing.i % PLAY_FPS === 0) mark()
      void $.ui.blit({ requestId: PANE, key: 'video', source: { file: playing.frames[playing.i]!, format: 'png' } }).catch(() => undefined)
    })
    player = playing
  } finally {
    preparingVideo = undefined
    mark()
  }
}

async function listFrames($: EngineInterface, dir: string): Promise<string[]> {
  try {
    const entries = await $.fs.list(dir)
    return entries.filter(x => x.kind === 'file' && /^f\d+\.png$/.test(x.name)).map(x => `${dir}/${x.name}`).sort()
  } catch {
    return []
  }
}

function stopVideo(_$?: EngineInterface) {
  preparingVideo = undefined
  if (!player) return
  player.timer.cancel()
  player = undefined
  mark()
}

async function doScreenshot($: EngineInterface): Promise<string> {
  const at = await ready($)
  if (!at) return notice ?? t().failed
  busy = 'capture'
  mark()
  try {
    const name = captureName(info?.model ?? chosenDevice(at.s)?.model, new Date(await $.clock.now()), 'png')
    const local = `${await outputDir($)}/${name}`
    const ok = await screenshot($, at.adb, at.s, `/sdcard/${name}`, local)
    say($, ok ? t().screenshotSaved(local) : t().captureFailed)
    if (ok) {
      // The PNG's own size, so a folded or an unfolded screen keeps its shape in the preview
      const size = await sizeOf($, local)
      const when = await $.clock.now()
      await update($, lastShot, prev => ({ path: local, ...size, at: when, generation: (prev?.generation ?? 0) + 1 }))
    }
    return ok ? local : t().captureFailed
  } finally {
    busy = undefined
    mark()
  }
}

// Pulls the APK (base and splits) of the app in front, or of the package named, into the capture folder
async function doPull($: EngineInterface, named?: string): Promise<string> {
  const at = await ready($)
  if (!at) return notice ?? t().failed
  busy = 'capture'
  mark()
  try {
    const target = named ?? (await foregroundApp($, at.adb, at.s))
    if (!target) {
      say($, t().noForeground, false)
      return t().noForeground
    }
    const paths = await apkPaths($, at.adb, at.s, target)
    if (paths.length === 0) {
      say($, t().noneInstalledInfo(target), false)
      return t().noneInstalledInfo(target)
    }
    const a = await appInfo($, at.adb, at.s, target)
    const dir = await outputDir($)
    const locals: string[] = []
    for (const remote of paths) {
      const local = `${dir}/${pulledName(target, a?.versionName, a?.versionCode, remote)}`
      if (!(await pullFile($, at.adb, at.s, remote, local))) {
        say($, t().pullFailed(target), false)
        return t().pullFailed(target)
      }
      locals.push(local)
    }
    const text = locals.length === 1 ? t().pulled(target, locals[0]!) : t().pulledSplits(target, locals.length, dir)
    const when = await $.clock.now()
    await update($, lastPull, () => ({ package: target, version: a ? versionText(a.versionName, a.versionCode) : undefined, paths: locals, at: when }))
    say($, text)
    return locals.length === 1 ? text : `${text}\n${locals.join('\n')}`
  } finally {
    busy = undefined
    mark()
  }
}

async function toggleRecording($: EngineInterface): Promise<string> {
  if (recordingNow) {
    const adb = await ensureAdb($)
    if (adb) await stopRecording($, adb, recordingNow.serial)
    return t().stopRecord
  }
  const at = await ready($)
  if (!at) return notice ?? t().failed
  const name = captureName(info?.model ?? chosenDevice(at.s)?.model, new Date(await $.clock.now()), 'mp4')
  const started: NonNullable<Recording> = { startedAt: await $.clock.now(), remote: `/sdcard/${name}`, local: `${await outputDir($)}/${name}`, serial: at.s }
  const stream = $.process.spawn({ argv: recordArgv(at.adb, at.s, started.remote) })
  recordStream = stream
  recordingNow = started
  await update($, recording, () => started)
  say($, t().recordingStarted)
  inBackground($, finishRecording($, at.adb, stream, started))
  return t().recordingStarted
}

// Waits for screenrecord to end (its limit, or the stop's SIGINT), then pulls the file
async function finishRecording($: EngineInterface, adb: string, stream: AsyncGenerator<unknown, unknown>, rec: NonNullable<Recording>) {
  try {
    for await (const _chunk of stream) {
      // the child prints nothing of use
    }
  } catch {
    // the child ended with an error: the file may still be there
  }
  recordStream = undefined
  await $.clock.sleep(1500)
  const ok = await pull($, adb, rec.serial, rec.remote, rec.local)
  const seconds = Math.max(0, Math.round(((await $.clock.now()) - 1500 - rec.startedAt) / 1000))
  recordingNow = null
  await update($, recording, () => null)
  say($, ok ? t().recordingSaved(rec.local) : t().captureFailed)
  if (ok) await keepVideo($, rec.local, seconds)
}

// After a reload the child is gone but the device may still record: stop it and keep the file
async function recoverRecording($: EngineInterface) {
  const rec = await read($, recording)
  if (!rec) return
  const adb = await ensureAdb($)
  if (adb) {
    await stopRecording($, adb, rec.serial)
    await $.clock.sleep(1500)
    const ok = await pull($, adb, rec.serial, rec.remote, rec.local)
    say($, ok ? t().recordingSaved(rec.local) : t().captureFailed)
    if (ok) await keepVideo($, rec.local, 0)
  }
  recordingNow = null
  await update($, recording, () => null)
}

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : `${cwd}/${path}`
}

// Puts an APK in the Install block; the person installs it from there
async function queue($: EngineInterface, path: string): Promise<string> {
  const full = resolvePath(path)
  if (!(await $.fs.exists(full))) return t().noSuchFile(full)
  await update($, pending, () => ({ path: full, flags: [] }))
  await update($, pick, () => 'none')
  if (!(await read($, isOn))) await turnOn($)
  mark()
  return t().queued(basename(full))
}

const TOOL_NAMES = ['device_list', 'apk_list', 'apk_install', 'package_info', 'app_launch', 'app_stop', 'screenshot', 'apk_pull'] as const
type ToolName = (typeof TOOL_NAMES)[number]

const PACKAGE_INPUT = {
  type: 'object',
  properties: { package: { type: 'string', description: 'A package name. Default: the app of the repo in the working directory.' } },
} as const

async function ensureTools($: EngineInterface) {
  if (isToolRegistered) return
  const s = t()
  const specs: { name: ToolName; description: string; inputSchema: Record<string, unknown> }[] = [
    { name: 'device_list', description: s.toolDeviceList, inputSchema: { type: 'object', properties: {} } },
    { name: 'apk_list', description: s.toolApkList, inputSchema: { type: 'object', properties: {} } },
    {
      name: 'apk_install',
      description: s.toolApkInstall,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The APK file, absolute or relative to the working directory.' },
          allowDowngrade: { type: 'boolean', description: 'Add -d: replace a newer version with this older one. Only after the person agreed.' },
          allowTestOnly: { type: 'boolean', description: 'Add -t: install an APK marked test-only. Only after the person agreed.' },
        },
        required: ['path'],
      },
    },
    { name: 'package_info', description: s.toolPackageInfo, inputSchema: PACKAGE_INPUT },
    { name: 'app_launch', description: s.toolAppLaunch, inputSchema: PACKAGE_INPUT },
    { name: 'app_stop', description: s.toolAppStop, inputSchema: PACKAGE_INPUT },
    { name: 'screenshot', description: s.toolScreenshot, inputSchema: { type: 'object', properties: {} } },
    { name: 'apk_pull', description: s.toolApkPull, inputSchema: { type: 'object', properties: { package: { type: 'string', description: 'A package name. Default: the app in the foreground.' } } } },
  ]
  for (const spec of specs) await $.tool.register({ ...spec, isDeferred: false })
  isToolRegistered = true
}

async function turnOn($: EngineInterface) {
  await update($, isOn, () => true)
  await ensureTools($)
  $.ui.invalidate('tool.describe')
  notice = undefined
  noticeColor = undefined
  await update($, pick, () => 'none')
  await update($, confirm, () => null)
  startPolling($)
  await $.ui.open({ id: PANE, title: t().title, rows: options.rows })
  inBackground($, refreshAll($))
}

function startPolling($: EngineInterface) {
  stopPolling()
  timers = [
    $.clock.every(DEVICES_MS, () => {
      if (!busy) inBackground($, refreshDevices($))
    }),
    $.clock.every(STATUS_MS, () => {
      if (!busy) inBackground($, refreshStatus($))
    }),
    $.clock.every(TICK_MS, async () => {
      nowMs = await $.clock.now()
      if (busy === 'install' || recordingNow) mark()
    }),
  ]
}

function stopPolling() {
  for (const timer of timers) timer.cancel()
  timers = []
}

// Ends the polling and forgets the on state; the pane is closed by the caller or already closing
async function turnOff($: EngineInterface) {
  stopPolling()
  stopVideo($)
  if (recordingNow && adbPath) await stopRecording($, adbPath, recordingNow.serial)
  await update($, isOn, () => false)
  await update($, pick, () => 'none')
  await update($, confirm, () => null)
  $.ui.invalidate('tool.describe')
  $.ui.status(undefined)
  lastStatusLine = undefined
}

function statusLine(): string | undefined {
  if (busy === 'install') return t().statusInstalling(installingFile)
  if (recordingNow) return t().statusRecording(formatClock(nowMs - recordingNow.startedAt))
  const model = info?.model ?? ''
  if (!model) return undefined
  return t().statusLine(model, pkg ?? '', app ? versionText(app.versionName, app.versionCode) : '')
}

function describeApp(a: AppInfo): string[] {
  const parts = [versionText(a.versionName, a.versionCode)]
  const updated = shortStamp(a.lastUpdate)
  const first = shortStamp(a.firstInstall)
  if (updated && updated !== first) parts.push(t().updated(updated))
  else if (first) parts.push(t().firstInstalled(first))
  if (a.installer) parts.push(a.installer)
  if (!a.isEnabled) parts.push(t().disabled)
  if (a.pid !== undefined) parts.push(t().running(a.pid))
  return parts
}

function describeDevice(d: Device, i: DeviceInfo | undefined): { head: string[]; detail: string[] } {
  const s = t()
  const head = [i?.model ?? d.model ?? d.serial]
  if (i?.manufacturer) head.push(i.manufacturer)
  head.push(d.transport === 'usb' ? s.usb : d.transport === 'wifi' ? s.wifi : d.transport)
  head.push(d.state === 'unauthorized' ? s.unauthorized : d.state === 'offline' ? s.offline : d.state)
  const detail = [d.serial]
  if (i?.release && i.sdk) detail.push(s.api(i.release, i.sdk))
  const skin = skins.get(d.serial)
  if (skin) detail.push(`${skin.name} ${skin.version}`)
  if (i?.screen) detail.push(i.screen === 'on' ? s.screenOn : s.screenOff)
  return { head, detail }
}

// The Spec block's rows, a label and its facts; a fact the device did not report is left out, a row without any too
function specRows(sp: Specs): { label: string; text: string }[] {
  const s = t()
  const L = s.specLabels
  const kb = (n: number) => formatBytes(n * 1024)
  const rows: { label: string; parts: (string | undefined)[] }[] = [
    { label: L.soc, parts: [sp.soc] },
    { label: L.cpu, parts: [sp.cores !== undefined ? s.cores(sp.cores) : undefined, sp.governors.length > 0 ? s.governor(sp.governors.join(', ')) : undefined] },
    { label: L.clusters, parts: sp.clusters.map(formatCluster) },
    { label: L.abi, parts: [sp.abis.join(', ') || undefined] },
    { label: L.gpu, parts: [sp.gpu, sp.gles] },
    {
      label: L.memory,
      parts: [
        sp.memTotalKb !== undefined ? s.memTotal(kb(sp.memTotalKb)) : undefined,
        sp.memAvailableKb !== undefined ? s.memAvailable(kb(sp.memAvailableKb)) : undefined,
        sp.swapTotalKb !== undefined ? s.swap(kb(sp.swapTotalKb), kb(sp.swapTotalKb - (sp.swapFreeKb ?? 0))) : undefined,
      ],
    },
    {
      label: L.display,
      parts: [sp.width && sp.height ? `${sp.width}\u00d7${sp.height}` : undefined, sp.dpi !== undefined ? `${sp.dpi} dpi` : undefined, sp.hz !== undefined ? `${sp.hz} Hz` : undefined],
    },
    {
      label: L.system,
      parts: [sp.patch ? s.patch(sp.patch) : undefined, sp.kernel ? s.kernel(sp.kernel) : undefined, sp.buildType, sp.bootloader ? s.bootloader(sp.bootloader) : undefined],
    },
    { label: L.build, parts: [sp.fingerprint] },
    {
      label: L.battery,
      parts: [
        sp.health ? s.health[sp.health] : undefined,
        sp.tempC !== undefined ? `${sp.tempC.toFixed(1)} \u00b0C` : undefined,
        sp.voltageMv !== undefined ? `${(sp.voltageMv / 1000).toFixed(2)} V` : undefined,
        sp.technology,
        sp.cycles !== undefined ? s.cycles(sp.cycles) : undefined,
      ],
    },
  ]
  return rows
    .map(row => ({ label: row.label, text: row.parts.filter((x): x is string => typeof x === 'string' && x !== '').join(' \u00b7 ') }))
    .filter(row => row.text !== '')
}

// The package a tool names, else the repo's app as installed on the chosen device
async function namedPackage($: EngineInterface, e: unknown): Promise<string | undefined> {
  const input = e as { package?: unknown }
  if (typeof input.package === 'string' && input.package.trim() !== '') {
    const name = input.package.trim()
    return isPackageName(name) ? name : undefined
  }
  if (!pkg) await refreshStatus($)
  return pkg
}

// A tool's description while the pane is off: deferred, so it waits behind ToolSearch
const deferWhileOff = async ($: EngineInterface, e: ToolDescribeInput, next: (e: ToolDescribeInput) => Promise<ToolDescribeResult>) => {
  const described = await next(e)
  return { ...described, isDeferred: !(await read($, isOn)) }
}

export const register: Register = (on, opts) => {
  setLanguage(opts.language)
  options = {
    package: typeof opts.package === 'string' && isPackageName(opts.package.trim()) ? opts.package.trim() : '',
    serial: typeof opts.serial === 'string' && isSerial(opts.serial.trim()) ? opts.serial.trim() : '',
    outputDir: typeof opts.outputDir === 'string' ? opts.outputDir.trim().replace(/\/+$/, '') : '',
    grantPermissions: opts.grantPermissions === true,
    rows: clampInt(opts.rows, 16, 8, 200),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: t().commandDescription, argumentHint: t().argumentHint })
    const started = await next(e)

    $.clock.every(REDRAW_MS, () => {
      if (!isDirty) return
      isDirty = false
      $.ui.invalidate('ui.render')
      const line = statusLine()
      if (line !== lastStatusLine) {
        lastStatusLine = line
        $.ui.status(line)
      }
    })

    // A reload ended the timers; the state says the pane was on, so it comes back by itself
    if (await read($, isOn)) {
      await ensureTools($)
      startPolling($)
      void $.ui.open({ id: PANE, title: t().title, rows: options.rows })
      inBackground($, refreshAll($).then(() => recoverRecording($)))
    }
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const raw = e.args.trim()
    const word = raw.split(/\s+/)[0] ?? ''
    const rest = raw.slice(word.length).trim()
    const wasOn = await read($, isOn)
    const s = t()
    switch (word) {
      case '':
        if (wasOn) {
          await turnOff($)
          await $.ui.close({ id: PANE })
          return { text: s.turnedOff }
        }
        await turnOn($)
        return { text: s.turnedOn }
      case 'off':
        if (!wasOn) return { text: s.alreadyOff }
        await turnOff($)
        await $.ui.close({ id: PANE })
        return { text: s.turnedOff }
      case 'select': {
        if (!wasOn) await turnOn($)
        await refreshDevices($)
        const n = /^[1-9]$/.test(rest) ? Number(rest) : undefined
        const picked = n !== undefined ? devices[n - 1] : devices.find(d => d.serial === rest)
        if (!rest || (n === undefined && !isSerial(rest))) return { text: s.badSerial(rest) }
        if (!picked || picked.state !== 'device') return { text: s.noSuchDevice(rest) }
        await update($, serial, () => picked.serial)
        await update($, pick, () => 'none')
        await refreshStatus($)
        return { text: s.selected(deviceLabel(picked)) }
      }
      case 'install': {
        const path = apkPathOf(rest) ?? rest
        if (!path) return { text: s.nothingPending }
        return { text: await queue($, path) }
      }
      case 'apk': {
        if (!wasOn) await turnOn($)
        await refreshRepo($)
        if (!repo.isAndroid) return { text: s.notAndroidRepo }
        if (repo.apks.length === 0) return { text: s.noApks }
        await update($, pick, () => 'apk')
        return { text: s.pickApk }
      }
      case 'package': {
        if (!isPackageName(rest)) return { text: s.badPackage(rest) }
        await update($, override, () => rest)
        if (!wasOn) await turnOn($)
        else await refreshStatus($)
        return { text: s.packageSet(rest) }
      }
      case 'launch':
        if (!wasOn) await turnOn($)
        return { text: await doLaunch($) }
      case 'stop':
        if (!wasOn) await turnOn($)
        return { text: await doStop($) }
      case 'uninstall':
      case 'clear': {
        if (!wasOn) await turnOn($)
        if (!pkg) return { text: s.needPackage }
        const kind: NonNullable<Confirm>['kind'] = word === 'uninstall' ? 'uninstall' : 'clear'
        await update($, confirm, () => ({ kind }))
        mark()
        return { text: word === 'uninstall' ? s.askUninstall(pkg) : s.askClear(pkg) }
      }
      case 'screenshot':
        if (!wasOn) await turnOn($)
        return { text: await doScreenshot($) }
      case 'record':
        if (!wasOn) await turnOn($)
        return { text: await toggleRecording($) }
      case 'pull': {
        if (!wasOn) await turnOn($)
        if (rest && !isPackageName(rest)) return { text: s.badPackage(rest) }
        return { text: await doPull($, rest || undefined) }
      }
      case 'refresh':
        if (!wasOn) await turnOn($)
        aaptPath = undefined
        adbPath = undefined
        await refreshAll($, true)
        return { text: s.refreshed }
      default:
        return { text: `/adb ${s.argumentHint}` }
    }
  }).catch(($, e, next) => (next.called ? next(e) : { text: t().failed }))

  // An .apk path alone in the prompt is a drop on the terminal: it goes to the Install block, not to the model
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || (e.origin && e.origin.kind !== 'composer')) return next(e)
    const path = apkPathOf(e.text)
    if (!path) return next(e)
    if (!cwd) cwd = await $.session.cwd()
    const full = resolvePath(path)
    if (!(await $.fs.exists(full))) return next(e)
    const text = await queue($, full)
    // A dropped prompt stays in the box; once the drop has settled, empty it, since the path is in the pane now
    $.clock.after(CLEAR_BOX_MS, () => void $.prompt.fill({ text: '' }).catch(() => undefined))
    return { drop: text }
  }).catch(($, e, next) => next(e))

  // The person's close mark or key is the off switch too; the plugin's own close already turned it off
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await turnOff($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // While off the tools wait behind ToolSearch and cost the prompt nothing but their names
  on('tool.describe', { tool: 'mcp__android-device__device_list' }, deferWhileOff)
  on('tool.describe', { tool: 'mcp__android-device__apk_list' }, deferWhileOff)
  on('tool.describe', { tool: 'mcp__android-device__apk_install' }, deferWhileOff)
  on('tool.describe', { tool: 'mcp__android-device__package_info' }, deferWhileOff)
  on('tool.describe', { tool: 'mcp__android-device__app_launch' }, deferWhileOff)
  on('tool.describe', { tool: 'mcp__android-device__app_stop' }, deferWhileOff)
  on('tool.describe', { tool: 'mcp__android-device__screenshot' }, deferWhileOff)
  on('tool.describe', { tool: 'mcp__android-device__apk_pull' }, deferWhileOff)

  on('tool.call', { tool: 'mcp__android-device__device_list' }, async $ => {
    if (!(await read($, isOn))) return { result: t().toolOff }
    await refreshDevices($)
    const s = await read($, serial)
    if (devices.length === 0) return { result: t().noneConnected }
    return { result: devices.map(d => `${d.serial === s ? '* ' : '  '}${d.serial}  ${d.model ?? '?'}  ${d.state}  ${d.transport}`).join('\n') }
  }).catch(() => ({ deny: 'device_list failed' }))

  on('tool.call', { tool: 'mcp__android-device__apk_list' }, async $ => {
    if (!(await read($, isOn))) return { result: t().toolOff }
    await refreshRepo($)
    if (!repo.isAndroid) return { result: t().notAndroidRepo }
    if (repo.apks.length === 0) return { result: t().noApks }
    return { result: repo.apks.map(a => `${a.path}  ${formatBytes(a.size)}  ${formatStamp(a.mtimeMs)}`).join('\n') }
  }).catch(() => ({ deny: 'apk_list failed' }))

  on('tool.call', { tool: 'mcp__android-device__apk_install' }, async ($, e) => {
    if (!(await read($, isOn))) return { result: t().toolOff }
    const input = e as unknown as { path?: unknown; allowDowngrade?: unknown; allowTestOnly?: unknown }
    if (typeof input.path !== 'string' || input.path.trim() === '') return { deny: 'apk_install: path is required' }
    if (!cwd) cwd = await $.session.cwd()
    const full = resolvePath(input.path.trim())
    if (!(await $.fs.exists(full))) return { result: t().noSuchFile(full) }
    const flags: string[] = []
    if (input.allowDowngrade === true) flags.push('-d')
    if (input.allowTestOnly === true) flags.push('-t')
    const outcome = await runInstall($, { path: full, flags })
    if (outcome.ok) return { result: t().installed(outcome.last.package, versionText(outcome.last.versionName, outcome.last.versionCode)) }
    if ('reason' in outcome) return { result: outcome.reason }
    const f = outcome.failure
    const hint = f.retry === 'reinstall' ? t().reinstallHint : f.retry === 'same' ? t().retryHint('the same input') : t().retryHint(f.retry === 'downgrade' ? 'allowDowngrade' : 'allowTestOnly')
    return { result: `${t().installFailed(f.code, f.message)}\n${hint}` }
  }).catch(() => ({ deny: 'apk_install failed' }))

  on('tool.call', { tool: 'mcp__android-device__package_info' }, async ($, e) => {
    if (!(await read($, isOn))) return { result: t().toolOff }
    const at = await ready($)
    if (!at) return { result: notice ?? t().failed }
    const name = await namedPackage($, e)
    if (!name) return { result: t().needPackage }
    const a = await appInfo($, at.adb, at.s, name)
    if (!a) return { result: t().noneInstalledInfo(name) }
    const lines = [
      `package: ${a.package}`,
      `versionName: ${a.versionName ?? '?'}`,
      `versionCode: ${a.versionCode ?? '?'}`,
      `firstInstallTime: ${a.firstInstall ?? '?'}`,
      `lastUpdateTime: ${a.lastUpdate ?? '?'}`,
      `installer: ${a.installer ?? '-'}`,
      `enabled: ${a.isEnabled}`,
      `running: ${a.pid !== undefined ? `yes (pid ${a.pid})` : 'no'}`,
    ]
    return { result: lines.join('\n') }
  }).catch(() => ({ deny: 'package_info failed' }))

  on('tool.call', { tool: 'mcp__android-device__app_launch' }, async ($, e) => {
    if (!(await read($, isOn))) return { result: t().toolOff }
    const at = await ready($)
    if (!at) return { result: notice ?? t().failed }
    const name = await namedPackage($, e)
    if (!name) return { result: t().needPackage }
    const ok = await launch($, at.adb, at.s, name)
    inBackground($, refreshStatus($))
    return { result: ok ? t().launched(name) : t().launchFailed(name) }
  }).catch(() => ({ deny: 'app_launch failed' }))

  on('tool.call', { tool: 'mcp__android-device__app_stop' }, async ($, e) => {
    if (!(await read($, isOn))) return { result: t().toolOff }
    const at = await ready($)
    if (!at) return { result: notice ?? t().failed }
    const name = await namedPackage($, e)
    if (!name) return { result: t().needPackage }
    await forceStop($, at.adb, at.s, name)
    inBackground($, refreshStatus($))
    return { result: t().stopped(name) }
  }).catch(() => ({ deny: 'app_stop failed' }))

  on('tool.call', { tool: 'mcp__android-device__screenshot' }, async $ => {
    if (!(await read($, isOn))) return { result: t().toolOff }
    return { result: await doScreenshot($) }
  }).catch(() => ({ deny: 'screenshot failed' }))

  on('tool.call', { tool: 'mcp__android-device__apk_pull' }, async ($, e) => {
    if (!(await read($, isOn))) return { result: t().toolOff }
    const input = e as unknown as { package?: unknown }
    const named = typeof input.package === 'string' && input.package.trim() !== '' ? input.package.trim() : undefined
    if (named !== undefined && !isPackageName(named)) return { deny: t().badPackage(named) }
    return { result: await doPull($, named) }
  }).catch(() => ({ deny: 'apk_pull failed' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // The terminal draws a label column and glyph bars; the desktop, the editor and the phone draw captions and colored bars
    const isTui = e.surface === 'terminal'
    const s = t()
    const columns = e.props.bodyColumns ?? 80
    const isNarrow = columns < NARROW
    const isPaneOn = await read($, isOn)
    const chosen = await read($, serial)
    const p = await read($, pending)
    const done = await read($, last)
    const picking = await read($, pick)
    const question = await read($, confirm)
    const rec = await read($, recording)
    const shot = await read($, lastShot)
    const video = await read($, lastVideo)
    const pulled = await read($, lastPull)
    const isSpecOpen = await read($, specOpen)
    const home = await $.env.get('HOME')
    const d = chosenDevice(chosen)
    // A question locks the other keys until it is answered
    const isLocked = question !== null || p?.failure !== undefined
    const LABEL = 9
    const pad = ''.padEnd(LABEL)
    const BAR = isNarrow ? 8 : 12
    // The terminal shows each Button's hotkey; a pointer surface draws the Button alone, so no key badges
    const hk = (key: string) => (isTui ? key : undefined)
    // A secondary action: dim on a pointer surface, beside the one main action of its row
    const minor = !isTui

    if (!isPaneOn) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{s.turnedOff}</Text>
        </Box>
      )
    }

    type Line = { text: string; color?: string; isDim?: boolean }
    // A detail line of parts; narrow, in two lines
    const details = (parts: string[]): Line[] => {
      const half = Math.ceil(parts.length / 2)
      const rows = isNarrow && parts.length > 2 ? [parts.slice(0, half), parts.slice(half)] : [parts]
      return rows.map(row => ({ text: row.join(' · '), isDim: true }))
    }
    const indent = (node: RenderChildren) => (
      <Box>
        <Text>{pad}</Text>
        {node}
      </Box>
    )
    // A blank row between the blocks
    const gap = <Text> </Text>
    // One block: its name, a note at the right, its lines, then what follows (bars, a list, buttons)
    const block = (name: string, right: string | undefined, lines: Line[], ...rest: RenderChildren[]) => {
      if (isTui && lines.length === 0) {
        const [first, ...others] = rest
        return (
          <Box flexDirection="column">
            <Box columnGap={1}>
              <Text weight="bold">{name.padEnd(LABEL - 1)}</Text>
              {first}
            </Box>
            {others.map(node => (node ? indent(node) : null))}
          </Box>
        )
      }
      const shown = lines.length > 0 ? lines : [{ text: '' }]
      if (isTui) {
        return (
          <Box flexDirection="column">
            {shown.map((line, i) => (
              <Box justifyContent="space-between">
                <Text wrap="truncate-end">
                  {i === 0 ? <Text weight="bold">{name.padEnd(LABEL)}</Text> : pad}
                  <Text color={line.color} dimColor={line.isDim}>
                    {line.text}
                  </Text>
                </Text>
                {i === 0 && right !== undefined && <Text dimColor>{right}</Text>}
              </Box>
            ))}
            {rest.map(node => (node ? indent(node) : null))}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" marginTop="sm" borderStyle="round" borderColor="subtle" paddingX={1} rowGap="xs">
          <Box justifyContent="space-between">
            <Text size="caption" weight="semibold" dimColor>
              {name.toUpperCase()}
            </Text>
            {right !== undefined && (
              <Text size="caption" dimColor>
                {right}
              </Text>
            )}
          </Box>
          {lines.map((line, i) => (
            <Text size={i === 0 ? 'body' : 'caption'} weight={i === 0 ? 'semibold' : 'regular'} color={line.color} dimColor={line.isDim} wrap="truncate-end">
              {line.text}
            </Text>
          ))}
          {rest.map(node => (node ? <Box gap={1} alignItems="center">{node}</Box> : null))}
        </Box>
      )
    }
    // A bar of BAR cells: glyphs in the terminal, a colored strip elsewhere
    const bar = (label: string, ratio: number, color: string, value: string) => {
      const filled = barCells(ratio, BAR)
      return (
        <Text wrap="truncate-end">
          <Text dimColor size="caption">
            {label}{' '}
          </Text>
          {isTui ? (
            <Text>
              <Text color={color}>{'█'.repeat(filled)}</Text>
              <Text dimColor>{'░'.repeat(BAR - filled)}</Text>
            </Text>
          ) : (
            <Text mono>
              <Text backgroundColor={color}>{' '.repeat(filled)}</Text>
              <Text backgroundColor="inactive">{' '.repeat(BAR - filled)}</Text>
            </Text>
          )}
          <Text size="caption" tabular>
            {' '}
            {value}
          </Text>
        </Text>
      )
    }
    const buttons = (...nodes: RenderChildren[]) => <Box columnGap={1} flexWrap="wrap">{nodes.filter(Boolean)}</Box>
    const ask = (text: string) => (
      <Box columnGap={1} flexWrap="wrap">
        <Text color="warning">{text}</Text>
        <Button key="yes" hotkey={hk("y")} variant="primary" onPress={() => inBackground($, answerYes($))}>
          {s.yes}
        </Button>
        <Button key="no" hotkey={hk("n")} role="dismiss" onPress={() => inBackground($, answerNo($))}>
          {s.no}
        </Button>
      </Box>
    )
    const cancelPick = () => void update($, pick, () => 'none')
    const digits = (items: { label: string; note: string; onPress: () => void; keyName: string }[]) => (
      <Box flexDirection="column">
        {items.slice(0, LIST_MAX).map((item, i) => (
          <Box gap={1}>
            <Button key={item.keyName} hotkey={hk(String(i + 1))} onPress={item.onPress}>
              {item.label}
            </Button>
            <Text dimColor size="caption">
              {item.note}
            </Text>
          </Box>
        ))}
        <Box>
          <Button key="cancel-pick" hotkey={hk("x")} role="dismiss" onPress={cancelPick}>
            {s.cancel}
          </Button>
        </Box>
      </Box>
    )

    // Device
    const head = d ? describeDevice(d, info) : undefined
    const deviceLines: Line[] =
      !adbPath ? [{ text: s.noAdb, color: 'error' }]
      : devices.length === 0 ? [{ text: s.noDevice, color: 'error' }]
      : !d || !head ? [{ text: s.pickDevice, color: 'warning' }]
      : [{ text: head.head.join(' · '), color: d.state === 'device' ? 'success' : 'warning' }, ...details(head.detail)]
    const batteryColor = (pct: number) => (pct >= 50 ? 'success' : pct >= 20 ? 'warning' : 'error')
    const gaugeNodes = [
      d && info?.battery !== undefined ? bar(s.batteryLabel, info.battery / 100, batteryColor(info.battery), `${info.battery}%`) : null,
      d && info?.storage ? bar(s.storageLabel, 1 - info.storage.freeBytes / info.storage.totalBytes, 'suggestion', s.freeOf(formatBytes(info.storage.freeBytes), formatBytes(info.storage.totalBytes))) : null,
    ].filter(Boolean)
    // Both fit on one row from about 70 cells; under that, one row each
    const gauges =
      gaugeNodes.length === 0 ? null
      : columns - LABEL >= 70 ? <Box columnGap={3}>{gaugeNodes}</Box>
      : <Box flexDirection="column">{gaugeNodes}</Box>
    const deviceRest =
      isLocked ? null
      : picking === 'device' ?
        digits(
          devices.map((x, i) => ({
            keyName: `device-${i + 1}`,
            label: deviceLabel(x),
            note: x.state === 'device' ? (x.transport === 'usb' ? s.usb : x.transport === 'wifi' ? s.wifi : '') : x.state,
            onPress: () => {
              if (x.state !== 'device') return
              inBackground($, update($, serial, () => x.serial).then(() => update($, pick, () => 'none')).then(() => refreshStatus($)))
            },
          })),
        )
      : devices.length > 1 ?
        buttons(
          <Button key="switch" hotkey={hk("d")} dimColor={minor} onPress={() => void update($, pick, () => 'device')}>
            {s.switchDevice}
          </Button>,
        )
      : null

    // Spec: folded, a button alone; unfolded, the hardware the device reported, read once
    const sp = d ? specs.get(d.serial) : undefined
    const specButton = !isLocked && picking === 'none' && (
      <Button key="spec" hotkey={hk("h")} dimColor={minor && isSpecOpen} onPress={() => inBackground($, toggleSpecs($))}>
        {isSpecOpen ? s.hideSpecs : s.showSpecs}
      </Button>
    )
    const rows = isSpecOpen && sp ? specRows(sp) : []
    const labelWidth = Math.max(0, ...rows.map(r => cellWidth(r.label))) + 2
    const specLines: RenderChildren[] =
      !isSpecOpen ? []
      : specsLoading === d?.serial && !sp ? [<Text dimColor>{s.readingSpecs}</Text>]
      : sp && rows.length === 0 ? [<Text dimColor>{s.noSpecs}</Text>]
      : rows.map(row => (
          <Text wrap="truncate-end" size={isTui ? undefined : 'caption'}>
            <Text dimColor>{isTui ? padCells(row.label, labelWidth) : `${row.label}  `}</Text>
            {row.text}
          </Text>
        ))
    const showSpec = d !== undefined && d.state === 'device'

    // App
    const appLines: Line[] =
      !pkg && !base ? [{ text: s.packageNotSet, isDim: true }]
      : app ? [{ text: pkg ?? '' }, ...details(describeApp(app))]
      : [{ text: pkg ?? base ?? '' }]
    const appRight = !pkg && !base ? undefined : app ? s.installedState : s.notInstalled
    const appRest =
      question ? ask(question.kind === 'uninstall' ? s.askUninstall(pkg ?? '') : s.askClear(pkg ?? ''))
      : app && !isLocked && picking === 'none' ?
        buttons(
          <Button key="launch" hotkey={hk("l")} variant={isTui ? undefined : 'primary'} onPress={() => inBackground($, doLaunch($))}>
            {s.launch}
          </Button>,
          <Button key="stop" hotkey={hk("s")} dimColor={minor} onPress={() => inBackground($, doStop($))}>
            {s.stop}
          </Button>,
          <Button key="uninstall" hotkey={hk("u")} dimColor={minor} onPress={() => void update($, confirm, () => ({ kind: 'uninstall' }))}>
            {s.uninstall}
          </Button>,
          <Button key="clear" hotkey={hk("c")} dimColor={minor} onPress={() => void update($, confirm, () => ({ kind: 'clear' }))}>
            {s.clearData}
          </Button>,
        )
      : null

    // Install
    const seconds = installStartedAt !== undefined ? Math.max(0, Math.round((nowMs - installStartedAt) / 1000)) : 0
    const failureAsk = (f: Failure) =>
      f.retry === 'downgrade' ? s.askDowngrade : f.retry === 'test-only' ? s.askTestOnly : f.retry === 'reinstall' ? s.askReinstall(pkg ?? base ?? '') : s.askRetry(f.message)
    const installLines: Line[] =
      busy === 'install' ? [{ text: s.installing(installingFile, seconds), color: 'warning' }]
      : p ? [{ text: s.pendingFile(basename(p.path)) }, ...details([relativeTo(cwd, dirname(p.path)) || '.', ...(p.flags.length > 0 ? [p.flags.join(' ')] : [])])]
      : [{ text: s.dropHint, isDim: true }]
    if (p?.failure && !question && busy !== 'install') {
      installLines.push({ text: `${s.failedLine(p.failure.code)}${p.failure.retry === 'reinstall' && p.failure.message ? ` · ${p.failure.message}` : ''}`, color: 'error' })
    }
    const installRest =
      p?.failure && !question ? ask(failureAsk(p.failure))
      : !isLocked && picking === 'apk' ?
        digits(
          repo.apks.map((a, i) => ({
            keyName: `apk-${i + 1}`,
            label: relativeTo(cwd, a.path),
            note: s.builtAt(formatStamp(a.mtimeMs)),
            onPress: () => inBackground($, queue($, a.path)),
          })),
        )
      : !isLocked && picking === 'none' && busy !== 'install' ?
        buttons(
          p && (
            <Button key="install" hotkey={hk("i")} variant="primary" onPress={() => inBackground($, runInstall($, p))}>
              {s.installButton}
            </Button>
          ),
          repo.isAndroid && (
            <Button key="pick-apk" hotkey={hk("a")} onPress={() => inBackground($, refreshRepo($).then(() => update($, pick, () => 'apk')))}>
              {s.pickApk}
            </Button>
          ),
          p && (
            <Button key="cancel-install" hotkey={hk("x")} role="dismiss" onPress={() => void update($, pending, () => null)}>
              {s.cancel}
            </Button>
          ),
        )
      : null
    const apkNote = picking === 'apk' && repo.apks.length === 0 ? (repo.isAndroid ? s.noApks : s.notAndroidRepo) : undefined

    // Last and Capture
    // The last install in three lines: the file, the package it put on the device, the version with when and how long
    const lastLines: Line[] = done ? [{ text: done.file }, { text: done.package }, { text: [versionText(done.versionName, done.versionCode), formatStamp(done.at), formatDuration(done.ms)].join(' \u00b7 '), isDim: true }] : []
    const captureRest = (
      <Box columnGap={1} flexWrap="wrap" alignItems="center">
        {!isLocked && picking === 'none' && (
          <Button key="screenshot" hotkey={hk("p")} variant={isTui ? undefined : 'primary'} onPress={() => inBackground($, doScreenshot($))}>
            {s.screenshot}
          </Button>
        )}
        {!isLocked && picking === 'none' && (
          <Button key="record" hotkey={hk("v")} onPress={() => inBackground($, toggleRecording($))}>
            {rec ? s.stopRecord : s.record}
          </Button>
        )}
        {!isLocked && picking === 'none' && (
          <Button key="pull" hotkey={hk("e")} dimColor={minor} onPress={() => inBackground($, doPull($))}>
            {s.pullApk}
          </Button>
        )}
        {rec && <Text color="warning">{s.recording(formatClock(nowMs - rec.startedAt))}</Text>}
        <Text dimColor size="caption" wrap="truncate-end">
          {s.savedTo(options.outputDir || '~/Downloads')}
        </Text>
      </Box>
    )
    // What the capture buttons made, one item each: a picture at the left in a terminal that draws pictures, at
    // the right (or under it, narrow) the path, pressed to open, a line of facts and the item's buttons
    const canAct = !isLocked && picking === 'none'
    const pictures = (shot?.width ? 1 : 0) + (video?.poster ? 1 : 0)
    const room =
      e.props.placement === 'dock' ? Math.max(8, Math.min(24, Math.floor(((e.props.scroll?.bodyRows ?? 40) - 24) / Math.max(1, pictures))))
      : 10
    const DETAIL = 34
    type Item = {
      name: string
      id: string
      path: string
      onPath: () => void
      facts: string[]
      picture?: { file: string; generation: number; width: number; height: number; frame?: string }
      actions: RenderChildren[]
    }
    const pathButton = (item: Item) =>
      isTui ? (
        <Button key={`${item.id}-path`} plain dimColor onPress={item.onPath}>
          {tildePath(item.path, home)}
        </Button>
      ) : (
        <Text size="caption" wrap="truncate-end">
          {tildePath(item.path, home)}
        </Text>
      )
    const itemButtons = (item: Item) => (canAct ? buttons(...item.actions, <Button key={`${item.id}-close`} dimColor={minor} onPress={() => close(item.id)}>{s.closeItem}</Button>) : null)
    const close = (id: string) => {
      if (id === 'video') stopVideo($)
      if (id === 'shot') void update($, lastShot, () => null)
      else if (id === 'video') void update($, lastVideo, () => null)
      else void update($, lastPull, () => null)
    }
    const item = (it: Item) => {
      const facts = <Text dimColor size="caption" wrap="truncate-end">{it.facts.filter(Boolean).join(' \u00b7 ')}</Text>
      if (e.surface !== 'terminal') return block(it.name, undefined, [], pathButton(it), facts, itemButtons(it))
      const { Image } = $.ui.resolve(e)
      const fit = it.picture ? fitCells(it.picture.width, it.picture.height, Math.max(8, Math.min(40, columns - LABEL - (columns - LABEL >= 8 + DETAIL ? DETAIL : 0))), room) : undefined
      const isBeside = fit !== undefined && columns - LABEL >= fit.columns + 2 + DETAIL
      const picture = it.picture && fit && (
        <Image
          key={it.id}
          source={{ file: it.picture.frame ?? it.picture.file, format: 'png', generation: it.picture.frame ? undefined : it.picture.generation }}
          columns={fit.columns}
          rows={fit.rows}
          alt={basename(it.path)}
        />
      )
      const detail = (
        <Box flexDirection="column">
          {pathButton(it)}
          {facts}
          {itemButtons(it)}
        </Box>
      )
      return (
        <Box>
          <Text weight="bold">{it.name.padEnd(LABEL)}</Text>
          <Box flexDirection={isBeside ? 'row' : 'column'} columnGap={2}>
            {picture}
            {detail}
          </Box>
        </Box>
      )
    }
    const stamp = (ms: number) => formatStamp(ms)
    const shotItem: Item | undefined = shot ? {
      name: s.shotLabel,
      id: 'shot',
      path: shot.path,
      onPath: () => inBackground($, openPath($, shot.path)),
      facts: [shot.width && shot.height ? `${shot.width}\u00d7${shot.height}` : '', stamp(shot.at ?? 0)],
      picture: shot.width && shot.height ? { file: shot.path, generation: shot.generation, width: shot.width, height: shot.height } : undefined,
      actions: [
        <Button key="open-shot" hotkey={hk("o")} onPress={() => inBackground($, openPath($, shot.path))}>{s.open}</Button>,
        <Button key="shot-reveal" dimColor={minor} onPress={() => inBackground($, openPath($, shot.path, true))}>{s.reveal}</Button>,
      ],
    } : undefined
    const isPlaying = video !== null && player?.path === video.path
    const isPreparing = video !== null && preparingVideo === video.path
    const videoItem: Item | undefined = video ? {
      name: s.videoLabel,
      id: 'video',
      path: video.path,
      onPath: () => inBackground($, openPath($, video.path)),
      facts: [
        isPreparing ? s.preparing : isPlaying && player ? s.playing(formatClock((player.i / PLAY_FPS) * 1000)) : video.seconds > 0 ? formatClock(video.seconds * 1000) : '',
        stamp(video.at),
      ],
      picture: video.poster && video.width && video.height ? { file: video.poster, generation: video.generation, width: video.width, height: video.height, frame: isPlaying ? player?.frames[player.i] : undefined } : undefined,
      actions: [
        <Button key="play" hotkey={hk("k")} variant={isPlaying ? undefined : 'primary'} onPress={() => inBackground($, playVideo($, video))}>{isPlaying || isPreparing ? s.stopPlay : s.play}</Button>,
        <Button key="open-video" dimColor={minor} onPress={() => inBackground($, openPath($, video.path))}>{s.open}</Button>,
        <Button key="video-reveal" dimColor={minor} onPress={() => inBackground($, openPath($, video.path, true))}>{s.reveal}</Button>,
      ],
    } : undefined
    const pullItem: Item | undefined = pulled && pulled.paths.length > 0 ? {
      name: s.apkLabel,
      id: 'pull',
      path: pulled.paths[0]!,
      // An APK has no viewer: its folder opens with it selected
      onPath: () => inBackground($, openPath($, pulled.paths[0]!, true)),
      facts: [pulled.package, pulled.version ?? '', pulled.paths.length > 1 ? s.splits(pulled.paths.length - 1) : '', stamp(pulled.at)],
      actions: [<Button key="pull-reveal" onPress={() => inBackground($, openPath($, pulled.paths[0]!, true))}>{s.reveal}</Button>],
    } : undefined
    const items = [shotItem, videoItem, pullItem].filter((x): x is Item => x !== undefined)

    // The pane's own title bar names it on a pointer surface: the first row is the last notice, one line, and Refresh
    const header = isTui ? null : (
      <Box justifyContent="space-between" alignItems="center" columnGap={1}>
        <Box flexShrink={1} overflow="hidden">
          <Text color={noticeColor} dimColor={noticeColor === undefined} size="caption" wrap="truncate-end">
            {notice ? notice.replace(home ? home.replace(/\/+$/, '') : '\u0000', '~') : ''}
          </Text>
        </Box>
        {!isLocked && (
          <Button key="refresh" dimColor onPress={() => inBackground($, refreshAll($, true))}>
            {s.refresh}
          </Button>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {header ?? <Box justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text weight="bold" size="heading">
              {s.title}
            </Text>{' '}
            <Text color={noticeColor} size="caption">
              {notice ?? ''}
            </Text>
          </Text>
          {!isLocked && (
            <Button key="refresh" hotkey={hk("r")} onPress={() => inBackground($, refreshAll($, true))}>
              {s.refresh}
            </Button>
          )}
        </Box>}
        {block(s.device, devices.length > 0 ? s.connected(devices.length) : undefined, deviceLines, gauges, deviceRest)}
        {isTui && gap}
        {showSpec && block(s.spec, undefined, [], specButton || <Text> </Text>, ...specLines)}
        {showSpec && isTui && gap}
        {block(s.app, appRight, appLines, appRest)}
        {isTui && gap}
        {block(s.install, undefined, installLines, apkNote ? <Text dimColor>{apkNote}</Text> : null, installRest)}
        {isTui && gap}
        {done && block(s.last, undefined, lastLines)}
        {done && isTui && gap}
        {block(s.capture, undefined, [], captureRest)}
        {items.map(it => (
          <Box flexDirection="column">
            {isTui && gap}
            {item(it)}
          </Box>
        ))}
      </Box>
    )
  })
}
