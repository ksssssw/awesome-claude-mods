// The scrolling body of the pane: a Client region that draws a window of the lines it is handed, cut to its
// rows (each line one row, or under wrap as many as it takes), turns the keys it gets (after a click gives it
// the focus) into scroll requests, and selects whole lines by drag, click and Shift+arrows to copy them.
import type { ClientModule, RenderElement } from 'claude-code'

import { line, wrappedRows } from './line'
import { formatLine, rowsOf, windowOf } from './model'
import type { Entry } from './model'

export type LinesProps = {
  lines: Entry[]
  // Lines from the end the window is pulled up by; 0 follows the newest
  offset: number
  // The rows the hooks module laid the region out with, for before the surface reports its own
  rows: number
  // The columns the pane's body had, for before the surface reports the region's own
  columns: number
  // Lines that arrived since the view was held by scrolling up; told with the offset
  newerCount: number
  empty: string
  newer: string
  // Whether the pane is drawn in the terminal: elsewhere the level is a badge
  isTui: boolean
  // Whether a line wider than the region continues on the rows under it
  isWrap: boolean
  // Moves on when the hooks module drops the selection (follow, clear, another app)
  epoch: number
}

// A selection by the lines' `seq`: the line it began on and the one it reaches
type Selection = { anchor: number; focus: number }

// What the listeners, set once, read of the latest draw: the props and which line each row shows
type Ref = { props: LinesProps; rowSeqs: number[]; epoch: number; drag?: { startRow: number; hasMoved: boolean } }

type State = { ref: Ref; sel?: Selection }

// The entries between two seqs, both ends kept, in the order shown
function selected(lines: readonly Entry[], sel: Selection | undefined): Entry[] {
  if (!sel) return []
  const lo = Math.min(sel.anchor, sel.focus)
  const hi = Math.max(sel.anchor, sel.focus)
  return lines.filter(e => e.seq !== undefined && e.seq >= lo && e.seq <= hi)
}

const Lines: ClientModule<LinesProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref: Ref = surface.state?.ref ?? { props, rowSeqs: [], epoch: props.epoch }
  if (surface.state === undefined) {
    surface.setState({ ref })
    const state = (): State => surface.state ?? { ref }
    const select = (sel: Selection | undefined) => surface.setState({ ...state(), sel })
    const copy = (sel: Selection | undefined) => {
      const entries = selected(state().ref.props.lines, sel)
      if (entries.length === 0) return
      surface.post({ copy: entries.map(formatLine).join('\n'), count: entries.length })
      select(undefined)
    }
    const seqAt = (row: number): number | undefined => {
      const seqs = state().ref.rowSeqs
      if (seqs.length === 0) return undefined
      return seqs[Math.min(seqs.length - 1, Math.max(0, row))]
    }

    surface.onKey(key => {
      const { sel, ref: now } = state()
      if (key.shift && (key.key === 'up' || key.key === 'down') && sel) {
        const seqs = now.props.lines.map(e => e.seq ?? -1)
        const at = seqs.indexOf(sel.focus)
        const next = seqs[at + (key.key === 'up' ? -1 : 1)]
        if (at >= 0 && next !== undefined) select({ anchor: sel.anchor, focus: next })
        return
      }
      if (key.key === 'y') {
        copy(sel)
        return
      }
      const scroll =
        key.key === 'up' ? 'up'
        : key.key === 'down' ? 'down'
        : key.key === 'pageup' ? 'pageup'
        : key.key === 'pagedown' ? 'pagedown'
        : key.key === 'home' ? 'oldest'
        : key.key === 'end' ? 'newest'
        : undefined
      if (scroll) surface.post({ scroll })
    })

    surface.onPointer(event => {
      const { ref: now, sel } = state()
      const rows = Math.max(1, surface.rows || now.props.rows)
      if (event.type === 'down') {
        const seq = seqAt(event.y)
        if (seq === undefined) return
        now.drag = { startRow: event.y, hasMoved: false }
        // The view holds still while a selection stands, so the rows under the pointer stay put
        surface.post({ select: 'begin' })
        select({ anchor: seq, focus: seq })
        return
      }
      if (!now.drag || !sel) return
      if (event.type === 'move') {
        // Past the top or the bottom the lines scroll that way and the selection reaches the edge's line. The post
        // repeats the hold, since a later post in one frame replaces the one that began it
        if (event.y < 0) surface.post({ scroll: 'up', select: 'begin' })
        else if (event.y >= rows) surface.post({ scroll: 'down', select: 'begin' })
        const seq = seqAt(event.y)
        if (event.y !== now.drag.startRow) now.drag.hasMoved = true
        if (seq !== undefined && seq !== sel.focus) select({ anchor: sel.anchor, focus: seq })
        return
      }
      if (event.type === 'up') {
        const wasDrag = now.drag.hasMoved && sel.anchor !== sel.focus
        now.drag = undefined
        // A drag copies on release; a click leaves one line selected, for Shift+arrows and y
        if (wasDrag) copy(sel)
      }
    })
  }

  const state: State = surface.state ?? { ref }
  ref.props = props
  let sel = state.sel
  if (ref.epoch !== props.epoch) {
    ref.epoch = props.epoch
    sel = undefined
    if (state.sel) surface.setState({ ...state, sel: undefined })
  }

  const rows = Math.max(1, surface.rows || props.rows)
  const columns = surface.columns || props.columns
  const total = props.lines.length
  const hasNewer = props.offset > 0
  const heights = props.lines.map(e => rowsOf(e, columns, props.isWrap))
  const offset = Math.min(props.offset, Math.max(0, total - 1))
  // Scrolled to the oldest the window starts at the first line; else it ends `offset` lines from the end,
  // a tall first line cut at the top edge. Either way the newer note takes the bottom row while the view is held
  const isTop = offset > 0 && offset >= total - rows
  const win = isTop ? { start: 0, end: total, cut: 0 } : windowOf(heights, offset, rows)
  const chosen = new Set(selected(props.lines, sel).map(e => e.seq))

  const drawn: RenderElement[] = []
  const rowSeqs: number[] = []
  for (let i = win.start; i < win.end && drawn.length < rows; i++) {
    const entry = props.lines[i]
    if (!entry) continue
    const isSelected = chosen.has(entry.seq)
    const parts = props.isWrap ? wrappedRows(entry, Text, columns, props.isTui, isSelected) : [line(entry, Text, props.isTui, isSelected)]
    // The first line's rows above the top edge are left out
    const from = i === win.start ? win.cut : 0
    for (let r = from; r < parts.length && drawn.length < rows; r++) {
      const part = parts[r]
      if (!part) continue
      drawn.push(part)
      rowSeqs.push(entry.seq ?? -1)
    }
  }
  if (hasNewer && drawn.length >= rows) {
    drawn.length = rows - 1
    rowSeqs.length = rows - 1
  }
  ref.rowSeqs = rowSeqs

  return (
    <Box flexDirection="column">
      {total === 0 && <Text dimColor>{props.empty}</Text>}
      {drawn}
      {hasNewer && <Text dimColor>{props.newer.replace('{n}', String(offset + props.newerCount))}</Text>}
    </Box>
  )
}

export default Lines
