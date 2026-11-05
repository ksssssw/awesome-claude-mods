// One log line as both the pane's fallback list and the Client region draw it: one row cut at the edge,
// or under wrap the rows its message is cut into, the later ones indented under the time
import type { ElementConstructor, RenderElement, TextProps } from 'claude-code'

import { styleOf, WRAP_INDENT, wrapMessage } from './model'
import type { Entry } from './model'

export type TextLike = ElementConstructor<TextProps>

// Time dim; W/E/F whole in their color, V/D/I only the level and the tag. In the surface's monospaced face, so the
// columns line up where the font is proportional (the terminal is monospaced and ignores it). Off the terminal the
// level is a colored badge before the tag. A selected line is drawn inverse
export function line(entry: Entry, Text: TextLike, isTui = true, isSelected = false) {
  return head(entry, Text, isTui, isSelected, entry.message, 'truncate-end')
}

function head(entry: Entry, Text: TextLike, isTui: boolean, isSelected: boolean, message: string, wrap: TextProps['wrap']) {
  const style = styleOf(entry.level)
  const weight = style.isBold ? 'bold' : undefined
  const inverse = isSelected || undefined
  if (!isTui) {
    return (
      <Text mono wrap={wrap} inverse={inverse}>
        <Text dimColor>{entry.time}</Text>{' '}
        <Text backgroundColor={style.color} color="inverseText" weight="bold">
          {` ${entry.level} `}
        </Text>{' '}
        <Text color={style.color} dimColor={style.isDim}>
          {entry.tag}
        </Text>{' '}
        <Text color={style.isWhole ? style.color : undefined} weight={weight}>
          {message}
        </Text>
      </Text>
    )
  }
  const label = `${entry.level}/${entry.tag}:`
  if (style.isWhole) {
    return (
      <Text mono color={style.color} weight={weight} wrap={wrap} inverse={inverse}>
        <Text dimColor>{entry.time}</Text>  {label} {message}
      </Text>
    )
  }
  return (
    <Text mono wrap={wrap} inverse={inverse}>
      <Text dimColor>{entry.time}</Text>  <Text color={style.color} dimColor={style.isDim}>{label}</Text> {message}
    </Text>
  )
}

const INDENT = ' '.repeat(WRAP_INDENT)

// The rows of a wrapped line: the head with the message's first piece, then each later piece under the indent,
// in the line's color where the whole line takes it
export function wrappedRows(entry: Entry, Text: TextLike, columns: number, isTui: boolean, isSelected: boolean): RenderElement[] {
  const pieces = wrapMessage(entry, columns)
  const style = styleOf(entry.level)
  const weight = style.isBold ? 'bold' : undefined
  const inverse = isSelected || undefined
  const rows: RenderElement[] = [head(entry, Text, isTui, isSelected, pieces[0] ?? '', 'truncate-end')]
  for (const piece of pieces.slice(1)) {
    rows.push(
      <Text mono color={style.isWhole ? style.color : undefined} weight={weight} wrap="truncate-end" inverse={inverse}>
        {INDENT}
        {piece}
      </Text>,
    )
  }
  return rows
}
