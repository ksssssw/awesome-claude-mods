// Everything that talks to adb or walks the repo: thin calls on `$`, the parsing in model.ts
import type { EngineInterface } from 'claude-code'

import { applicationIdFrom, parseDevices, parsePackageList, pickPackage } from './model'
import type { Device, Pick } from './model'

const RUN_TIMEOUT = 10_000

async function runs($: EngineInterface, argv: string[]): Promise<string | undefined> {
  try {
    const { exitCode, stdout } = await $.process.run(argv, { timeoutMs: RUN_TIMEOUT })
    return exitCode === 0 ? stdout : undefined
  } catch {
    return undefined
  }
}

// `adb` on PATH, else the SDK's copy under ANDROID_HOME, ANDROID_SDK_ROOT or the default macOS location
export async function findAdb($: EngineInterface): Promise<string | undefined> {
  if ((await runs($, ['adb', 'version'])) !== undefined) return 'adb'
  const homes = [await $.env.get('ANDROID_HOME'), await $.env.get('ANDROID_SDK_ROOT')]
  const home = await $.env.get('HOME')
  if (home) homes.push(`${home}/Library/Android/sdk`, `${home}/Android/Sdk`)
  for (const root of homes) {
    if (!root) continue
    const path = `${root}/platform-tools/adb`
    if ((await runs($, [path, 'version'])) !== undefined) return path
  }
  return undefined
}

export async function listDevices($: EngineInterface, adb: string): Promise<Device[]> {
  const out = await runs($, [adb, 'devices', '-l'])
  return out === undefined ? [] : parseDevices(out)
}

export async function resolvePackage($: EngineInterface, adb: string, serial: string, base: string): Promise<Pick | undefined> {
  const out = await runs($, [adb, '-s', serial, 'shell', 'cmd', 'package', 'list', 'packages', '-U', base])
  if (out === undefined) return undefined
  return pickPackage(parsePackageList(out), base)
}

export async function pidOf($: EngineInterface, adb: string, serial: string, pkg: string): Promise<number | undefined> {
  const out = await runs($, [adb, '-s', serial, 'shell', 'pidof', '-s', pkg])
  const pid = Number(out?.trim())
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

const SKIPPED = new Set(['build', 'node_modules', '.git', '.gradle', '.idea', 'buildSrc'])
const MAX_DEPTH = 4

// The first applicationId in a build.gradle(.kts) under `root`, `app/` looked at first
export async function detectApplicationId($: EngineInterface, root: string): Promise<string | undefined> {
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
      if (entry.kind === 'file' && (entry.name === 'build.gradle' || entry.name === 'build.gradle.kts')) {
        try {
          const id = applicationIdFrom(await $.fs.read(`${dir}/${entry.name}`))
          if (id) return id
        } catch {
          // unreadable: look on
        }
      }
    }
    if (depth >= MAX_DEPTH) continue
    for (const entry of sorted) {
      if (entry.kind === 'dir' && !SKIPPED.has(entry.name) && !entry.name.startsWith('.')) {
        queue.push({ dir: `${dir}/${entry.name}`, depth: depth + 1 })
      }
    }
  }
  return undefined
}
