// Every word the band draws, in each language the `language` option offers
export type Language = 'en' | 'ko'

export type Kind = 'read' | 'edit' | 'run' | 'search' | 'skill' | 'other'

export type Strings = {
  agentStarting: string
  waiting: (isPlan: boolean) => string
  thinking: (isPlan: boolean) => string
  writing: string
  preparingEdit: string
  preparing: (tool: string) => string
  reading: (target: string) => string
  editing: (target: string) => string
  running: (target: string) => string
  searching: (target: string) => string
  delegating: (target: string) => string
  browsing: (target: string) => string
  awaitingApproval: string
  awaitingAnswer: string
  updatingPlan: string
  runningTool: (tool: string, target: string) => string
  kinds: Record<Kind, string>
  callRunning: (took: string) => string
  callFailed: (took: string) => string
  callDone: (took: string) => string
  thisTurnTitle: (kind: string, count: number) => string
  shellTitle: (took: string) => string
  taskId: (id: string) => string
  agentTitle: (calls: number) => string
  task: (task: string) => string
  noCallsYet: string
  background: (agents: number, shells: number) => string
  pattern: (pattern: string) => string
  path: (path: string) => string
  skill: (name: string) => string
  args: (args: string) => string
  commandDescription: string
  hidden: string
  shown: string
  close: string
  latest: (count: number) => string
  listEmpty: string
  idle: string
  thisTurn: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const EN: Strings = {
  agentStarting: 'starting',
  waiting: isPlan => (isPlan ? 'Planning' : 'Waiting for the model'),
  thinking: isPlan => (isPlan ? 'Thinking through the plan' : 'Thinking'),
  writing: 'Writing the answer',
  preparingEdit: 'Writing a change',
  preparing: tool => `Preparing ${tool}`,
  reading: target => `Reading ${target}`,
  editing: target => `Editing ${target}`,
  running: target => `Running: ${target}`,
  searching: target => `Searching for '${target}'`,
  delegating: target => `Handing off to an agent: ${target}`,
  browsing: target => `Searching the web: ${target}`,
  awaitingApproval: 'Waiting for plan approval',
  awaitingAnswer: 'Waiting for your answer',
  updatingPlan: 'Updating the plan',
  runningTool: (tool, target) => (target ? `Running ${tool}: ${target}` : `Running ${tool}`),
  kinds: { read: 'read', edit: 'edit', run: 'run', search: 'search', skill: 'skill', other: 'other' },
  callRunning: took => `running ${took}`,
  callFailed: took => `failed ${took}`,
  callDone: took => `done ${took}`,
  thisTurnTitle: (kind, count) => `${kind} ${count} ─ this turn`,
  shellTitle: took => `Background shell ─ running ${took}`,
  taskId: id => `Task ID: ${id}`,
  agentTitle: calls => plural(calls, 'call', 'calls'),
  task: task => `Task: ${task}`,
  noCallsYet: 'No tool calls yet',
  background: (agents, shells) =>
    `Background: ${[agents ? plural(agents, 'agent', 'agents') : '', shells ? plural(shells, 'shell', 'shells') : '']
      .filter(Boolean)
      .join(' · ')} running`,
  pattern: pattern => `Pattern: ${pattern}`,
  path: path => `Path: ${path}`,
  skill: name => `Skill: ${name}`,
  args: args => `Arguments: ${args}`,
  commandDescription: 'Show or hide the step-tracker band',
  hidden: 'step-tracker hidden (/steps shows it again)',
  shown: 'step-tracker shown',
  close: '‹ Close',
  latest: count => `(latest ${count})`,
  listEmpty: "This turn's calls collect here",
  idle: '· Idle',
  thisTurn: 'This turn',
}

const KO: Strings = {
  agentStarting: '시작 중',
  waiting: isPlan => (isPlan ? '계획 세우는 중' : '응답 기다리는 중'),
  thinking: isPlan => (isPlan ? '계획 구상 중' : '생각하는 중'),
  writing: '답변 쓰는 중',
  preparingEdit: '변경 내용 작성 중',
  preparing: tool => `${tool} 호출 준비 중`,
  reading: target => `${target} 읽는 중`,
  editing: target => `${target} 수정 중`,
  running: target => `${target} 실행 중`,
  searching: target => `'${target}' 찾는 중`,
  delegating: target => `에이전트에 맡기는 중: ${target}`,
  browsing: target => `웹에서 찾는 중: ${target}`,
  awaitingApproval: '계획 승인 기다리는 중',
  awaitingAnswer: '답변 기다리는 중',
  updatingPlan: '단계 목록 정리 중',
  runningTool: (tool, target) => (target ? `${tool} 실행 중: ${target}` : `${tool} 실행 중`),
  kinds: { read: '읽기', edit: '수정', run: '명령', search: '검색', skill: '스킬', other: '기타' },
  callRunning: took => `실행 중 ${took}`,
  callFailed: took => `오류 ${took}`,
  callDone: took => `완료 ${took}`,
  thisTurnTitle: (kind, count) => `${kind} ${count} ─ 이번 턴`,
  shellTitle: took => `백그라운드 셸 ─ 실행 중 ${took}`,
  taskId: id => `작업 ID: ${id}`,
  agentTitle: calls => `호출 ${calls}회`,
  task: task => `작업: ${task}`,
  noCallsYet: '아직 도구 호출 없음',
  background: (agents, shells) =>
    `백그라운드 ${[agents ? `에이전트 ${agents}개` : '', shells ? `셸 ${shells}개` : ''].filter(Boolean).join(' · ')} 작업 중`,
  pattern: pattern => `패턴: ${pattern}`,
  path: path => `위치: ${path}`,
  skill: name => `스킬: ${name}`,
  args: args => `인자: ${args}`,
  commandDescription: 'step-tracker band 표시/숨김 전환',
  hidden: 'step-tracker 숨김 (/steps로 다시 표시)',
  shown: 'step-tracker 표시',
  close: '‹ 닫기',
  latest: count => `(최근 ${count}개)`,
  listEmpty: '이번 턴의 호출이 여기에 쌓입니다',
  idle: '· 대기 중',
  thisTurn: '이번 턴',
}

const TABLES: Record<Language, Strings> = { en: EN, ko: KO }

// The language the module draws in, set once from the plugin's options as it registers;
// the pure functions read it here so their callers need not pass it along
let current: Strings = EN

export function setLanguage(language: unknown) {
  current = TABLES[language === 'ko' ? 'ko' : 'en']
}

export function t(): Strings {
  return current
}
