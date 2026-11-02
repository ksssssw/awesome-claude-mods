// One log line as both the pane's fallback list and the Client region draw it
import type { ElementConstructor, TextProps } from 'claude-code'

import { styleOf } from './model'
import type { Entry } from './model'

export type TextLike = ElementConstructor<TextProps>

// Time dim; W/E/F whole in their color, V/D/I only the level and the tag
export function line(entry: Entry, Text: TextLike) {
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
