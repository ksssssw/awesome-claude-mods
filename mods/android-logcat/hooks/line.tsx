// One log line as both the pane's fallback list and the Client region draw it
import type { ElementConstructor, TextProps } from 'claude-code'

import { styleOf } from './model'
import type { Entry } from './model'

export type TextLike = ElementConstructor<TextProps>

// Time dim; W/E/F whole in their color, V/D/I only the level and the tag. In the surface's monospaced face, so the
// columns line up where the font is proportional (the terminal is monospaced and ignores it). Off the terminal the
// level is a colored badge before the tag
export function line(entry: Entry, Text: TextLike, isTui = true) {
  const style = styleOf(entry.level)
  const weight = style.isBold ? 'bold' : undefined
  if (!isTui) {
    return (
      <Text mono wrap="truncate-end">
        <Text dimColor>{entry.time}</Text>{' '}
        <Text backgroundColor={style.color} color="inverseText" weight="bold">
          {` ${entry.level} `}
        </Text>{' '}
        <Text color={style.color} dimColor={style.isDim}>
          {entry.tag}
        </Text>{' '}
        <Text color={style.isWhole ? style.color : undefined} weight={weight}>
          {entry.message}
        </Text>
      </Text>
    )
  }
  const head = `${entry.level}/${entry.tag}:`
  if (style.isWhole) {
    return (
      <Text mono color={style.color} weight={weight} wrap="truncate-end">
        <Text dimColor>{entry.time}</Text>  {head} {entry.message}
      </Text>
    )
  }
  return (
    <Text mono wrap="truncate-end">
      <Text dimColor>{entry.time}</Text>  <Text color={style.color} dimColor={style.isDim}>{head}</Text> {entry.message}
    </Text>
  )
}
