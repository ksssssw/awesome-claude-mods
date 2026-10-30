import { expect, test } from 'claude-code/testing'

const band = {
  plugin: 'my-mod',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const

test('the band counts the tool calls once there is one', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const before = await $.ui.mount(band)
  expect(await before.find({ type: 'Text', text: /tool calls this session/ })).toBeUndefined()
  await before.unmount()

  await $.tool.call({ tool: 'Read', file_path: 'README.md' } as never)
  const after = await $.ui.mount(band)
  expect(await after.find({ type: 'Text', text: /1 tool calls this session/ })).toBeDefined()
  await after.unmount()
})
