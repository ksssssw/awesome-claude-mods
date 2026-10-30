export type StepStatus = 'pending' | 'in_progress' | 'completed'

// One step of Claude's plan, with the times this mod saw it start and end
export type Step = {
  id: string
  title: string
  status: StepStatus
  startedAt?: number
  endedAt?: number
}

// Where the main session works: repository, branch and its state
export type Repo = {
  name: string
  branch: string
  isDirty: boolean
  ahead: number
  isWorktree: boolean
}

// A running subagent and where it works (a branch, `wt:<branch>` or `wt:?`),
// with its task, its latest tool call and how many calls it made; rows an earlier version stored lack them
export type AgentRow = {
  id: string
  label: string
  where: string
  task?: string
  doing?: string
  calls?: number
  startedAt?: number
}

// A command the main loop runs in the background (run_in_background, or Ctrl+B): its task id, what it is for,
// the command and when it started
export type ShellRow = { id: string; label: string; command: string; startedAt: number }

export type Turn = { isWorking: boolean; startedAt: number }

// auto follows the plan; shown and hidden are what /steps forces
export type Mode = 'auto' | 'shown' | 'hidden'

// The list window: the first row shown, and whether it follows the active step
export type Scroll = { offset: number; isFollowing: boolean }

declare module 'claude-code' {
  interface PluginState {
    'step-tracker': {
      steps: Shaped<Step[]>
      repo: Repo | null
      agents: AgentRow[]
      shells: ShellRow[]
      turn: Turn
      recent: string[]
      mode: Mode
      scroll: Scroll
      // The main session's permission mode as the last classic hook carried it
      permission: string
      // What the band shows in place of the list once pressed: `call:<id>`, `kind:<kind>` or `agent:<id>`
      detail: string | null
    }
  }
}
