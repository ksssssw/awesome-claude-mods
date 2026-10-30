import { expect, test } from 'claude-code/testing'

import {
  agentText,
  applyTaskCreate,
  applyTaskUpdate,
  applyTodos,
  buildRows,
  formatDuration,
  recentCalls,
  shortDuration,
  activityText,
  backgroundText,
  endedTasks,
  callKind,
  detailView,
  filesText,
  statParts,
  shimmerColors,
  isGraphShown,
  parseGitStatus,
  parseWorktrees,
  windowOffset,
} from '../hooks/model'
import { MASCOT_WIDTH, activityCells, bucketCalls, mascotColumn, timelineCells } from '../hooks/timeline'

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status })

test('TodoWrite keeps the times of steps it already knew', async () => {
  const first = applyTodos([], [todo('a', 'in_progress'), todo('b', 'pending')], 1000)
  expect(first[0]?.startedAt).toBe(1000)
  const second = applyTodos(first, [todo('a', 'completed'), todo('b', 'in_progress')], 5000)
  expect(second[0]).toMatchObject({ status: 'completed', startedAt: 1000, endedAt: 5000 })
  expect(second[1]).toMatchObject({ status: 'in_progress', startedAt: 5000 })
})

test('TaskCreate starts a new list after a finished one, TaskUpdate moves and deletes', async () => {
  let list = applyTaskCreate([], '1', 'a')
  list = applyTaskUpdate(list, { taskId: '1', status: 'completed' }, 10)
  list = applyTaskCreate(list, '2', 'b')
  expect(list.map(step => step.id)).toEqual(['2'])
  list = applyTaskCreate(list, '3', 'c')
  list = applyTaskUpdate(list, { taskId: '2', status: 'deleted' }, 20)
  expect(list.map(step => step.id)).toEqual(['3'])
})

test('the window follows the active step and keeps the rows under it', async () => {
  const titles = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
  const steps = applyTodos(
    [],
    titles.map((t, i) => todo(t, i < 7 ? 'completed' : i === 7 ? 'in_progress' : 'pending')),
    0,
  )
  const rows = buildRows(steps, [{ label: 'Read a.ts' }], [{ id: 'x', label: 'explore', where: 'main' }])
  // 10 steps, the recent tools and the agent under step 8: 12 rows
  expect(rows).toHaveLength(12)
  const offset = windowOffset(rows, 7, { offset: 0, isFollowing: true })
  const shown = rows.slice(offset, offset + 7)
  expect(shown.some(row => row.kind === 'step' && row.step.title === '8')).toBe(true)
  expect(shown.some(row => row.kind === 'agent')).toBe(true)
  // Scrolled by hand, the window stays where it was put
  expect(windowOffset(rows, 7, { offset: 2, isFollowing: false })).toBe(2)
})

test('the graph does not flicker between 88 and 92 columns', async () => {
  expect(isGraphShown(false, 90)).toBe(false)
  expect(isGraphShown(false, 92)).toBe(true)
  expect(isGraphShown(true, 89)).toBe(true)
  expect(isGraphShown(true, 87)).toBe(false)
})

test('git output is read for branch, ahead count, changes and worktrees', async () => {
  const status = parseGitStatus('# branch.oid abc\n# branch.head feat/x\n# branch.ab +2 -0\n1 .M N... a.ts\n')
  expect(status).toEqual({ branch: 'feat/x', ahead: 2, isDirty: true })
  expect(parseGitStatus('# branch.head main\n')).toEqual({ branch: 'main', ahead: 0, isDirty: false })
  const trees = parseWorktrees('worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /r/.wt/a\nHEAD 2\nbranch refs/heads/agent-a\n')
  expect(trees).toEqual([
    { path: '/r', branch: 'main' },
    { path: '/r/.wt/a', branch: 'agent-a' },
  ])
})

test('times and agents read short', async () => {
  expect(formatDuration(75_000)).toBe('01:15')
  expect(formatDuration(3_725_000)).toBe('1:02:05')
  expect(agentText({ id: 'a', label: 'explore', where: 'main' })).toBe('explore · main ─ 시작 중')
  const busy = { id: 'a', label: 'explore', where: 'main', task: 'search code', doing: 'Grep render', calls: 4 }
  expect(agentText(busy)).toBe('explore · main  search code ─ Grep render (4)')
})

test('with no step, the note leads and each agent gets a row', async () => {
  const agents = ['a', 'b'].map(id => ({ id, label: id, where: 'main' }))
  const rows = buildRows([], [{ label: 'Read a.ts' }], agents, { text: '계획 세우는 중' }, [{ kind: 'read', text: '읽기 1' }])
  expect(rows.map(row => row.kind)).toEqual(['call', 'note', 'stats', 'agent', 'agent'])
})

test('the activity line names what the main loop does, as planning in plan mode', async () => {
  expect(activityText({ kind: 'waiting' }, 'plan')).toBe('계획 세우는 중')
  expect(activityText({ kind: 'thinking' }, 'default')).toBe('생각하는 중')
  expect(activityText({ kind: 'preparing', tool: 'Edit' }, 'default')).toBe('변경 내용 작성 중')
  expect(activityText({ kind: 'tool', tool: 'Edit', target: 'App.swift' }, 'default')).toBe('App.swift 수정 중')
  expect(activityText({ kind: 'tool', tool: 'Bash', target: '브랜치 만들기' }, 'default')).toBe('브랜치 만들기 실행 중')
})

test('the turn is counted by kind, with the files it changed, and each count opens its calls', async () => {
  const entry = (id: string, tool: string, file = '') => ({
    id,
    kind: callKind(tool),
    label: `${tool} ${file}`.trim(),
    file,
    detail: [],
    startedAt: 0,
    endedAt: 2000,
  })
  const log = [
    entry('1', 'Read', 'a.swift'),
    entry('2', 'Edit', 'a.swift'),
    entry('3', 'Edit', 'a.swift'),
    entry('4', 'Write', 'b.swift'),
    entry('5', 'Edit', 'c.swift'),
    entry('6', 'Bash'),
    entry('7', 'Skill'),
  ]
  expect(statParts([])).toEqual([])
  expect(statParts(log).map(part => part.text)).toEqual(['읽기 1', '수정 4', '명령 1', '스킬 1'])
  expect(filesText(log)).toBe('b.swift, c.swift +1')
  const view = detailView('kind:edit', log, [], new Map(), 5000)
  expect(view?.title).toBe('수정 4 ─ 이번 턴')
  expect(view?.lines[0]).toBe('Edit a.swift  (완료 00:02)')
  expect(detailView('call:6', [{ ...entry('6', 'Bash'), endedAt: undefined }], [], new Map(), 3000)?.title).toBe(
    'Bash ─ 실행 중 00:03',
  )
  const agents = [{ id: 'ag', label: 'explore', where: 'main', task: 'explore', calls: 2, startedAt: 0 }]
  const calls = new Map([['ag', ['Grep render', 'Read a.swift']]])
  expect(detailView('agent:ag', [], agents, calls, 65_000)).toEqual({
    title: 'explore · main · 01:05 ─ 호출 2회',
    lines: ['작업: explore', 'Grep render', 'Read a.swift'],
  })
  expect(detailView('agent:gone', [], agents, calls, 0)).toBeNull()
})

test('the shimmer peaks on one character and moves right to left', async () => {
  const peakAt = (frame: number) => shimmerColors(10, frame, 0x000000, 0xffffff).indexOf('#ffffff')
  expect(peakAt(0)).toBe(-1)
  expect(peakAt(4)).toBe(9)
  expect(peakAt(5)).toBe(8)
})

test('the timeline packs one cell per column and row', async () => {
  const steps = applyTodos([], [todo('a', 'completed'), todo('b', 'in_progress'), todo('c', 'pending')], 0)
  const rows = buildRows(steps, [], [])
  const cells = timelineCells(rows, 30, { from: 0, to: 120_000 }, 120_000, 3)
  // 30 columns x 3 rows x 3 u32 = 1080 bytes = 1440 base64 characters
  expect(cells).toHaveLength(1440)
})

test('the calls just done stay a while, oldest first, the running one left out where the line names it', async () => {
  const entry = (id: string, endedAt?: number, isError?: boolean) => ({
    id,
    kind: callKind('Bash'),
    label: 'Bash ' + id,
    file: '',
    detail: [],
    startedAt: 1000,
    endedAt,
    isError,
  })
  const log = [entry('a', 1400), entry('b', 2000, true), entry('c', 4000), entry('d')]
  expect(recentCalls(log, 2, false)).toEqual([
    { label: 'Bash b', id: 'b', status: 'error', took: 1000 },
    { label: 'Bash c', id: 'c', status: 'done', took: 3000 },
  ])
  expect(recentCalls(log, 2, true).map(call => call.status)).toEqual(['done', 'running'])
  expect(recentCalls(log, 0, true)).toEqual([])
  expect(shortDuration(400)).toBe('0.4s')
  expect(shortDuration(75_000)).toBe('01:15')
})

test('the activity graph buckets calls by two seconds and the mascot paces the width', async () => {
  const call = (id: string, at: number, tool: string) => ({
    id,
    kind: callKind(tool),
    label: tool,
    file: '',
    detail: [],
    startedAt: at,
  })
  const log = [call('a', 9_000, 'Read'), call('b', 9_500, 'Read'), call('c', 3_000, 'Bash'), call('d', 0, 'Edit')]
  const buckets = bucketCalls(log, 5, 10_000)
  // 0..10s in five buckets: the edit at 0 falls before the window
  expect(buckets.map(bucket => bucket.length)).toEqual([0, 1, 0, 0, 2])
  expect(mascotColumn(30, 0, 'idle')).toBe(Math.floor((30 - MASCOT_WIDTH) / 2))
  const columns = Array.from({ length: 200 }, (_, frame) => mascotColumn(30, frame, 'working'))
  expect(Math.min(...columns)).toBe(0)
  expect(Math.max(...columns)).toBe(30 - MASCOT_WIDTH)
  // 20 columns x 8 rows x 3 u32 = 1920 bytes = 2560 base64 characters
  expect(activityCells(log, 20, 8, 10_000, 3, 'thinking')).toHaveLength(2560)
})

test('a notification names the tasks it ended, and the line counts what still runs', async () => {
  const text = '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>' +
    '<task-notification><task-id>b2</task-id><status>failed</status></task-notification>' +
    '<task-notification><task-id>b3</task-id><status>running</status></task-notification>'
  expect(endedTasks(text)).toEqual([
    { id: 'b1', status: 'completed' },
    { id: 'b2', status: 'failed' },
  ])
  expect(endedTasks('그냥 메시지')).toEqual([])
  expect(backgroundText(1, 2)).toBe('백그라운드 에이전트 1개 · 셸 2개 작업 중')
  expect(backgroundText(0, 1)).toBe('백그라운드 셸 1개 작업 중')
})
