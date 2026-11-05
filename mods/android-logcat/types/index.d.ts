// What the pane shows from, kept in $.state so a hot reload and /clear behave as the engine says

// The floor of the level picker
export type MinLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F'

// Whether logcat is on: the pane is open and adb runs (or is being reconnected)
export type IsOn = boolean

// A package the person named with `/logcat <package>` or picked in the pane, over the repo's remembered one,
// the option and the repo's own; `*` follows every process
export type Override = string | null

// The pane's text filter
export type Filter = string

// The pane holds its drawing while the capture goes on
export type IsPaused = boolean

// Lines from the end the pane is scrolled up by; 0 follows the newest
export type Scroll = number

// Whether a line wider than the pane continues on the rows under it; remembered across sessions in $.store
export type IsWrap = boolean

// Moves on each time the pane drops the lines region's selection
export type SelectionEpoch = number

// The values this mod keeps in $.state, by key
declare module 'claude-code' {
  interface PluginState {
    'android-logcat': {
      isOn: IsOn
      override: Override
      level: MinLevel
      filter: Filter
      isPaused: IsPaused
      scroll: Scroll
      isWrap: IsWrap
      selectionEpoch: SelectionEpoch
    }
  }
}
