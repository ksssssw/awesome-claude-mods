import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

// How many tool calls the main conversation made; a value the band reads, so a write redraws it
const calls = atom({ plugin: 'my-mod', key: 'count' } as const, 0)

export const register: Register = on => {
  // Watching only: count the call, then let it run as it would
  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) await update($, calls, n => n + 1)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A one-line band above the prompt, under whatever other mods draw there
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    const n = await read($, calls)
    if (n === 0) return theirs
    const { Box, Text } = $.ui.resolve(e)
    const mine = <Text dimColor>my-mod: {n} tool calls this session</Text>
    return theirs ? (
      <Box flexDirection="column">
        {mine}
        {theirs}
      </Box>
    ) : (
      mine
    )
  })
}
