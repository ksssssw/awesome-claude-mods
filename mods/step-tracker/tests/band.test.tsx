import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const band = (bodyColumns: number) =>
  ({
    plugin: 'step-tracker',
    component: 'AbovePrompt',
    requestId: 'band',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 20,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 19 },
      view: {},
    },
  }) as const

const REPO = { name: 'my-app', branch: 'feat/search-filter', isDirty: true, ahead: 2, isWorktree: false }

// Nothing sits beneath the plugin: these hooks stand for the engine
function engine(on: On) {
  on('tool.call', () => ({ result: {} }))
  on('clock.now', () => ({ value: 600_000 }))
  // The band's own drawing beneath the plugins: nothing of another mod
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 42 }, rateLimits: [] },
  }))
  on('state.get', { key: 'repo' }, () => ({ value: { value: REPO, version: 1 } }))
}

const plan = (statuses: ('pending' | 'in_progress' | 'completed')[]) =>
  statuses.map((status, i) => ({
    content: i === 1 ? 'Wire the search filter into the results page and check the empty state' : `step ${i + 1}`,
    status,
    activeForm: `step ${i + 1}`,
  }))

test('the band lists done, active and pending steps with the count', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: plan(['completed', 'in_progress', 'pending', 'pending']) })

  const ui = await $.ui.mount({ ...band(140), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: / 1\/4/ }))?.text).toBe(' 1/4')
  expect(await ui.find({ type: 'Text', text: /✓/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /○/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /feat\/search-filter/ })).toBeDefined()
  await ui.unmount()
})

test('the timeline shows from 92 columns, and once shown stays down to 88', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: plan(['completed', 'in_progress', 'pending']) })

  const rasterAt = async (width: number) => {
    const ui = await $.ui.mount({ ...band(width), surface: 'terminal' })
    const raster = await ui.find({ type: 'Raster' })
    await ui.unmount()
    return raster
  }
  // Growing: nothing until 92
  expect(await rasterAt(50)).toBeUndefined()
  expect(await rasterAt(60)).toBeUndefined()
  expect(await rasterAt(90)).toBeUndefined()
  // The raster fills the list's part of the fixed frame: 12 rows less the borders, divider and activity line
  expect((await rasterAt(92))?.props.rows).toBe(8)
  const inner = 140 - 4
  expect((await rasterAt(140))?.props.columns).toBe(inner - Math.floor(inner * 0.6) - 2)
  // Shrinking: it stays at 88, so a width that wavers does not make it flicker, and leaves under it
  expect(await rasterAt(88)).toBeDefined()
  expect(await rasterAt(87)).toBeUndefined()
})

test('a narrow band drops the repository name but keeps the branch', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: plan(['in_progress', 'pending']) })

  const narrow = await $.ui.mount({ ...band(50), surface: 'terminal' })
  expect(await narrow.find({ type: 'Text', text: /my-app/ })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /feat\/search-filter/ })).toBeDefined()
  await narrow.unmount()

  const wide = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await wide.find({ type: 'Text', text: /my-app/ })).toBeDefined()
  await wide.unmount()
})

test('a finished plan folds to one line', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: plan(['completed', 'completed']) })

  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '2/2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /○|▸/ })).toBeUndefined()
  await ui.unmount()
})

test('a long plan shows the list part of the frame, following the active step', async ($, on) => {
  engine(on)
  const statuses = Array.from({ length: 12 }, (_, i) => (i < 9 ? 'completed' : i === 9 ? 'in_progress' : 'pending'))
  await $.tool.call({ tool: 'TodoWrite', todos: plan(statuses as ('pending' | 'in_progress' | 'completed')[]) })

  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: /^[✓▸○] $/ })).length).toBe(8)
  // Following the active step: step 10 shows, step 1 does not, and nothing scrolls by hand
  expect(await ui.find({ type: 'Text', text: /^step 10$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^step 1$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', props: { key: 'up' } })).toBeUndefined()
  await ui.unmount()
})

test('nothing is drawn with no plan and no turn, and the desktop gets the list without a graph', async ($, on) => {
  engine(on)
  const empty = await $.ui.mount({ ...band(140), surface: 'terminal' })
  expect(await empty.find({ type: 'Text', text: /STEPS/ })).toBeUndefined()
  await empty.unmount()

  await $.tool.call({ tool: 'TodoWrite', todos: plan(['in_progress', 'pending']) })
  const desktop = await $.ui.mount({ ...band(140), surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /STEPS/ })).toBeDefined()
  await desktop.unmount()
})

test('background agents keep the band up after the turn, each with what it does', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'm', agentId: 'ag1' }))
  on('classic.UserPromptSubmit', () => ({}))
  await $.classic.UserPromptSubmit({ prompt: 'x', permission_mode: 'plan' })
  await $.agent.spawn({ prompt: 'p', description: 'search code', subagentType: 'Explore' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'render', agentId: 'ag1' } as never)

  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  // The turn is over: the line says the agents still run, glyph by glyph
  expect(await ui.find({ type: 'Text', text: 'B' })).toBeDefined()
  const row = await ui.find({ type: 'Button', text: /explore · .*search code ─ Grep render \(1\)/ })
  expect(row).toBeDefined()
  // Pressed, the agent's calls take the list's place; pressed shut, the list comes back
  await ui.press({ key: 'open-agent-ag1' })
  expect(await ui.find({ type: 'Text', text: 'Task: search code' })).toBeDefined()
  await ui.press({ key: 'close-detail' })
  expect(await ui.find({ type: 'Text', text: 'Task: search code' })).toBeUndefined()
  await ui.unmount()
})

test('the model stream passes untouched while the line names its phase', async ($, on) => {
  // The engine without a stored repository: the turn reads it from git, which finds none here
  on('clock.now', () => ({ value: 600_000 }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 42 }, rateLimits: [] },
  }))
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }))
  on('session.cwd', () => ({ value: '/r' }))
  on('tool.call', () => ({ result: {} }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('turn.step', async function* (_$, e) {
    yield { kind: 'thinking', index: 0, text: 'hm' } as const
    yield { kind: 'text', index: 1, text: 'hello' } as const
    return { turnId: e.turnId, index: e.index, answer: 'hello', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.turn.start({ turnId: 't1' } as never)
  const chunks: string[] = []
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })
  for await (const chunk of stream) chunks.push(chunk.kind)
  expect(chunks).toEqual(['thinking', 'text'])

  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  // After the text chunk the line reads Writing the answer, one glyph per run
  expect(await ui.find({ type: 'Text', text: 'W' })).toBeDefined()
  await ui.unmount()

  // A command this turn: its count opens the list of commands, and the call itself its whole line
  await $.tool.call({ tool: 'Bash', command: 'git switch -c fix/typo', description: 'make a fix branch' } as never)
  const after = await $.ui.mount({ ...band(100), surface: 'terminal' })
  await after.press({ key: 'kind-run' })
  expect(await after.find({ type: 'Text', text: /run 1 ─ this turn/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /Bash make a fix branch {2}\(done/ })).toBeDefined()
  await after.press({ key: 'close-detail' })
  const call = await after.find({ type: 'Button', text: 'Bash make a fix branch' })
  await after.press({ key: call?.props.key as string })
  expect(await after.find({ type: 'Text', text: '$ git switch -c fix/typo' })).toBeDefined()
  await after.unmount()
})

test('plan mode is read from its reminder when the classic events never arrive', async ($, on) => {
  // The engine without a stored repository, as the stream test has it
  on('clock.now', () => ({ value: 600_000 }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 42 }, rateLimits: [] },
  }))
  on('prompt.attachment', () => ({ text: '' }))
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }))
  on('session.cwd', () => ({ value: '/r' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  await $.turn.start({ turnId: 't1' } as never)
  await $.prompt.attachment({ type: 'plan_mode', text: '', origin: { kind: 'engine' } } as never)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  // Planning, one glyph per run
  expect(await ui.find({ type: 'Text', text: 'P' })).toBeDefined()
  await ui.unmount()
})

test('the frame keeps its height as calls pile up; the newest rise from the bottom beside the activity graph', async ($, on) => {
  engine(on)
  on('ui.toast', () => ({ value: undefined }))
  // No step and no turn: nothing shows; a forced band shows the frame
  await $.command.run({ command: 'steps' } as never)
  const height = async () => {
    const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
    const bars = (await ui.findAll({ type: 'Text', text: '│ ' })).length
    await ui.unmount()
    return bars
  }
  const empty = await height()
  for (let i = 0; i < 12; i += 1) await $.tool.call({ tool: 'Read', file_path: `/r/f${i}.ts` } as never)
  expect(await height()).toBe(empty)

  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  // The counts take a row, so the list's seven rows hold the last seven reads; the first ones have risen out
  expect(await ui.find({ type: 'Text', text: 'Read f11.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Read f5.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Read f4.ts' })).toBeUndefined()
  // With no step the graph is the activity chart, as tall as the list
  expect((await ui.find({ type: 'Raster' }))?.props.rows).toBe(7)
  await ui.unmount()
})

test('a background shell keeps the band up after the turn until its notification ends it', async ($, on) => {
  on('clock.now', () => ({ value: 600_000 }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 42 }, rateLimits: [] },
  }))
  on('session.cwd', () => ({ value: '/r' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b123' } }))
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }))

  await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'build the app', run_in_background: true } as never)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /build the app ─ npm run build/ })).toBeDefined()
  await ui.press({ key: 'open-shell-b123' })
  expect(await ui.find({ type: 'Text', text: /Task ID: b123/ })).toBeDefined()
  await ui.unmount()

  await $.prompt.submit({
    text: '<task-notification>\n<task-id>b123</task-id>\n<status>completed</status>\n</task-notification>',
    origin: { kind: 'task-notification' },
  } as never)
  const after = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await after.find({ type: 'Button', text: /build the app/ })).toBeUndefined()
  await after.unmount()
})

test('with language set to ko the band draws in Korean', { options: { language: 'ko' } }, async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' } as never)
  await $.command.run({ command: 'steps' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /이번 턴/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: '읽기 1' })).toBeDefined()
  await ui.unmount()
})
