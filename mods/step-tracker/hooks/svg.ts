// Draws a cell grid (what a Raster draws in the terminal) as SVG for the surfaces with no Raster: the block glyphs
// become rectangles, so the timeline and the mascot keep their shapes in a proportional font
import { DEFAULT_COLOR } from './timeline'
import type { Grid } from './timeline'

// One cell in SVG units: eighths of a cell fall on whole units both ways
export const CELL_W = 8
export const CELL_H = 16
// The foreground a cell with the default color is drawn in
const DEFAULT_FILL = '#8b949e'

type Rect = { x: number; y: number; w: number; h: number; fill: string }

// The quadrants each quadrant glyph fills: upper left, upper right, lower left, lower right
const QUADRANTS: Record<number, [boolean, boolean, boolean, boolean]> = {
  0x2596: [false, false, true, false],
  0x2597: [false, false, false, true],
  0x2598: [true, false, false, false],
  0x2599: [true, false, true, true],
  0x259a: [true, false, false, true],
  0x259b: [true, true, true, false],
  0x259c: [true, true, false, true],
  0x259d: [false, true, false, false],
  0x259e: [false, true, true, false],
  0x259f: [false, true, true, true],
}

// The dots, by their radius in units
const DOTS: Record<number, number> = { 0x00b7: 1.5, 0x2219: 2, 0x2022: 3 }

export function hex(color: number): string {
  if (color === DEFAULT_COLOR) return DEFAULT_FILL
  return '#' + (color & 0xffffff).toString(16).padStart(6, '0')
}

// The rectangles of one block glyph in the cell at (x, y), or undefined when the glyph is no block
export function blockRects(code: number, x: number, y: number, fill: string): Rect[] | undefined {
  const W = CELL_W
  const H = CELL_H
  // █ and ▉…▏: from the left, in eighths
  if (code === 0x2588) return [{ x, y, w: W, h: H, fill }]
  if (code >= 0x2589 && code <= 0x258f) return [{ x, y, w: ((0x2590 - code) * W) / 8, h: H, fill }]
  // ▁…▇: from the bottom, in eighths
  if (code >= 0x2581 && code <= 0x2587) {
    const h = ((code - 0x2580) * H) / 8
    return [{ x, y: y + H - h, w: W, h, fill }]
  }
  if (code === 0x2580) return [{ x, y, w: W, h: H / 2, fill }]
  if (code === 0x2590) return [{ x: x + W / 2, y, w: W / 2, h: H, fill }]
  const quads = QUADRANTS[code]
  if (quads) {
    const [ul, ur, ll, lr] = quads
    const rects: Rect[] = []
    if (ul) rects.push({ x, y, w: W / 2, h: H / 2, fill })
    if (ur) rects.push({ x: x + W / 2, y, w: W / 2, h: H / 2, fill })
    if (ll) rects.push({ x, y: y + H / 2, w: W / 2, h: H / 2, fill })
    if (lr) rects.push({ x: x + W / 2, y: y + H / 2, w: W / 2, h: H / 2, fill })
    return rects
  }
  return undefined
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The grid as an SVG document, CELL_W by CELL_H units a cell; rectangles of one color that meet along a row are
// joined, so a long bar is one element
export function gridSvg(grid: Grid): string {
  const rows = grid.length
  const columns = grid[0]?.length ?? 0
  const width = columns * CELL_W
  const height = rows * CELL_H
  const shapes: string[] = []
  grid.forEach((row, r) => {
    const y = r * CELL_H
    const rects: Rect[] = []
    row.forEach(([code, color], c) => {
      if (code === 0x20) return
      const x = c * CELL_W
      const fill = hex(color)
      const blocks = blockRects(code, x, y, fill)
      if (blocks) {
        for (const rect of blocks) {
          const last = rects[rects.length - 1]
          if (last && last.fill === rect.fill && last.y === rect.y && last.h === rect.h && last.x + last.w === rect.x) last.w += rect.w
          else rects.push({ ...rect })
        }
        return
      }
      const radius = DOTS[code]
      if (radius !== undefined) {
        shapes.push(`<circle cx="${x + CELL_W / 2}" cy="${y + CELL_H / 2}" r="${radius}" fill="${fill}"/>`)
        return
      }
      shapes.push(
        `<text x="${x + CELL_W / 2}" y="${y + CELL_H * 0.75}" fill="${fill}" font-size="${CELL_H * 0.8}" text-anchor="middle" font-family="monospace">${escape(String.fromCodePoint(code))}</text>`,
      )
    })
    for (const rect of rects) shapes.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${rect.fill}"/>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${shapes.join('')}</svg>`
}
