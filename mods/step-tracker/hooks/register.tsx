import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Repo, ShellRow, Step } from '../types'
import type { CallEntry, Phase, Row } from './model'
import {
  NARROW,
  bandLayout,
  cellWidth,
  fitCells,
  agentText,
  applyTaskCreate,
  applyTaskUpdate,
  applyTodos,
  basename,
  buildRows,
  formatDuration,
  activityText,
  backgroundText,
  endedTasks,
  callKind,
  detailView,
  filesText,
  recentCalls,
  shortDuration,
  shimmerColors,
  statParts,
  isGraphShown,
  parseGitStatus,
  parseWorktrees,
  planSpan,
  progress,
  windowOffset,
} from './model'
import { setLanguage, t } from './i18n'
import { activityCells, timelineCells } from './timeline'

const PLUGIN = 'step-tracker'
// Change the tag when a step's fields change: it declines what an earlier version stored
const steps = atom({ plugin: 'step-tracker', key: 'steps' } as const, [], { shape: 'steps-1' })
const repo = atom({ plugin: 'step-tracker', key: 'repo' } as const, null)
const agents = atom({ plugin: 'step-tracker', key: 'agents' } as const, [])
const shells = atom({ plugin: 'step-tracker', key: 'shells' } as const, [])
const turn = atom({ plugin: 'step-tracker', key: 'turn' } as const, { isWorking: false, startedAt: 0 })
const recent = atom({ plugin: 'step-tracker', key: 'recent' } as const, [])
const mode = atom({ plugin: 'step-tracker', key: 'mode' } as const, 'auto')
const scroll = atom({ plugin: 'step-tracker', key: 'scroll' } as const, { offset: 0, isFollowing: true })
const permission = atom({ plugin: 'step-tracker', key: 'permission' } as const, 'default')
const detail = atom({ plugin: 'step-tracker', key: 'detail' } as const, null)

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// The plan's own tools: they are the list, not a recent call under it
const PLAN_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])
const REPO_TOOLS = new Set(['Bash', 'EnterWorktree', 'ExitWorktree'])

// The frame of the spinner and the timeline's pulse, and what the timer needs to know
// without reading state eight times a second. Lost on a reload; session.start sets them again.
let frame = 0
let isAnimating = false
let isTicking = false
let wasGraphShown = false
let isRefreshing = false
// Worktrees that existed when an isolated Agent call started, by its tool_use_id
const worktreesBefore = new Map<string, Set<string>>()
// What the main loop does now and since when, the calls still running, and this turn's counts.
// Module values, read at each frame: a reload loses them until the next event sets them again
let phase: Phase = { kind: 'waiting' }
let phaseSince = 0
const inFlight = new Map<string, Phase>()
let log: CallEntry[] = []
// Each running agent's latest calls, for its detail
const agentCalls = new Map<string, string[]>()
// The activity line glows while it shows: the timer then draws eight frames a second
let isShimmering = false


// The grays a planless call fades through as it rises, newest first
const FADE = ['#a8adb5', '#8c9199', '#73787f', '#5f646a', '#4f5358', '#45484c']

// The shimmer's colors: Claude's orange, or plan mode's teal
const SHIMMER = { work: [0xb0583a, 0xffd2b8], plan: [0x3f8f86, 0xb5ece4] } as const

type $ = EngineInterface

async function git($: $, cwd: string, args: string[]) {
  try {
    const run = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })
    return run.exitCode === 0 ? run.stdout : null
  } catch {
    return null
  }
}

// Reads where the main session works; runs only on the events that can move it, never on a timer
async function refreshRepo($: $) {
  if (isRefreshing) return
  isRefreshing = true
  try {
    const cwd = await $.session.cwd()
    const dirs = await git($, cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'])
    let next: Repo | null = null
    if (dirs !== null) {
      const [top = cwd, gitDir = '', commonDir = ''] = dirs.trim().split('\n')
      const isWorktree = gitDir !== commonDir
      const status = parseGitStatus((await git($, top, ['status', '--porcelain=v2', '--branch'])) ?? '')
      next = { name: basename(isWorktree ? commonDir.replace(/\/\.git\/?$/, '') : top), ...status, isWorktree }
    }
    const before = await read($, repo)
    if (JSON.stringify(before) !== JSON.stringify(next)) await update($, repo, () => next)
  } finally {
    isRefreshing = false
  }
}

async function worktreePaths($: $): Promise<Map<string, string>> {
  const out = await git($, await $.session.cwd(), ['worktree', 'list', '--porcelain'])
  return new Map(parseWorktrees(out ?? '').map(tree => [tree.path, tree.branch]))
}

// The worktree an isolated agent got: the one that was not there when its call started
async function findNewWorktree($: $, before: Set<string>): Promise<string | null> {
  for (const [path, branch] of await worktreePaths($)) {
    if (!before.has(path)) return 'wt:' + (branch || basename(path))
  }
  return null
}

async function setAgentWhere($: $, id: string, where: string) {
  await update($, agents, list => list.map(agent => (agent.id === id ? { ...agent, where } : agent)))
}

type Call = { tool: string } & Record<string, unknown>

function toolName(e: Call): string {
  return e.tool.startsWith('mcp__') ? e.tool.split('__').slice(2).join('__') : e.tool
}

// What a call works on: the file it reads, what its command is for, the pattern it looks for
function callTarget(e: Call): string {
  const str = (key: string) => (typeof e[key] === 'string' ? (e[key] as string) : '')
  if (str('file_path')) return basename(str('file_path'))
  // A command reads better by what it is for than by its first word
  if (str('command') && str('description')) return str('description').slice(0, 40)
  if (str('command')) return str('command').trim().split(/\s+/)[0] ?? ''
  if (str('pattern')) return str('pattern').slice(0, 24)
  if (str('description')) return str('description').slice(0, 24)
  if (str('query')) return str('query').slice(0, 24)
  if (str('url')) return str('url').replace(/^https?:\/\//, '').slice(0, 24)
  return ''
}

// The lines a call's detail shows: the whole path, command, pattern or input the short label cuts
function callDetail(e: Call): string[] {
  const str = (key: string) => (typeof e[key] === 'string' ? (e[key] as string) : '')
  const firstLine = (text: string) => text.split('\n')[0] ?? ''
  if (e.tool === 'Bash') return [str('description'), '$ ' + firstLine(str('command'))].filter(line => line && line !== '$ ')
  if (str('file_path')) return [str('file_path')]
  if (str('pattern')) return [t().pattern(str('pattern')), ...(str('path') ? [t().path(str('path'))] : [])]
  if (e.tool === 'Skill') return [t().skill(str('skill')), ...(str('args') ? [t().args(firstLine(str('args')))] : [])]
  if (e.tool === 'Agent') return [`${str('subagent_type') || 'general-purpose'}: ${str('description')}`]
  const { tool: _tool, tool_use_id: _id, agentId: _agent, ...input } = e
  const json = JSON.stringify(input)
  return json && json !== '{}' ? [json.slice(0, 200)] : []
}

// A short name for a tool call: the tool and what it works on
function describeCall(e: Call): string {
  const target = callTarget(e)
  return target ? `${toolName(e)} ${target}` : toolName(e)
}

async function setPhase($: $, next: Phase) {
  if (JSON.stringify(next) === JSON.stringify(phase)) return
  phase = next
  phaseSince = await $.clock.now()
}

// The classic hooks carry the permission mode; plan mode has no event of its own
async function notePermission($: $, mode: string | undefined) {
  if (mode === undefined || mode === (await read($, permission))) return
  await update($, permission, () => mode)
}

async function setSteps($: $, change: (list: Step[]) => Step[]) {
  const before = progress(await read($, steps)).active
  await update($, steps, list => change([...list]))
  const after = await read($, steps)
  const { active } = progress(after)
  isAnimating = active !== -1 && (await read($, turn)).isWorking
  // A new step started: the window follows it again
  if (active !== before) await update($, scroll, () => ({ offset: 0, isFollowing: true }))
}

export const register: Register = (on, options) => {
  // Drawn in English unless the person picked another language in /config
  setLanguage(options.language)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'steps',
      description: t().commandDescription,
      immediate: true,
    })
    const list = await read($, steps)
    isAnimating = progress(list).active !== -1 && (await read($, turn)).isWorking
    // Eight frames a second while a step runs; once a second otherwise, for the clock in the header
    $.clock.every(125, () => {
      if (isTicking) return
      frame += 1
      if (isAnimating || isShimmering || frame % 8 === 0) $.ui.invalidate('ui.render')
    })
    void refreshRepo($)
    return next(e)
  })

  // /clear, /resume and /branch reset $.state on their own; the repository may have changed too
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    void refreshRepo($)
    return next(e)
  })

  on('command.run', { command: 'steps' }, async $ => {
    const now = await read($, mode)
    const list = await read($, steps)
    const isShowing = now === 'shown' || (now === 'auto' && (list.length > 0 || (await read($, turn)).isWorking))
    await update($, mode, () => (isShowing ? 'hidden' : 'shown'))
    // A toast, not a transcript row: the model never reads it
    $.ui.toast(isShowing ? t().hidden : t().shown)
    return {}
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await notePermission($, e.permission_mode)
    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    if (e.agent_id === undefined) await notePermission($, e.permission_mode)
    return next(e)
  })

  // Another plugin may answer the classic events above without passing them on: plan mode's own
  // reminder and its end note reach every request's attachments, whoever else hooks the classic ones
  on('prompt.attachment', { type: ['plan_mode', 'plan_mode_reentry', 'plan_mode_exit'] }, async ($, e, next) => {
    if (e.agentId === undefined) await notePermission($, e.type === 'plan_mode_exit' ? 'default' : 'plan')
    return next(e)
  })

  // A background task's notification: the shells it names have ended
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'task-notification') {
      const ended = new Set(endedTasks(e.text).map(task => task.id))
      if (ended.size > 0 && (await read($, shells)).some(shell => ended.has(shell.id))) {
        await update($, shells, list => list.filter(shell => !ended.has(shell.id)))
      }
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const startedAt = await $.clock.now()
    await update($, turn, () => ({ isWorking: true, startedAt }))
    await update($, recent, () => [])
    log = []
    inFlight.clear()
    await update($, scroll, () => ({ offset: 0, isFollowing: true }))
    // The last turn's calls are gone: a detail of one of them closes; an agent's stays
    await update($, detail, key => (key?.startsWith('agent:') ? key : null))
    await setPhase($, { kind: 'waiting' })
    isAnimating = progress(await read($, steps)).active !== -1
    void refreshRepo($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // One run of a subagent's loop is one turn: when it ends, it no longer runs
      const id = e.agentId
      await update($, agents, list => list.filter(agent => agent.id !== id))
      return next(e)
    }
    await update($, turn, now => ({ ...now, isWorking: false }))
    isAnimating = false
    // Background agents outlive the turn: keep those still running
    const tasks = await $.agent.list()
    const running = new Set(tasks.filter(a => a.status === 'running').map(a => a.id))
    await update($, agents, list => list.filter(agent => running.has(agent.id)))
    // A shell the session lists as ended is gone; one it does not list stays until its notification
    const ended = new Set(tasks.filter(a => a.status !== 'running' && a.status !== 'pending').map(a => a.id))
    if ((await read($, shells)).some(shell => ended.has(shell.id))) {
      await update($, shells, list => list.filter(shell => !ended.has(shell.id)))
    }
    void refreshRepo($)
    return next(e)
  })

  // Watching only: a hook that fails hands back what the call settled to, or lets it run
  on('tool.call', async ($, e, next) => {
    const now = await $.clock.now()
    // A subagent's call is its own: it shows on that agent's row, not in the plan
    if (e.agentId !== undefined) {
      const id = e.agentId
      const label = describeCall(e as Call)
      const list = await read($, agents)
      if (list.some(agent => agent.id === id)) {
        agentCalls.set(id, [...(agentCalls.get(id) ?? []), label].slice(-20))
        await update($, agents, rows =>
          rows.map(agent => (agent.id === id ? { ...agent, doing: label, calls: (agent.calls ?? 0) + 1 } : agent)),
        )
      }
      return next(e)
    }

    const call = e as Call
    if (e.tool === 'EnterPlanMode') await notePermission($, 'plan')
    if (!PLAN_TOOLS.has(e.tool)) {
      const label = describeCall(call)
      await update($, recent, list => [...list, label].slice(-3))
      const file = typeof call.file_path === 'string' ? basename(call.file_path) : ''
      log = [
        ...log,
        { id: e.tool_use_id, kind: callKind(e.tool), label, file, detail: callDetail(call), startedAt: now },
      ].slice(-200)
    }
    const doing: Phase = { kind: 'tool', tool: toolName(call), target: callTarget(call) }
    inFlight.set(e.tool_use_id, doing)
    await setPhase($, doing)
    if (e.tool === 'TodoWrite') await setSteps($, list => applyTodos(list, e.todos, now))
    if (e.tool === 'Agent' && e.isolation === 'worktree') {
      worktreesBefore.set(e.tool_use_id, new Set((await worktreePaths($)).keys()))
    }

    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (error) {
      const at = await $.clock.now()
      log = log.map(entry => (entry.id === e.tool_use_id ? { ...entry, endedAt: at, isError: true } : entry))
      throw error
    } finally {
      // Calls run side by side: the line names one still running, else the model's turn again
      inFlight.delete(e.tool_use_id)
      await setPhase($, [...inFlight.values()].pop() ?? { kind: 'waiting' })
    }

    const endedAt = await $.clock.now()
    const isError = ran.isError === true
    log = log.map(entry => (entry.id === e.tool_use_id ? { ...entry, endedAt, isError } : entry))
    if (e.tool === 'TaskCreate' && ran.result !== undefined && !ran.isError) {
      const task = (ran.result as { task?: { id: string; subject: string } }).task
      if (task) await setSteps($, list => applyTaskCreate(list, task.id, task.subject))
    }
    if (e.tool === 'TaskUpdate' && ran.result !== undefined && !ran.isError) {
      const at = await $.clock.now()
      await setSteps($, list => applyTaskUpdate(list, e, at))
    }
    if (e.tool === 'ExitPlanMode' && !ran.isError) await notePermission($, 'default')
    // A command sent to the background, by its call or by Ctrl+B, is a shell that outlives the turn
    const taskId = e.tool === 'Bash' && !ran.isError ? (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId : undefined
    if (taskId) {
      const command = typeof call.command === 'string' ? (call.command.split('\n')[0] ?? '') : ''
      const label = typeof call.description === 'string' && call.description ? call.description : command
      const row: ShellRow = { id: taskId, label, command, startedAt: endedAt }
      await update($, shells, list => [...list.filter(shell => shell.id !== taskId), row])
    }
    if (e.tool === 'TaskStop' && !ran.isError) {
      const stopped = typeof call.task_id === 'string' ? call.task_id : typeof call.shell_id === 'string' ? call.shell_id : ''
      if (stopped) await update($, shells, list => list.filter(shell => shell.id !== stopped))
    }
    if (e.tool === 'Agent') worktreesBefore.delete(e.tool_use_id)
    if (REPO_TOOLS.has(e.tool)) void refreshRepo($)
    return ran
  }).catch(($, e, next) => next(e))

  // Watching the main loop's model stream only to name its phase; every chunk passes as it came
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    await setPhase($, { kind: 'waiting' })
    for await (const chunk of next(e)) {
      if (chunk.kind === 'thinking') await setPhase($, { kind: 'thinking' })
      else if (chunk.kind === 'text') await setPhase($, { kind: 'writing' })
      else if (chunk.kind === 'tool') await setPhase($, { kind: 'preparing', tool: chunk.name })
      yield chunk
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    // Agents the main conversation starts, as the list shows them
    if (!('agentId' in ran) || ran.agentId === undefined || e.parentAgentId !== undefined) return ran
    // A spawn from the main loop carries its mode as the agent inherits it
    await notePermission($, e.permissionMode)
    const id = ran.agentId
    const label = (e.name ?? e.subagentType).toLowerCase()
    const before = worktreesBefore.get(e.tool_use_id)
    const current = await read($, repo)
    let where = current ? current.branch : '-'
    if (e.cwd) where = parseGitStatus((await git($, e.cwd, ['status', '--porcelain=v2', '--branch'])) ?? '').branch
    if (before) where = (await findNewWorktree($, before)) ?? 'wt:?'
    const row: AgentRow = { id, label, where, task: e.description, calls: 0, startedAt: await $.clock.now() }
    await update($, agents, list => [...list.filter(agent => agent.id !== id), row])
    // The worktree may be made just after the spawn: look once more
    if (before && where === 'wt:?') {
      $.clock.after(1500, () => {
        void findNewWorktree($, before).then(found => (found ? setAgentWhere($, id, found) : undefined))
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    isTicking = true
    try {
      const shown = await read($, mode)
      const list = await read($, steps)
      const now = await read($, turn)
      // Background agents keep the band up after the turn ends
      const isEmpty =
        list.length === 0 && !now.isWorking && (await read($, agents)).length === 0 && (await read($, shells)).length === 0
      if (shown === 'hidden' || (shown === 'auto' && isEmpty)) return next(e)

      const theirs = await next(e)
      const mine = await drawBand($, e, list, now)
      const { Box } = $.ui.resolve(e)
      return theirs ? (
        <Box flexDirection="column">
          {mine}
          {theirs}
        </Box>
      ) : (
        mine
      )
    } finally {
      isTicking = false
    }
  })
}

// Draws the band: a frame of fixed height, the header in its top border; inside, the list (the steps, or
// with none the calls just done, fading as they rise) with a graph beside it, a divider, and under it
// what goes on now, the counts and the agents
async function drawBand($: $, e: any, list: Step[], now: { isWorking: boolean; startedAt: number }) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const width: number = e.props.bodyColumns
  const at = await $.clock.now()
  const where = await read($, repo)
  const tools = await read($, recent)
  const running = await read($, agents)
  const background = await read($, shells)
  const window = await read($, scroll)
  const { done, total, isFinished } = progress(list)
  const span = planSpan(list, at)
  const elapsed = span ? span.to - span.from : now.isWorking ? at - now.startedAt : 0
  const isNarrow = width < NARROW
  const permit = await read($, permission)
  const frameColor = permit === 'plan' ? 'planMode' : 'subtle'
  const branch = where ? (where.isWorktree ? 'wt:' : '') + where.branch : ''

  // All done and the turn over: one line until the next plan
  if (isFinished && !now.isWorking && running.length === 0 && background.length === 0 && (await read($, mode)) === 'auto') {
    return (
      <Box flexDirection="row" width={width}>
        <Text dimColor>STEPS </Text>
        <Text color="success">
          {done}/{total}
        </Text>
        {where && <Text dimColor> ─ </Text>}
        {where && <Text color="suggestion">{branch}</Text>}
        <Text dimColor> ─ {formatDuration(elapsed)}</Text>
      </Box>
    )
  }

  isShimmering = false
  const inner = Math.max(10, width - 4)
  const parts = statParts(log)
  const layout = bandLayout(e.props.maxRows as number, running.length + background.length, parts.length > 0)
  const isPlanless = list.length === 0
  const stored = tools.map(label => ({ label }))
  const { listRows } = layout
  // With no step, the calls just done fill the list from the bottom, the running ones left to the activity
  // line; each new one pushes the rest up. Under a step, its last three calls, the running one too
  const rows: Row[] = isPlanless
    ? (log.length > 0 ? recentCalls(log, listRows, false) : stored.slice(-listRows)).map(call => ({ kind: 'call' as const, call }))
    : buildRows(list, log.length > 0 ? recentCalls(log, 3, true) : stored.slice(-3), [])
  const opened = await read($, detail)
  const view = opened ? detailView(opened, log, running, agentCalls, at, background) : null
  const toggle = (key: string) => update($, detail, current => (current === key ? null : key))

  // The steps' window follows the active one; the planless list sits at the bottom, against the divider
  const offset = isPlanless ? 0 : windowOffset(rows, listRows, window)
  const slice = isPlanless ? rows : rows.slice(offset, offset + listRows)

  // The graph beside the list: the steps' timeline, or with no step the turn's calls and the mascot
  wasGraphShown =
    e.surface === 'terminal' && !view && (isPlanless || span !== null) && isGraphShown(wasGraphShown, width)
  const graphWidth = wasGraphShown ? inner - Math.floor(inner * 0.6) - 2 : 0
  const listWidth = wasGraphShown ? inner - graphWidth - 2 : inner
  const percent = (await $.session.usage()).context.percent

  // A run of the frame's line: `fill` cells of ─ between what it holds
  const rule = (cells: number) => <Text color={frameColor}>{'─'.repeat(Math.max(0, cells))}</Text>
  const blank = (key: string) => (
    <Text key={key} dimColor>
      {' '}
    </Text>
  )

  // The top border holds the header: STEPS, the count, the repository; the clock and context at the right
  const right = ` ${formatDuration(elapsed)}${percent !== undefined && !isNarrow ? ` · ctx ${Math.round(percent)}%` : ''} `
  const count = total > 0 ? ` ${done}/${total}` : ''
  const room = width - cellWidth('╭─ STEPS' + count + right + '─╮') - 1
  const repoName = where && !isNarrow ? where.name + ' ' : ''
  const repoTail = where ? (where.isDirty ? '*' : '') + (!isNarrow && where.ahead > 0 ? `↑${where.ahead}` : '') : ''
  const branchShown = where ? fitCells(branch, Math.max(4, room - cellWidth(' ─ ' + repoName + repoTail))) : ''
  const showName = where !== null && cellWidth(' ─ ' + repoName + branchShown + repoTail) <= room
  const headerCells = cellWidth('╭─ STEPS' + count + (where ? ' ─ ' + (showName ? repoName : '') + branchShown + repoTail : '') + right + '─╮')
  const top = (
    <Box flexDirection="row" width={width} key="top">
      <Text color={frameColor}>╭─ </Text>
      <Text weight="bold">STEPS</Text>
      {count && <Text color={isFinished ? 'success' : 'claude'}>{count}</Text>}
      {where && <Text color={frameColor}> ─ </Text>}
      {where && showName && <Text dimColor>{repoName}</Text>}
      {where && <Text color="suggestion">{branchShown}</Text>}
      {where?.isDirty && <Text color="warning">*</Text>}
      {where && !isNarrow && where.ahead > 0 && <Text dimColor>↑{where.ahead}</Text>}
      <Text color={frameColor}> </Text>
      {rule(width - headerCells - 1)}
      <Text dimColor>{right}</Text>
      <Text color={frameColor}>─╮</Text>
    </Box>
  )

  // A section of the frame: its lines between the side bars, padded to `height` rows
  const section = (key: string, lines: any[], height: number, graph: any = null) => {
    const padded = [...lines.slice(0, height)]
    while (padded.length < height) padded.push(blank(key + '-pad-' + padded.length))
    const bars = (side: string) =>
      Array.from({ length: height }, (_, k) => (
        <Text key={`${key}-${side}-${k}`} color={frameColor}>
          {side === 'left' ? '│ ' : ' │'}
        </Text>
      ))
    return (
      <Box flexDirection="row" width={width} key={key}>
        <Box flexDirection="column" width={2}>
          {...bars('left')}
        </Box>
        <Box flexDirection="row" width={inner} columnGap={graph ? 2 : 0}>
          <Box flexDirection="column" width={graph ? listWidth : inner} overflow="hidden">
            {...padded}
          </Box>
          {graph}
        </Box>
        <Box flexDirection="column" width={2}>
          {...bars('right')}
        </Box>
      </Box>
    )
  }

  // The list: a step, or a call (✓ done, ✗ failed, the spinner while it runs), pressed open
  const listLine = (row: Row, i: number) => {
    if (row.kind === 'step') {
      const { step } = row
      const isActive = step.status === 'in_progress'
      const glyph =
        step.status === 'completed' ? '✓' : isActive ? (now.isWorking ? SPINNER[frame % SPINNER.length] : '▸') : '○'
      return (
        <Box flexDirection="row" width={listWidth} key={'row-' + step.id}>
          <Text color={isActive ? 'claude' : undefined} dimColor={!isActive}>
            {glyph + ' '}
          </Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" dimColor={step.status === 'completed'} weight={isActive ? 'semibold' : undefined}>
              {step.title}
            </Text>
          </Box>
          {isActive && step.startedAt !== undefined && <Text color="claude"> {formatDuration(at - step.startedAt)}</Text>}
        </Box>
      )
    }
    if (row.kind !== 'call') return blank('list-' + i)
    const { call } = row
    const isRunning = call.status === 'running'
    const isError = call.status === 'error'
    const glyph = isRunning ? SPINNER[frame % SPINNER.length] : isError ? '✗' : call.status ? '✓' : '·'
    const following = slice[i + 1]?.kind
    const tree = isPlanless ? '' : following === 'call' ? '├ ' : '└ '
    // Planless, the calls fade as they rise: the newest nearly full, the oldest faint; one just finished is lit
    const age = slice.length - 1 - i
    const isFresh = isPlanless && call.id !== undefined && at - (log.find(entry => entry.id === call.id)?.endedAt ?? 0) < 1500
    const fade = isPlanless && !isError ? (isFresh ? undefined : FADE[Math.min(age, FADE.length - 1)]) : undefined
    const took = isRunning || call.took === undefined ? '' : ' ' + shortDuration(call.took)
    const label = fitCells(call.label, listWidth - cellWidth(tree + '✓ ' + took) - 1)
    return (
      <Box flexDirection="row" width={listWidth} key={'call-row-' + (call.id ?? 'stored-' + i)}>
        {tree && <Text dimColor>{'  ' + tree}</Text>}
        <Text
          color={isRunning ? 'claude' : isError ? 'error' : isFresh ? 'success' : fade}
          dimColor={!isRunning && !isError && !isPlanless}
        >
          {glyph + ' '}
        </Text>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          {call.id ? (
            <Button
              key={'call-' + call.id}
              label={label}
              plain
              dimColor={!isRunning && !isPlanless}
              onPress={() => toggle('call:' + call.id)}
            >
              <Text color={fade}>{label}</Text>
            </Button>
          ) : (
            <Text color={fade} dimColor={!fade}>
              {label}
            </Text>
          )}
        </Box>
        {took && <Text color={fade} dimColor={!fade}>{took}</Text>}
      </Box>
    )
  }

  // Something pressed: its detail takes the list's place, the latest lines kept, until pressed shut
  let listLines: any[]
  if (view) {
    const shown = view.lines.slice(-Math.max(0, listRows - 1))
    const hidden = view.lines.length - shown.length
    listLines = [
      <Box flexDirection="row" width={inner} key="detail-title">
        <Button key="close-detail" label={t().close} plain onPress={() => update($, detail, () => null)} />
        <Text weight="semibold" wrap="truncate-end">
          {'  ' + fitCells(view.title + (hidden > 0 ? '  ' + t().latest(shown.length) : ''), inner - 8)}
        </Text>
      </Box>,
      ...shown.map((line, k) => (
        <Text key={'detail-' + k} wrap="truncate-end">
          {'  ' + fitCells(line, inner - 2)}
        </Text>
      )),
    ]
  } else if (rows.length === 0) {
    listLines = [
      <Text key="list-empty" dimColor>
        {t().listEmpty}
      </Text>,
    ]
  } else if (isPlanless) {
    // Against the divider: blank rows above, so a new call rises from the bottom
    listLines = [
      ...Array.from({ length: Math.max(0, listRows - slice.length) }, (_, k) => blank('rise-' + k)),
      ...slice.map(listLine),
    ]
  } else {
    listLines = slice.map(listLine)
  }

  let graph = null
  if (wasGraphShown) {
    const { Raster } = $.ui.resolve(e)
    if (isPlanless) {
      const mood = !now.isWorking ? 'idle' : phase.kind === 'thinking' || phase.kind === 'waiting' ? 'thinking' : 'working'
      isShimmering = true
      graph = (
        <Raster key="activity" columns={graphWidth} rows={listRows} cells={activityCells(log, graphWidth, listRows, at, frame, mood)} />
      )
    } else if (span) {
      const padded = [...slice]
      while (padded.length < listRows) padded.push({ kind: 'call', call: { label: '' } })
      graph = (
        <Raster key="timeline" columns={graphWidth} rows={listRows} cells={timelineCells(padded, graphWidth, span, at, frame)} />
      )
    }
  }

  const divider = (
    <Text key="divider" color={frameColor}>
      {'├' + '─'.repeat(Math.max(0, width - 2)) + '┤'}
    </Text>
  )

  // What goes on now, glowing: the main loop's phase, or the agents left running after the turn
  const note = now.isWorking
    ? { text: activityText(phase, permit), since: phaseSince as number | undefined }
    : running.length + background.length > 0
      ? { text: backgroundText(running.length, background.length), since: undefined }
      : null
  isShimmering = isShimmering || note !== null
  const [base, peak] = permit === 'plan' ? SHIMMER.plan : SHIMMER.work
  const noteSince = note?.since !== undefined && at - note.since >= 1000 ? ' ' + formatDuration(at - note.since) : ''
  const noteChars = note ? Array.from(fitCells(note.text, inner - 2 - cellWidth(noteSince))) : []
  const colors = shimmerColors(noteChars.length, frame, base, peak)
  const activity = note ? (
    <Box flexDirection="row" width={inner} key="activity">
      <Text color={permit === 'plan' ? 'planMode' : 'claude'}>{SPINNER[frame % SPINNER.length] + ' '}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">{...noteChars.map((char, k) => <Text color={colors[k]}>{char}</Text>)}</Text>
      </Box>
      {noteSince && <Text dimColor>{noteSince}</Text>}
    </Box>
  ) : (
    <Text key="activity" dimColor>
      {t().idle}
    </Text>
  )

  // The turn's counts, each pressed open, and the files it changed
  const files = filesText(log)
  const statsLine = layout.hasStats ? (
    <Box flexDirection="row" width={inner} key="stats" overflow="hidden">
      <Text dimColor>{'  ' + t().thisTurn + '  '}</Text>
      {...parts.flatMap((part, k) => [
        ...(k > 0 ? [<Text dimColor> · </Text>] : []),
        <Button key={'kind-' + part.kind} label={part.text} plain dimColor onPress={() => toggle('kind:' + part.kind)} />,
      ])}
      {files && (
        <Text dimColor wrap="truncate-end">
          {' ─ ' + files}
        </Text>
      )}
    </Box>
  ) : null

  // The background work, agents then shells, as many as fit, the rest counted on the last; each pressed open
  const workItems = [
    ...running.map(agent => ({ key: 'agent:' + agent.id, glyph: '◆', color: 'suggestion', text: agentText(agent), startedAt: agent.startedAt })),
    ...background.map(shell => ({
      key: 'shell:' + shell.id,
      glyph: '$',
      color: 'success',
      text: shell.label === shell.command || !shell.command ? shell.label : `${shell.label} ─ ${shell.command}`,
      startedAt: shell.startedAt as number | undefined,
    })),
  ]
  const agentLines = workItems.slice(0, layout.agentRows).map((item, k, shown) => {
    const isLastShown = k === shown.length - 1
    const more = isLastShown && shown.length < workItems.length ? ` +${workItems.length - shown.length}` : ''
    const age = item.startedAt !== undefined ? ' ' + formatDuration(at - item.startedAt) : ''
    const label = fitCells(item.text, inner - cellWidth('  ◆ ' + age + more) - 1)
    return (
      <Box flexDirection="row" width={inner} key={'work-' + item.key}>
        <Text color={item.color}>{'  ' + item.glyph + ' '}</Text>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Button key={'open-' + item.key.replace(':', '-')} label={label} plain onPress={() => toggle(item.key)} />
        </Box>
        <Text dimColor>
          {age}
          {more}
        </Text>
      </Box>
    )
  })

  const lower = [activity, ...(statsLine ? [statsLine] : []), ...agentLines]
  const lowerRows = 1 + (layout.hasStats ? 1 : 0) + layout.agentRows
  return (
    <Box flexDirection="column" width={width}>
      {top}
      {section('list', listLines, listRows, graph)}
      {divider}
      {section('lower', lower, lowerRows)}
      <Text key="bottom" color={frameColor}>
        {'╰' + '─'.repeat(Math.max(0, width - 2)) + '╯'}
      </Text>
    </Box>
  )
}
