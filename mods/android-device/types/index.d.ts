// What the pane draws from, kept in $.state so a hot reload keeps the device, the pending install and the questions

// Whether the pane is on: open, polling adb, its tools described to the model
export type IsOn = boolean

// The serial of the chosen device; empty while none is chosen
export type Serial = string

// A package the person named with `/adb package <name>`, over the option and the repo's own
export type Override = string | null

// Why an install failed and what the retry would add
export type Retry = 'downgrade' | 'test-only' | 'reinstall' | 'same'
export type Failure = { code: string; message: string; retry: Retry }

// An APK waiting in the Install block: dropped, named, picked or asked for by a tool
export type Pending = { path: string; flags: string[]; failure?: Failure } | null

// The last install that succeeded, as read back from the device
export type LastInstall = {
  file: string
  package: string
  versionName?: string
  versionCode?: number
  serial: string
  model?: string
  ms: number
  at: number
} | null

// Which list the pane has unfolded for a digit to pick from
export type Pick = 'none' | 'device' | 'apk'

// A question that must be answered before the action runs
export type Confirm = { kind: 'uninstall' | 'clear' } | null

// A screen recording in progress on the device
export type Recording = { startedAt: number; remote: string; local: string; serial: string } | null

// The values this mod keeps in $.state, by key
declare module 'claude-code' {
  interface PluginState {
    'android-device': {
      isOn: IsOn
      serial: Serial
      override: Override
      pending: Pending
      last: LastInstall
      pick: Pick
      confirm: Confirm
      recording: Recording
    }
  }
}
