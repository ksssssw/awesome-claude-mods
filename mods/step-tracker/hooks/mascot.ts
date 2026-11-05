// Claude's mascot: the logo's crab, playing one of several scenes under the activity graph.
// A scene is how the crab shows the three moods: working (the turn runs), thinking (the model composes)
// and idle. Every scene keeps the three apart, each in its own way.
import type { Grid } from './timeline'

export const SCENES = ['walk', 'ball', 'fish', 'jump', 'nap'] as const
export type Scene = (typeof SCENES)[number]

export type Mood = 'idle' | 'working' | 'thinking'

const SPACE = 0x20
const MASCOT_COLOR = 0xd97757
// Thoughts, the ball, the line and the bobber: a quiet gray beside the orange
const PROP_COLOR = 0xb5b9c0
const WATER_COLOR = 0x4a6b85
const DUST_COLOR = 0x57606a

// The crab: a head with two eyes, a body, legs in two steps; flat legs when it crouches or lies down
const BODY = [' ▐▛███▜▌ ', '▝▜█████▛▘']
const BLINK = ' ▐█████▌ '
const LEGS = ['  ▘▘ ▝▝  ', '  ▝▘ ▘▝  ']
const LEGS_FLAT = '  ▀▀ ▀▀  '
const ROLLING = ['◐', '◓', '◑', '◒']
const THOUGHT = ['·  ', '·∙ ', '·∙•']
export const MASCOT_WIDTH = 9
// The rows the mascot takes: a thought (or a jump), the head, the body, the legs
export const MASCOT_ROWS = 4

// The scene the person picked in /config, or one drawn for this session when the option is `random`
export function pickScene(option: unknown, random: () => number = Math.random): Scene {
  if (typeof option === 'string' && (SCENES as readonly string[]).includes(option)) return option as Scene
  return SCENES[Math.min(SCENES.length - 1, Math.floor(random() * SCENES.length))]!
}

export function put(grid: Grid, row: number, column: number, text: string, color: number) {
  let c = column
  for (const char of text) {
    const cell = grid[row]?.[c]
    if (cell && char !== ' ') grid[row]![c] = [char.codePointAt(0) ?? SPACE, color]
    c += 1
  }
}

// The crab's walk as a triangle wave over the cells it may pace: `pace` advances only while it works,
// so where it stops while thinking is where it was. `margin` keeps cells free at both ends for a prop.
function paceStep(columns: number, pace: number, margin: number): { room: number; step: number } {
  const room = Math.max(0, columns - MASCOT_WIDTH - margin * 2)
  if (room === 0) return { room, step: 0 }
  const step = Math.floor(pace / 2) % (room * 2)
  return { room, step }
}

// Where the crab stands: pacing the width while it works, the middle when idle
export function mascotColumn(columns: number, pace: number, mood: Mood, margin = 0): number {
  const { room, step } = paceStep(columns, pace, margin)
  if (mood === 'idle' || room === 0) return margin + Math.floor(room / 2)
  return margin + (step <= room ? step : room * 2 - step)
}

// Which way the crab walks: right on the way out, left on the way back
function isFacingLeft(columns: number, pace: number, margin: number): boolean {
  const { room, step } = paceStep(columns, pace, margin)
  return step > room
}

type Pose = { eyes: 'open' | 'closed'; legs: string; lift?: number }

// The crab at column `x`; `lift` raises it by that many rows (a jump borrows the thought row)
function drawCrab(grid: Grid, top: number, x: number, pose: Pose) {
  const base = top + 1 - (pose.lift ?? 0)
  put(grid, base, x, pose.eyes === 'closed' ? BLINK : BODY[0]!, MASCOT_COLOR)
  put(grid, base + 1, x, BODY[1]!, MASCOT_COLOR)
  put(grid, base + 2, x, pose.legs, MASCOT_COLOR)
}

function drawThought(grid: Grid, top: number, x: number, frame: number) {
  put(grid, top, x + MASCOT_WIDTH - 2, THOUGHT[Math.floor(frame / 4) % 3]!, PROP_COLOR)
}

// The crab under the graph: `frame` runs always and times blinks and bobs; `pace` runs only while it works
export function drawMascot(grid: Grid, top: number, columns: number, frame: number, mood: Mood, scene: Scene = 'walk', pace = frame) {
  const eyes = frame % 40 < 2 ? 'closed' : 'open'
  const stepping = mood === 'working' ? LEGS[Math.floor(pace / 2) % 2]! : LEGS[0]!

  if (scene === 'walk' || scene === 'nap') {
    if (scene === 'nap' && mood === 'idle') {
      // Lying down, eyes shut, a z and a Z rising beside its head
      const x = mascotColumn(columns, pace, mood)
      drawCrab(grid, top, x, { eyes: 'closed', legs: LEGS_FLAT })
      const phase = Math.floor(frame / 8) % 3
      if (phase <= 1) put(grid, top + 1, x + MASCOT_WIDTH, 'z', PROP_COLOR)
      if (phase >= 1) put(grid, top, x + MASCOT_WIDTH + 1, 'Z', PROP_COLOR)
      return
    }
    const x = mascotColumn(columns, pace, mood)
    if (mood === 'thinking') drawThought(grid, top, x, frame)
    drawCrab(grid, top, x, { eyes, legs: stepping })
    return
  }

  if (scene === 'ball') {
    // The ball rolls a cell ahead of the crab; while it thinks the ball bounces on the spot
    const x = mascotColumn(columns, pace, mood, 1)
    const ballX = isFacingLeft(columns, pace, 1) ? x - 1 : x + MASCOT_WIDTH
    drawCrab(grid, top, x, { eyes, legs: stepping })
    if (mood === 'working') put(grid, top + 3, ballX, ROLLING[Math.floor(pace / 2) % 4]!, PROP_COLOR)
    else if (mood === 'thinking' && Math.floor(frame / 4) % 2 === 1) put(grid, top + 2, ballX, '∘', PROP_COLOR)
    else put(grid, top + 3, ballX, '●', PROP_COLOR)
    return
  }

  if (scene === 'fish') {
    // Sitting at the left end over the water; the line goes out and comes back while it works,
    // hangs still with a bobbing float while it thinks, and is reeled in when idle
    const x = 0
    const room = columns - MASCOT_WIDTH - 1
    const ripple = Math.floor(frame / 8) % 2
    for (let c = MASCOT_WIDTH + ripple; c < columns; c += 2) put(grid, top + 3, c, '≈', WATER_COLOR)
    drawCrab(grid, top, x, { eyes, legs: LEGS[0]! })
    if (mood === 'idle' || room < 1) return
    const swing = Math.floor(pace / 2) % (room * 2)
    const length = swing < room ? swing + 1 : room * 2 - swing
    const end = MASCOT_WIDTH + length
    put(grid, top + 1, MASCOT_WIDTH, '╌'.repeat(length) + '╮', PROP_COLOR)
    put(grid, top + 2, end, '│', PROP_COLOR)
    const bob = mood === 'thinking' && Math.floor(frame / 4) % 2 === 1
    put(grid, top + 3, end, bob ? '•' : '◦', PROP_COLOR)
    return
  }

  // jump: on the spot, a crouch, a hop into the thought row and a puff of dust on landing
  const x = mascotColumn(columns, pace, 'idle')
  if (mood !== 'working') {
    if (mood === 'thinking') drawThought(grid, top, x, frame)
    drawCrab(grid, top, x, { eyes, legs: LEGS[0]! })
    return
  }
  const phase = Math.floor(pace / 2) % 6
  if (phase === 2) drawCrab(grid, top, x, { eyes, legs: LEGS_FLAT })
  else if (phase === 3) drawCrab(grid, top, x, { eyes, legs: LEGS[1]!, lift: 1 })
  else {
    drawCrab(grid, top, x, { eyes, legs: LEGS[0]! })
    if (phase === 4) {
      put(grid, top + 3, x + 1, '▁', DUST_COLOR)
      put(grid, top + 3, x + MASCOT_WIDTH - 2, '▁', DUST_COLOR)
    }
  }
}
