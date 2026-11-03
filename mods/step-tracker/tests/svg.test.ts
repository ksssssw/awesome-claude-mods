import { expect, test } from 'claude-code/testing'

import { blockRects, CELL_H, CELL_W, gridSvg, hex } from '../hooks/svg'
import { DEFAULT_COLOR } from '../hooks/timeline'

test('block glyphs become rectangles: full, eighths from the left and the bottom, quadrants', () => {
  expect(blockRects(0x2588, 0, 0, '#fff')).toEqual([{ x: 0, y: 0, w: CELL_W, h: CELL_H, fill: '#fff' }])
  // ▌ is four eighths from the left, ▁ one eighth from the bottom
  expect(blockRects(0x258c, 8, 0, '#fff')).toEqual([{ x: 8, y: 0, w: CELL_W / 2, h: CELL_H, fill: '#fff' }])
  expect(blockRects(0x2581, 0, 16, '#fff')).toEqual([{ x: 0, y: 16 + CELL_H - CELL_H / 8, w: CELL_W, h: CELL_H / 8, fill: '#fff' }])
  // ▛ fills three quadrants, ▐ the right half
  expect(blockRects(0x259b, 0, 0, '#fff')).toHaveLength(3)
  expect(blockRects(0x2590, 0, 0, '#fff')).toEqual([{ x: CELL_W / 2, y: 0, w: CELL_W / 2, h: CELL_H, fill: '#fff' }])
  expect(blockRects(0x41, 0, 0, '#fff')).toBeUndefined()
})

test('a bar of one color is one rectangle, dots are circles, spaces draw nothing', () => {
  const svg = gridSvg([
    [
      [0x2588, 0xd97757],
      [0x2588, 0xd97757],
      [0x2588, 0xd97757],
      [0x20, DEFAULT_COLOR],
      [0x00b7, 0x57606a],
    ],
  ])
  expect(svg.match(/<rect /g)).toHaveLength(1)
  expect(svg).toContain(`width="${CELL_W * 3}"`)
  expect(svg.match(/<circle /g)).toHaveLength(1)
  expect(svg).toContain(`viewBox="0 0 ${CELL_W * 5} ${CELL_H}"`)
})

test('colors are hex, the default a grey', () => {
  expect(hex(0x6e7781)).toBe('#6e7781')
  expect(hex(0x000001)).toBe('#000001')
  expect(hex(DEFAULT_COLOR)).toMatch(/^#[0-9a-f]{6}$/)
})
