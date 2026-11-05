// Everything that talks to adb or walks the repo: thin calls on `$`, the parsing in model.ts
import type { EngineInterface } from 'claude-code'

import { applicationIdsFrom, parseDevices, parsePackageList, parseResumedPackage, parseVersionCatalog } from './model'
import type { Device, InstalledPackage } from './model'

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

export async function pidOf($: EngineInterface, adb: string, serial: string, pkg: string): Promise<number | undefined> {
  const out = await runs($, [adb, '-s', serial, 'shell', 'pidof', '-s', pkg])
  const pid = Number(out?.trim())
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

// Every package installed on the device with its uid; undefined when adb could not say
export async function listInstalled($: EngineInterface, adb: string, serial: string): Promise<InstalledPackage[] | undefined> {
  const out = await runs($, [adb, '-s', serial, 'shell', 'cmd', 'package', 'list', 'packages', '-U'])
  return out === undefined ? undefined : parsePackageList(out)
}

// The package whose activity is resumed on screen, when the device says
export async function foregroundPackage($: EngineInterface, adb: string, serial: string): Promise<string | undefined> {
  const out = await runs($, [adb, '-s', serial, 'shell', 'dumpsys activity activities | grep ResumedActivity'])
  return out === undefined ? undefined : parseResumedPackage(out)
}

// Folders no build file of an app sits in: outputs, tooling, and a module's sources
const SKIPPED = new Set(['build', 'node_modules', '.git', '.gradle', '.idea', 'buildSrc', 'build-logic', 'src', 'out', 'gradle'])
// Deep enough for an Android project kept a folder or two under the repo root (`workspace/app/…/app`)
const MAX_DEPTH = 6
// At most this many folders are listed, so a large repo does not stall the start
const MAX_DIRS = 3000

// Every applicationId the build files under `root` set, in the order found: breadth first, `app/` before
// its siblings, each file's version catalog references resolved through the nearest `gradle/libs.versions.toml`
export async function detectApplicationIds($: EngineInterface, root: string): Promise<string[]> {
  const ids: string[] = []
  const catalogs = new Map<string, Record<string, string>>()
  const catalogFor = async (dir: string): Promise<Record<string, string>> => {
    // From the build file's folder up to the root, the first folder that holds the catalog
    for (let at = dir; at.length >= root.length; at = at.slice(0, Math.max(0, at.lastIndexOf('/')))) {
      const cached = catalogs.get(at)
      if (cached) return cached
      try {
        const toml = await $.fs.read(`${at}/gradle/libs.versions.toml`)
        const parsed = parseVersionCatalog(typeof toml === 'string' ? toml : '')
        catalogs.set(at, parsed)
        return parsed
      } catch {
        // no catalog here: look a folder up
      }
      if (at === root || !at.includes('/')) break
    }
    return {}
  }

  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let listed = 0
  while (queue.length > 0 && listed < MAX_DIRS) {
    const { dir, depth } = queue.shift()!
    let entries
    try {
      entries = await $.fs.list(dir)
      listed++
    } catch {
      continue
    }
    const sorted = [...entries].sort((a, b) => (a.name === 'app' ? -1 : b.name === 'app' ? 1 : a.name.localeCompare(b.name)))
    for (const entry of sorted) {
      if (entry.kind === 'file' && (entry.name === 'build.gradle' || entry.name === 'build.gradle.kts')) {
        try {
          const gradle = await $.fs.read(`${dir}/${entry.name}`)
          const text = typeof gradle === 'string' ? gradle : ''
          const catalog = /libs\.versions\./.test(text) ? await catalogFor(dir) : {}
          for (const id of applicationIdsFrom(text, catalog)) if (!ids.includes(id)) ids.push(id)
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
  return ids
}
