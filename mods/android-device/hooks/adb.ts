// Everything that talks to adb, aapt or the repo: thin calls on `$`, the parsing in model.ts.
// Every argument reaches adb as one argv entry, never through a shell.
import type { EngineInterface } from 'claude-code'

import {
  applicationIdsFrom,
  isApplicationModule,
  newestVersion,
  parseBadging,
  parseBattery,
  parseDevices,
  parseDf,
  foregroundPackage,
  parseDumpsysPackage,
  parsePackageList,
  parsePmPath,
  parseScreen,
  pickPackage,
  sortApks,
} from './model'
import type { Apk, AppInfo, Badging, Device, DeviceInfo } from './model'

const RUN_TIMEOUT = 10_000
// An install copies the APK over USB first: a large one takes a while
const INSTALL_TIMEOUT = 180_000
const PULL_TIMEOUT = 60_000

export type Ran = { exitCode: number; stdout: string; stderr: string }

// The exit code and both streams; undefined when the call itself failed (no such binary, a timeout)
export async function run($: EngineInterface, argv: string[], timeoutMs = RUN_TIMEOUT): Promise<Ran | undefined> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs })
    return { exitCode, stdout, stderr }
  } catch {
    return undefined
  }
}

// stdout on success, else undefined
async function runs($: EngineInterface, argv: string[], timeoutMs = RUN_TIMEOUT): Promise<string | undefined> {
  const ran = await run($, argv, timeoutMs)
  return ran && ran.exitCode === 0 ? ran.stdout : undefined
}

async function sdkRoots($: EngineInterface): Promise<string[]> {
  const roots = [await $.env.get('ANDROID_HOME'), await $.env.get('ANDROID_SDK_ROOT')]
  const home = await $.env.get('HOME')
  if (home) roots.push(`${home}/Library/Android/sdk`, `${home}/Android/Sdk`)
  return roots.filter((root): root is string => typeof root === 'string' && root !== '')
}

// `adb` on PATH, else the SDK's copy under ANDROID_HOME, ANDROID_SDK_ROOT or the default locations
export async function findAdb($: EngineInterface): Promise<string | undefined> {
  if ((await runs($, ['adb', 'version'])) !== undefined) return 'adb'
  for (const root of await sdkRoots($)) {
    const path = `${root}/platform-tools/adb`
    if ((await runs($, [path, 'version'])) !== undefined) return path
  }
  return undefined
}

// `aapt` on PATH, else the newest build-tools' copy; null when there is none (the package is then guessed)
export async function findAapt($: EngineInterface): Promise<string | null> {
  if ((await runs($, ['aapt', 'version'])) !== undefined) return 'aapt'
  for (const root of await sdkRoots($)) {
    let entries
    try {
      entries = await $.fs.list(`${root}/build-tools`)
    } catch {
      continue
    }
    const newest = newestVersion(entries.filter(e => e.kind === 'dir').map(e => e.name))
    if (!newest) continue
    const path = `${root}/build-tools/${newest}/aapt`
    if ((await runs($, [path, 'version'])) !== undefined) return path
  }
  return null
}

export async function listDevices($: EngineInterface, adb: string): Promise<Device[]> {
  const out = await runs($, [adb, 'devices', '-l'])
  return out === undefined ? [] : parseDevices(out)
}

function shell(adb: string, serial: string, ...args: string[]): string[] {
  return [adb, '-s', serial, 'shell', ...args]
}

export async function deviceInfo($: EngineInterface, adb: string, serial: string): Promise<DeviceInfo> {
  const prop = async (name: string) => (await runs($, shell(adb, serial, 'getprop', name)))?.trim() || undefined
  const info: DeviceInfo = {
    model: await prop('ro.product.model'),
    manufacturer: await prop('ro.product.manufacturer'),
    release: await prop('ro.build.version.release'),
    sdk: await prop('ro.build.version.sdk'),
  }
  const battery = await runs($, shell(adb, serial, 'dumpsys', 'battery'))
  if (battery !== undefined) info.battery = parseBattery(battery)
  const power = await runs($, shell(adb, serial, 'dumpsys', 'power'))
  if (power !== undefined) info.screen = parseScreen(power)
  const df = await runs($, shell(adb, serial, 'df', '/data'))
  if (df !== undefined) info.storage = parseDf(df)
  return info
}

// The installed package the base id names: itself, else its first flavor; undefined when none is installed
export async function resolvePackage($: EngineInterface, adb: string, serial: string, base: string): Promise<string | undefined> {
  const out = await runs($, shell(adb, serial, 'cmd', 'package', 'list', 'packages', '-U', base))
  if (out === undefined) return undefined
  return pickPackage(parsePackageList(out), base)
}

// The app's state on the device, or undefined when it is not installed
export async function appInfo($: EngineInterface, adb: string, serial: string, pkg: string): Promise<AppInfo | undefined> {
  const out = await runs($, shell(adb, serial, 'dumpsys', 'package', pkg))
  if (out === undefined) return undefined
  const info = parseDumpsysPackage(out, pkg)
  if (!info) return undefined
  const pid = Number((await runs($, shell(adb, serial, 'pidof', '-s', pkg)))?.trim())
  if (Number.isInteger(pid) && pid > 0) info.pid = pid
  return info
}

export type Installed = { ok: boolean; output: string; ms: number }

export async function install($: EngineInterface, adb: string, serial: string, path: string, flags: readonly string[]): Promise<Installed> {
  const started = await $.clock.now()
  const ran = await run($, [adb, '-s', serial, 'install', '-r', ...flags, path], INSTALL_TIMEOUT)
  const ms = (await $.clock.now()) - started
  if (!ran) return { ok: false, output: 'adb install did not finish', ms }
  const output = `${ran.stdout}\n${ran.stderr}`.trim()
  return { ok: ran.exitCode === 0 && /^Success\b/m.test(output), output, ms }
}

export async function badging($: EngineInterface, aapt: string, path: string): Promise<Badging | undefined> {
  const out = await runs($, [aapt, 'dump', 'badging', path])
  return out === undefined ? undefined : parseBadging(out)
}

export async function launch($: EngineInterface, adb: string, serial: string, pkg: string): Promise<boolean> {
  const out = await runs($, shell(adb, serial, 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'))
  return out !== undefined && !/No activities found/.test(out)
}

export async function forceStop($: EngineInterface, adb: string, serial: string, pkg: string): Promise<boolean> {
  return (await runs($, shell(adb, serial, 'am', 'force-stop', pkg))) !== undefined
}

export async function uninstall($: EngineInterface, adb: string, serial: string, pkg: string): Promise<Ran | undefined> {
  return run($, [adb, '-s', serial, 'uninstall', pkg], PULL_TIMEOUT)
}

export async function clearData($: EngineInterface, adb: string, serial: string, pkg: string): Promise<boolean> {
  const out = await runs($, shell(adb, serial, 'pm', 'clear', pkg))
  return out !== undefined && /^Success/m.test(out)
}

// Takes a screenshot on the device, pulls it to `local` and removes the device's copy
export async function screenshot($: EngineInterface, adb: string, serial: string, remote: string, local: string): Promise<boolean> {
  if ((await runs($, shell(adb, serial, 'screencap', '-p', remote))) === undefined) return false
  const pulled = await runs($, [adb, '-s', serial, 'pull', remote, local], PULL_TIMEOUT)
  await runs($, shell(adb, serial, 'rm', '-f', remote))
  return pulled !== undefined
}

// `screenrecord` ends by itself at the limit; a stop sends it SIGINT so the file is finished
export const RECORD_LIMIT_S = 180

export function recordArgv(adb: string, serial: string, remote: string): string[] {
  return shell(adb, serial, 'screenrecord', '--time-limit', String(RECORD_LIMIT_S), remote)
}

export async function stopRecording($: EngineInterface, adb: string, serial: string): Promise<void> {
  if ((await runs($, shell(adb, serial, 'pkill', '-INT', 'screenrecord'))) !== undefined) return
  const pid = (await runs($, shell(adb, serial, 'pidof', '-s', 'screenrecord')))?.trim()
  if (pid && /^\d+$/.test(pid)) await runs($, shell(adb, serial, 'kill', '-2', pid))
}

export async function pullFile($: EngineInterface, adb: string, serial: string, remote: string, local: string): Promise<boolean> {
  return (await runs($, [adb, '-s', serial, 'pull', remote, local], PULL_TIMEOUT)) !== undefined
}

// Pulls a capture and removes the device's copy
export async function pull($: EngineInterface, adb: string, serial: string, remote: string, local: string): Promise<boolean> {
  const pulled = await pullFile($, adb, serial, remote, local)
  await runs($, shell(adb, serial, 'rm', '-f', remote))
  return pulled
}

// The package of the activity in front, or undefined on the launcher or the lock screen
export async function foregroundApp($: EngineInterface, adb: string, serial: string): Promise<string | undefined> {
  const out = await runs($, shell(adb, serial, 'dumpsys', 'activity', 'activities'))
  return out === undefined ? undefined : foregroundPackage(out)
}

// The APK files a package is installed from: the base, then its splits
export async function apkPaths($: EngineInterface, adb: string, serial: string, pkg: string): Promise<string[]> {
  const out = await runs($, shell(adb, serial, 'pm', 'path', pkg))
  return out === undefined ? [] : parsePmPath(out)
}

export type Repo = { isAndroid: boolean; ids: string[]; apks: Apk[] }

const SKIPPED = new Set(['node_modules', '.git', '.gradle', '.idea', 'buildSrc'])
const MODULE_DEPTH = 3
const APK_DEPTH = 4

// Whether the working directory is an Android repo, its applicationIds (`app/` first) and the APKs its build folders hold
export async function scanRepo($: EngineInterface, root: string): Promise<Repo> {
  const repo: Repo = { isAndroid: false, ids: [], apks: [] }
  let hasSettings = false
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!
    let entries
    try {
      entries = await $.fs.list(dir)
    } catch {
      continue
    }
    const sorted = [...entries].sort((a, b) => (a.name === 'app' ? -1 : b.name === 'app' ? 1 : a.name.localeCompare(b.name)))
    for (const entry of sorted) {
      if (entry.kind !== 'file') continue
      if (depth === 0 && (entry.name === 'settings.gradle' || entry.name === 'settings.gradle.kts')) hasSettings = true
      if (entry.name === 'build.gradle' || entry.name === 'build.gradle.kts') {
        try {
          const text = await $.fs.read(`${dir}/${entry.name}`)
          if (typeof text !== 'string') continue
          if (isApplicationModule(text)) repo.isAndroid = true
          for (const id of applicationIdsFrom(text)) if (!repo.ids.includes(id)) repo.ids.push(id)
        } catch {
          // unreadable: look on
        }
      }
    }
    for (const entry of sorted) {
      if (entry.kind !== 'dir' || SKIPPED.has(entry.name) || entry.name.startsWith('.')) continue
      if (entry.name === 'build') {
        await collectApks($, `${dir}/build/outputs/apk`, 0, repo.apks)
        continue
      }
      if (depth < MODULE_DEPTH) queue.push({ dir: `${dir}/${entry.name}`, depth: depth + 1 })
    }
  }
  repo.isAndroid = repo.isAndroid && hasSettings
  repo.apks = sortApks(repo.apks)
  return repo
}

async function collectApks($: EngineInterface, dir: string, depth: number, into: Apk[]) {
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'file' && /\.apk$/i.test(entry.name)) into.push({ path, size: entry.size, mtimeMs: entry.mtimeMs })
    else if (entry.kind === 'dir' && depth < APK_DEPTH) await collectApks($, path, depth + 1, into)
  }
}
