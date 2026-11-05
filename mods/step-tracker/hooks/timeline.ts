// The step timeline: one Raster row per list row, each step a bar from its start to its end
import { mix } from './model'
import type { CallEntry, CallKind, Row } from './model'
import { MASCOT_ROWS, drawMascot } from './mascot'
import type { Mood, Scene } from './mascot'

export { MASCOT_ROWS, MASCOT_WIDTH, mascotColumn } from './mascot'
export type { Mood, Scene } from './mascot'

export const DEFAULT_COLOR = 0x01000000
const SPACE = 0x20
const FULL = 0x2588
const DOT = 0x00b7

// Muted for what is done, Claude's orange for what runs, a brighter orange for its pulsing tip
export const COLORS = { done: 0x6e7781, active: 0xd97757, tip: 0xffb38a, track: 0x57606a }

// ▏▎▍▌▋▊▉█: the block holding `eighths` eighths of a cell from the left
function partial(eighths: number): number {
  return 0x2590 - eighths
}

export type Span = { from: number; to: number }

// The cells of one row, as [codePoint, foreground] pairs
function rowCells(row: Row, columns: number, span: Span, now: number, frame: number): [number, number][] {
  const cells: [number, number][] = Array.from({ length: columns }, () => [SPACE, DEFAULT_COLOR])
  if (row.kind !== 'step') return cells
  const { step } = row

  if (step.status === 'pending' || step.startedAt === undefined) {
    for (let c = 1; c < columns; c += 3) cells[c] = [DOT, COLORS.track]
    return cells
  }

  // Show at least a minute, so the first seconds do not fill the width
  const length = Math.max(span.to - span.from, 60_000)
  const x = (t: number) => ((t - span.from) / length) * columns
  const end = step.status === 'completed' ? (step.endedAt ?? now) : now
  const x0 = Math.min(Math.max(0, Math.floor(x(step.startedAt))), columns - 1)
  const x1 = Math.min(Math.max(x(end), x0 + 1 / 8), columns)
  const color = step.status === 'completed' ? COLORS.done : COLORS.active

  const whole = Math.floor(x1)
  for (let c = x0; c < whole; c += 1) cells[c] = [FULL, color]
  const eighths = Math.round((x1 - whole) * 8)
  if (eighths > 0 && whole < columns) cells[whole] = [partial(eighths), color]

  // The running bar's last cell breathes, one cycle a second at eight frames a second
  if (step.status === 'in_progress') {
    const tip = eighths > 0 && whole < columns ? whole : Math.max(x0, whole - 1)
    const glow = (Math.sin((frame / 8) * Math.PI * 2) + 1) / 2
    cells[tip] = [cells[tip]?.[0] ?? FULL, mix(COLORS.active, COLORS.tip, glow)]
  }
  return cells
}

// The timeline as a grid of [codePoint, foreground] cells, one row per list row
export function timelineGrid(rows: readonly Row[], columns: number, span: Span, now: number, frame: number): Grid {
  return rows.map(row => rowCells(row, columns, span, now, frame))
}

// Packs the rows into a Raster's `cells`: base64 of [codePoint, foreground, background] u32 triplets
export function timelineCells(rows: readonly Row[], columns: number, span: Span, now: number, frame: number): string {
  return gridCells(timelineGrid(rows, columns, span, now, frame))
}

// A grid as a Raster's `cells`
export function gridCells(grid: Grid): string {
  const words = grid.flatMap(row => row.flatMap(([code, color]) => [code, color, DEFAULT_COLOR]))
  return toBase64(new Uint8Array(Uint32Array.from(words).buffer))
}

// The activity graph beside a planless list: calls per two seconds as bars, newest at the right,
// and under them Claude's mascot playing its scene (see mascot.ts)
export const BUCKET_MS = 2000
export const KIND_COLORS: Record<CallKind, number> = {
  read: 0x6e9ecf,
  edit: 0xd97757,
  run: 0x7fb069,
  search: 0xb48ead,
  skill: 0xe5c07b,
  other: 0x8a8f98,
}
const AXIS_COLOR = 0x3a3f45
const LOWER = 0x2581

// Rows of [codePoint, foreground] cells: what a Raster draws in the terminal and an Svg elsewhere
export type Grid = [number, number][][]

function blankGrid(columns: number, rows: number): Grid {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => [SPACE, DEFAULT_COLOR] as [number, number]))
}

// The calls of each two-second bucket, the last bucket ending now, by kind
export function bucketCalls(log: readonly CallEntry[], columns: number, now: number): CallKind[][] {
  const buckets: CallKind[][] = Array.from({ length: columns }, () => [])
  const start = now - columns * BUCKET_MS
  for (const entry of log) {
    if (entry.startedAt <= start || entry.startedAt > now) continue
    const index = Math.min(columns - 1, Math.floor((entry.startedAt - start) / BUCKET_MS))
    buckets[index]!.push(entry.kind)
  }
  return buckets
}

export function activityCells(
  log: readonly CallEntry[],
  columns: number,
  rows: number,
  now: number,
  frame: number,
  mood: Mood,
  scene: Scene = 'walk',
  pace = frame,
): string {
  return gridCells(activityGrid(log, columns, rows, now, frame, mood, scene, pace))
}

export function activityGrid(
  log: readonly CallEntry[],
  columns: number,
  rows: number,
  now: number,
  frame: number,
  mood: Mood,
  scene: Scene = 'walk',
  pace = frame,
): Grid {
  const grid = blankGrid(columns, rows)
  const mascotRows = rows >= MASCOT_ROWS + 1 ? MASCOT_ROWS : 0
  const chartRows = rows - mascotRows
  if (chartRows > 0) {
    const buckets = bucketCalls(log, columns, now)
    const scale = Math.max(3, ...buckets.map(bucket => bucket.length))
    buckets.forEach((bucket, c) => {
      const bottom = chartRows - 1
      if (bucket.length === 0) {
        grid[bottom]![c] = [LOWER, AXIS_COLOR]
        return
      }
      // The kind most called in the bucket colors its bar
      const counts = new Map<CallKind, number>()
      for (const kind of bucket) counts.set(kind, (counts.get(kind) ?? 0) + 1)
      const kind = [...counts].sort((a, b) => b[1] - a[1])[0]![0]
      let eighths = Math.max(1, Math.round((bucket.length / scale) * chartRows * 8))
      for (let r = bottom; r >= 0 && eighths > 0; r -= 1) {
        const take = Math.min(8, eighths)
        grid[r]![c] = [take === 8 ? FULL : LOWER + take - 1, KIND_COLORS[kind]]
        eighths -= take
      }
    })
  }
  if (mascotRows > 0) drawMascot(grid, chartRows, columns, frame, mood, scene, pace)
  return grid
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Standard padded base64, written out so it does not depend on what the environment provides
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
  }
  return out
}
