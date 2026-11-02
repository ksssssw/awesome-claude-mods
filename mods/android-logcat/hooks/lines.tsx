// The scrolling body of the pane: a Client region that draws a window of the lines it is handed
// and turns the keys it gets (after a click gives it the focus) into scroll requests for the hooks module.
import type { ClientModule } from 'claude-code'

import { styleOf } from './model'
import type { Entry } from './model'

export type LinesProps = {
  lines: Entry[]
  // Lines from the end the window is pulled up by; 0 follows the newest
  offset: number
  // The rows the hooks module laid the region out with, for before the surface reports its own
  rows: number
  empty: string
  newer: string
}

type State = { hasKeys: true }

const Lines: ClientModule<LinesProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ hasKeys: true })
    surface.onKey(key => {
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
  }

  const rows = Math.max(1, surface.rows || props.rows)
  const total = props.lines.length
  const offset = Math.min(props.offset, Math.max(0, total - rows))
  const end = total - offset
  const start = Math.max(0, end - rows)
  const shown = props.lines.slice(start, end)
  const hasNewer = offset > 0

  return (
    <Box flexDirection="column">
      {total === 0 && <Text dimColor>{props.empty}</Text>}
      {shown.slice(0, hasNewer ? rows - 1 : rows).map(entry => line(entry, Text))}
      {hasNewer && <Text dimColor>{props.newer.replace('{n}', String(offset))}</Text>}
    </Box>
  )
}

type TextLike = typeof Lines extends ClientModule<LinesProps, State> ? Parameters<typeof Lines>[1]['elements']['Text'] : never

// One log line: time dim; W/E/F whole in their color, V/D/I only the level and the tag
function line(entry: Entry, Text: TextLike) {
  const style = styleOf(entry.level)
  const head = `${entry.level}/${entry.tag}:`
  if (style.isWhole) {
    return (
      <Text color={style.color} bold={style.isBold} wrap="truncate-end">
        <Text dimColor>{entry.time}</Text>  {head} {entry.message}
      </Text>
    )
  }
  return (
    <Text wrap="truncate-end">
      <Text dimColor>{entry.time}</Text>  <Text color={style.color} dimColor={style.isDim}>{head}</Text> {entry.message}
    </Text>
  )
}

export default Lines
