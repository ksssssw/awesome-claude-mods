// Pure logic of the band: no `$`, so the tests call it directly
import type { AgentRow, Scroll, ShellRow, Step, StepStatus } from '../types'
import { t } from './i18n'

export type Todo = { content: string; status: StepStatus }

// A row of the list: a step, one recent tool call, what goes on now, the turn's counts, or one running agent
export type Row =
  | { kind: 'step'; step: Step }
  | { kind: 'call'; call: RecentItem }
  | { kind: 'agent'; agent: AgentRow }
  | { kind: 'note'; text: string; since?: number }
  | { kind: 'stats'; parts: StatPart[]; files: string }

// A recent call as the list shows it: `id` names its entry in the turn's log (absent for one stored before a
// reload), `status` how it went and `took` how long, both absent when unknown
export type RecentItem = { label: string; id?: string; status?: 'running' | 'done' | 'error'; took?: number }

// The calls a log shows as rows: the last ones, oldest first; running ones too when `withRunning`
export function recentCalls(log: readonly CallEntry[], count: number, withRunning: boolean): RecentItem[] {
  if (count <= 0) return []
  const shown = log.filter(entry => withRunning || entry.endedAt !== undefined).slice(-count)
  return shown.map(entry => ({
    label: entry.label,
    id: entry.id,
    status: entry.endedAt === undefined ? 'running' : entry.isError ? 'error' : 'done',
    took: entry.endedAt === undefined ? undefined : entry.endedAt - entry.startedAt,
  }))
}

// 400 -> 0.4s, 75000 -> 01:15: a call is mostly under a minute
export function shortDuration(ms: number): string {
  return ms < 60_000 ? `${(Math.max(0, ms) / 1000).toFixed(1)}s` : formatDuration(ms)
}

// The band's height: a header and at most seven rows of list
export const MAX_BODY_ROWS = 7
// The framed band's fixed height, borders included, when the screen has room
export const BAND_HEIGHT = 12
// At most this many agents show at once below the activity line; more scroll
export const MAX_AGENT_ROWS = 3

// How the framed band splits its fixed height: the top border, the list, the divider, the activity line,
// the turn's counts when there are any, the agents, the bottom border. The list takes what the rest leaves,
// so the band keeps its height as rows come and go
export type Layout = { height: number; listRows: number; agentRows: number; hasStats: boolean }

export function bandLayout(maxRows: number, agentCount: number, hasStats: boolean): Layout {
  const height = Math.max(6, Math.min(BAND_HEIGHT, maxRows))
  const fixed = 4 + (hasStats ? 1 : 0)
  const agentRows = Math.max(0, Math.min(agentCount, MAX_AGENT_ROWS, height - fixed - 2))
  return { height, listRows: Math.max(1, height - fixed - agentRows), agentRows, hasStats }
}

// The rows of the band's body (0 is the top border) each scrollable part takes
export function regionRows(layout: Layout): { list: [number, number]; agents: [number, number] } {
  const agentTop = 1 + layout.listRows + 2 + (layout.hasStats ? 1 : 0)
  return { list: [1, 1 + layout.listRows], agents: [agentTop, agentTop + layout.agentRows] }
}

// How many cells a string takes in the terminal: wide scripts (Hangul, CJK, full-width forms, emoji) take two
export function cellWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    width += isWide ? 2 : 1
  }
  return width
}

// Cuts a string to at most `cells` cells, an ellipsis marking the cut
export function fitCells(text: string, cells: number): string {
  if (cellWidth(text) <= cells) return text
  let out = ''
  for (const char of text) {
    if (cellWidth(out + char) > cells - 1) break
    out += char
  }
  return out + '…'
}
// The graph appears from GRAPH_ON columns and leaves under GRAPH_OFF, so it does not flicker at the edge
export const GRAPH_ON = 92
export const GRAPH_OFF = 88
// Under this width the header drops the repository name and the ahead count
export const NARROW = 60

// Moves a step to a status, stamping when it started and ended
function moveTo(step: Step, status: StepStatus, now: number): Step {
  if (step.status === status) return step
  if (status === 'in_progress') return { ...step, status, startedAt: step.startedAt ?? now, endedAt: undefined }
  if (status === 'completed') return { ...step, status, startedAt: step.startedAt ?? now, endedAt: now }
  return { ...step, status, startedAt: undefined, endedAt: undefined }
}

// TodoWrite sends the whole list each time: keep the times of the steps already known, matched by title
export function applyTodos(prev: Step[], todos: readonly Todo[], now: number): Step[] {
  const known = new Map(prev.map(step => [step.title, step]))
  return todos.map((todo, i) => {
    const before = known.get(todo.content) ?? { id: 'todo-' + i, title: todo.content, status: 'pending' as const }
    return moveTo({ ...before, id: 'todo-' + i }, todo.status, now)
  })
}

// TaskCreate adds one step; a new plan after a finished one starts the list over
export function applyTaskCreate(prev: Step[], id: string, subject: string): Step[] {
  const base = prev.length > 0 && prev.every(step => step.status === 'completed') ? [] : prev
  return [...base, { id, title: subject, status: 'pending' }]
}

export function applyTaskUpdate(
  prev: Step[],
  update: { taskId: string; subject?: string; status?: StepStatus | 'deleted' },
  now: number,
): Step[] {
  const { status } = update
  if (status === 'deleted') return prev.filter(step => step.id !== update.taskId)
  return prev.map(step => {
    if (step.id !== update.taskId) return step
    const titled = update.subject ? { ...step, title: update.subject } : step
    return status ? moveTo(titled, status, now) : titled
  })
}

export function progress(steps: readonly Step[]) {
  const done = steps.filter(step => step.status === 'completed').length
  const active = steps.findIndex(step => step.status === 'in_progress')
  return { done, total: steps.length, active, isFinished: steps.length > 0 && done === steps.length }
}

// The time the plan covers: from the first start to now, or to the last end once all are done
export function planSpan(steps: readonly Step[], now: number): { from: number; to: number } | null {
  const starts = steps.flatMap(step => (step.startedAt === undefined ? [] : [step.startedAt]))
  if (starts.length === 0) return null
  const isLive = steps.some(step => step.status !== 'completed')
  const ends = steps.flatMap(step => (step.endedAt === undefined ? [] : [step.endedAt]))
  return { from: Math.min(...starts), to: isLive || ends.length === 0 ? now : Math.max(...ends) }
}

// 75000 -> 01:15, 3725000 -> 1:02:05
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}

// `git status --porcelain=v2 --branch`: the branch, how far ahead of upstream, and any change
export function parseGitStatus(out: string): { branch: string; ahead: number; isDirty: boolean } {
  let branch = 'HEAD'
  let ahead = 0
  let isDirty = false
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim()
    else if (line.startsWith('# branch.ab ')) ahead = Number(/\+(\d+)/.exec(line)?.[1] ?? 0)
    else if (line !== '' && !line.startsWith('#')) isDirty = true
  }
  return { branch: branch === '(detached)' ? 'detached' : branch, ahead, isDirty }
}

// `git worktree list --porcelain`: each worktree's path and branch
export function parseWorktrees(out: string): { path: string; branch: string }[] {
  const list: { path: string; branch: string }[] = []
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) list.push({ path: line.slice('worktree '.length), branch: '' })
    else if (line.startsWith('branch ')) {
      const last = list[list.length - 1]
      if (last) last.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
  }
  return list
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}

// The steps in order, with the recent tools and the agents tucked under the active step;
// with no step, the note stands in for one
export function buildRows(
  steps: readonly Step[],
  recent: readonly RecentItem[],
  agents: readonly AgentRow[],
  note?: { text: string; since?: number },
  stats: StatPart[] = [],
  files = '',
): Row[] {
  const rows: Row[] = []
  // No step: the calls just done read downward into what goes on now, the counts and the agents under it
  if (steps.length === 0) {
    for (const call of recent) rows.push({ kind: 'call', call })
    if (note) rows.push({ kind: 'note', ...note })
    if (stats.length > 0) rows.push({ kind: 'stats', parts: stats, files })
    for (const agent of agents) rows.push({ kind: 'agent', agent })
    return rows
  }
  const active = steps.findIndex(step => step.status === 'in_progress')
  steps.forEach((step, i) => {
    rows.push({ kind: 'step', step })
    if (i !== active) return
    for (const call of recent) rows.push({ kind: 'call', call })
    for (const agent of agents) rows.push({ kind: 'agent', agent })
  })
  // No step is active: the agents still show, at the end
  if (active === -1) for (const agent of agents) rows.push({ kind: 'agent', agent })
  return rows
}

// The row the window keeps in view: the active step, else the first pending, else the last
export function focusRow(rows: readonly Row[]): number {
  const active = rows.findIndex(row => row.kind === 'step' && row.step.status === 'in_progress')
  if (active !== -1) {
    // Keep the rows tucked under the active step in view too
    let last = active
    while (last + 1 < rows.length && rows[last + 1]?.kind !== 'step') last += 1
    return last
  }
  const pending = rows.findIndex(row => row.kind === 'step' && row.step.status === 'pending')
  if (pending !== -1) return pending
  // No step: what goes on now and everything under it
  return rows.length - 1
}

// The first row the window shows: following, it keeps the focus row in view with one row of context above it
export function windowOffset(rows: readonly Row[], bodyRows: number, scroll: Scroll): number {
  const maxOffset = Math.max(0, rows.length - bodyRows)
  if (!scroll.isFollowing) return Math.min(Math.max(0, scroll.offset), maxOffset)
  const focus = focusRow(rows)
  const activeStep = rows.findIndex(row => row.kind === 'step' && row.step.status === 'in_progress')
  const top = Math.max(0, (activeStep === -1 ? focus : activeStep) - 1)
  const offset = focus - top + 1 > bodyRows ? focus - bodyRows + 1 : top
  return Math.min(Math.max(0, offset), maxOffset)
}

// Whether the graph shows at this width, given whether it showed last time
export function isGraphShown(wasShown: boolean, columns: number): boolean {
  return wasShown ? columns >= GRAPH_OFF : columns >= GRAPH_ON
}

// One agent as `label · where  task ─ latest call (n)`
export function agentText(agent: AgentRow): string {
  const head = `${agent.label} · ${agent.where}`
  const task = agent.task ? `  ${agent.task}` : ''
  const doing = ` ─ ${agent.doing ?? t().agentStarting}`
  const calls = agent.calls ? ` (${agent.calls})` : ''
  return head + task + doing + calls
}

// What the main loop is doing now: waiting on the model, thinking, writing, preparing a call, or running one
export type Phase =
  | { kind: 'waiting' | 'thinking' | 'writing' }
  | { kind: 'preparing'; tool: string }
  | { kind: 'tool'; tool: string; target: string }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob'])

// The phase as a sentence; plan mode words the model's own work as planning
export function activityText(phase: Phase, permission: string): string {
  const isPlan = permission === 'plan'
  switch (phase.kind) {
    case 'waiting':
      return t().waiting(isPlan)
    case 'thinking':
      return t().thinking(isPlan)
    case 'writing':
      return t().writing
    case 'preparing':
      return EDIT_TOOLS.has(phase.tool) ? t().preparingEdit : t().preparing(phase.tool)
    case 'tool': {
      const { tool, target } = phase
      if (tool === 'Read') return t().reading(target)
      if (EDIT_TOOLS.has(tool)) return t().editing(target)
      if (tool === 'Bash') return t().running(target)
      if (SEARCH_TOOLS.has(tool)) return t().searching(target)
      if (tool === 'Agent') return t().delegating(target)
      if (tool === 'WebFetch' || tool === 'WebSearch') return t().browsing(target)
      if (tool === 'ExitPlanMode') return t().awaitingApproval
      if (tool === 'AskUserQuestion') return t().awaitingAnswer
      if (tool === 'TodoWrite' || tool.startsWith('Task')) return t().updatingPlan
      return t().runningTool(tool, target)
    }
  }
}

// The kinds a turn's calls are counted by
export type CallKind = 'read' | 'edit' | 'run' | 'search' | 'skill' | 'other'

// The kinds in the order the counts list them
const KINDS: CallKind[] = ['read', 'edit', 'run', 'search', 'skill', 'other']

export function callKind(tool: string): CallKind {
  if (tool === 'Read') return 'read'
  if (EDIT_TOOLS.has(tool)) return 'edit'
  if (tool === 'Bash') return 'run'
  if (SEARCH_TOOLS.has(tool)) return 'search'
  if (tool === 'Skill') return 'skill'
  return 'other'
}

// One call of the main loop this turn: its short label, the lines its detail shows, and how it went
export type CallEntry = {
  id: string
  kind: CallKind
  label: string
  file: string
  detail: string[]
  startedAt: number
  endedAt?: number
  isError?: boolean
}

export type StatPart = { kind: CallKind; text: string }

// `read 6`, `edit 3`, ... for the kinds the turn used, in a fixed order
export function statParts(log: readonly CallEntry[]): StatPart[] {
  return KINDS.flatMap(kind => {
    const n = log.filter(entry => entry.kind === kind).length
    return n ? [{ kind, text: `${t().kinds[kind]} ${n}` }] : []
  })
}

// The files the turn changed, the last two named and the rest counted
export function filesText(log: readonly CallEntry[]): string {
  const files = [...new Set(log.filter(entry => entry.kind === 'edit' && entry.file).map(entry => entry.file))]
  const shown = files.slice(-2)
  const rest = files.length - shown.length
  return shown.length > 0 ? shown.join(', ') + (rest > 0 ? ` +${rest}` : '') : ''
}

// How a call went: running for so long, done in so long, or failed
export function callStatus(entry: CallEntry, now: number): string {
  if (entry.endedAt === undefined) return t().callRunning(formatDuration(now - entry.startedAt))
  const took = formatDuration(entry.endedAt - entry.startedAt)
  return entry.isError ? t().callFailed(took) : t().callDone(took)
}

// What the band shows in place of the list once something is pressed: a title and its lines
export function detailView(
  key: string,
  log: readonly CallEntry[],
  agents: readonly AgentRow[],
  agentCalls: ReadonlyMap<string, readonly string[]>,
  now: number,
  shells: readonly ShellRow[] = [],
): { title: string; lines: string[] } | null {
  const [what, id = ''] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  if (what === 'call') {
    const entry = log.find(item => item.id === id)
    return entry ? { title: `${entry.label} ─ ${callStatus(entry, now)}`, lines: entry.detail } : null
  }
  if (what === 'kind') {
    const entries = log.filter(item => item.kind === id)
    if (entries.length === 0) return null
    return {
      title: t().thisTurnTitle(t().kinds[id as CallKind], entries.length),
      lines: entries.map(item => `${item.label}  (${callStatus(item, now)})`),
    }
  }
  if (what === 'shell') {
    const shell = shells.find(item => item.id === id)
    if (!shell) return null
    return {
      title: t().shellTitle(formatDuration(now - shell.startedAt)),
      lines: [shell.label, '$ ' + shell.command, t().taskId(shell.id)].filter(line => line && line !== '$ '),
    }
  }
  if (what === 'agent') {
    const agent = agents.find(item => item.id === id)
    if (!agent) return null
    const age = agent.startedAt === undefined ? '' : ` · ${formatDuration(now - agent.startedAt)}`
    const calls = agentCalls.get(id) ?? []
    return {
      title: `${agent.label} · ${agent.where}${age} ─ ${t().agentTitle(agent.calls ?? calls.length)}`,
      lines: [...(agent.task ? [t().task(agent.task)] : []), ...(calls.length > 0 ? calls : [t().noCallsYet])],
    }
  }
  return null
}

// The text a shimmer draws: one run per character, its color a wave that crosses from right to left
export function shimmerColors(length: number, frame: number, base: number, peak: number): string[] {
  const span = length + 8
  const center = length + 3 - (frame % span)
  return Array.from({ length }, (_, i) => {
    const glow = Math.max(0, 1 - Math.abs(i - center) / 3)
    return '#' + mix(base, peak, glow).toString(16).padStart(6, '0')
  })
}

export function mix(a: number, b: number, t: number): number {
  const channel = (shift: number) => {
    const x = (a >> shift) & 0xff
    const y = (b >> shift) & 0xff
    return Math.round(x + (y - x) * t) << shift
  }
  return channel(16) | channel(8) | channel(0)
}

// What the activity line says once the turn is over and only background work runs
export function backgroundText(agentCount: number, shellCount: number): string {
  return t().background(agentCount, shellCount)
}

// The tasks a notification reports as ended: each <task-id> with the <status> after it
export function endedTasks(text: string): { id: string; status: string }[] {
  const ended: { id: string; status: string }[] = []
  for (const block of text.split('<task-notification>').slice(1)) {
    const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(block)?.[1]
    const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(block)?.[1] ?? 'completed'
    if (id && status !== 'running' && status !== 'pending') ended.push({ id, status })
  }
  return ended
}
