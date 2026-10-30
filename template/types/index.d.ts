// How many tool calls the main conversation has made this session
export type Count = number

// The values this mod keeps in $.state, by key
declare module 'claude-code' {
  interface PluginState {
    'my-mod': {
      count: Count
    }
  }
}
