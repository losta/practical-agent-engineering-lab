// Article 3: "You do not control the agent until you control the loop".
//
// A framework-neutral agent loop with the production controls written out:
// budgets, hooks, typed stop reasons, cancellation versus interruption,
// checkpoints and a trace. The scenario is a burst-pipe report at Gamtoos
// Valley Municipality (fictional). The "model" is a scripted policy so that
// every control can be tested deterministically, including misbehaviour.

export const STOP = Object.freeze({
  COMPLETED: 'completed',                       // goal met, result returned
  AWAITING_APPROVAL: 'awaiting_approval',       // interrupted; resumable
  CANCELLED: 'cancelled',                       // ended on request; not resumable
  BUDGET_EXHAUSTED: 'budget_exhausted',         // turns, tool calls, time or cost
  REPEATED_FAILURE: 'repeated_failure',         // same tool kept failing
  POLICY_DENIED: 'policy_denied',               // agent asked for something it may never do
  ESCALATED: 'escalated_to_person',             // agent decided it cannot proceed
})

export const DEFAULT_BUDGET = { maxTurns: 8, maxToolCalls: 6, maxCost: 5, maxRetriesPerTool: 2, maxMillis: 30_000 }

/** Tools the agent may use, and what each costs in illustrative credits. */
export function makeTools(world) {
  return {
    classifyReport: { cost: 0.1, risky: false, run: (a) => ({ category: a.text.includes('burst') ? 'water:burst-main' : 'water:other' }) },
    lookupAsset: { cost: 0.2, risky: false, run: (a) => world.assets[a.street] ?? { error: 'asset not found' } },
    checkCrewAvailability: { cost: 0.2, risky: false, run: () => (world.crewSystemDown ? { error: 'crew system timeout' } : { crew: 'Crew 3', etaMinutes: 50 }) },
    draftWorkOrder: { cost: 0.3, risky: false, run: (a) => ({ draftId: 'WO-DRAFT-1', ...a }) },
    submitWorkOrder: { cost: 0.3, risky: true, run: (a) => ({ workOrder: 'WO-77120', from: a.draftId }) },
  }
}

/** Never available to this agent, whatever it asks for. */
export const FORBIDDEN = new Set(['approveProcurement', 'getResidentProfile', 'sendBulkSms'])

/**
 * Hooks are where policy lives. Each returns nothing (allow) or a decision.
 * beforeTool can deny or interrupt; afterTool can redact or mark a retry.
 */
export const defaultHooks = {
  beforeTool({ name }) {
    if (FORBIDDEN.has(name)) return { deny: `tool ${name} is outside this agent's authority` }
    if (name === 'submitWorkOrder') return { interrupt: 'A supervisor must approve before a work order is submitted' }
    return null
  },
  afterTool({ result }) {
    if (result && typeof result === 'object' && 'residentPhone' in result) {
      const rest = { ...result }
      delete rest.residentPhone
      return { result: rest }
    }
    return null
  },
}

/**
 * Run (or resume) the loop.
 * `policy(state)` plays the model: it returns the next requested action,
 * { tool, args } or { done, answer } or { escalate }.
 * `signal` is an AbortSignal-like { aborted } checked before every model call
 * and every tool call.
 */
export function runAgent({ policy, world, budget = DEFAULT_BUDGET, hooks = defaultHooks, checkpoint = null, approval = null, signal = { aborted: false }, now = () => 0 }) {
  const tools = makeTools(world)
  const state = checkpoint ? structuredClone(checkpoint.state) : { turn: 0, toolCalls: 0, cost: 0, failures: {}, memory: {}, trace: [] }
  const started = now()
  const t = (event, detail = {}) => state.trace.push({ turn: state.turn, event, ...detail })
  const stop = (reason, extra = {}) => {
    t('stop', { reason })
    return { stopReason: reason, state, ...extra }
  }

  // Resuming after an interrupt: apply the person's decision first.
  if (checkpoint?.pending) {
    const { name, args } = checkpoint.pending
    t('resume', { approvedBy: approval?.by ?? null, approved: Boolean(approval?.approved) })
    if (!approval?.approved) return stop(STOP.ESCALATED, { note: 'approver declined; returned to a person' })
    if (signal.aborted) return stop(STOP.CANCELLED)
    // An approved action still passes the same budget checks and hooks as any other.
    if (state.toolCalls >= budget.maxToolCalls) return stop(STOP.BUDGET_EXHAUSTED, { limit: 'tool calls' })
    if (state.cost + tools[name].cost > budget.maxCost) return stop(STOP.BUDGET_EXHAUSTED, { limit: 'cost' })
    let out = tools[name].run(args)
    state.toolCalls++; state.cost += tools[name].cost
    const post = hooks.afterTool?.({ name, args, result: out, state })
    if (post?.result) out = post.result
    state.memory[name] = out
    t('tool', { name, args, result: out, approvedBy: approval.by })
  }

  while (true) {
    if (signal.aborted) return stop(STOP.CANCELLED)
    if (state.turn >= budget.maxTurns) return stop(STOP.BUDGET_EXHAUSTED, { limit: 'turns' })
    if (now() - started > budget.maxMillis) return stop(STOP.BUDGET_EXHAUSTED, { limit: 'time' })
    state.turn++
    const action = policy(state)
    t('model', { action })

    if (action.done) return stop(STOP.COMPLETED, { answer: action.answer })
    if (action.escalate) return stop(STOP.ESCALATED, { note: action.escalate })

    const { tool: name, args = {} } = action
    if (signal.aborted) return stop(STOP.CANCELLED)

    const pre = hooks.beforeTool?.({ name, args, state })
    if (pre?.deny) { t('policy', { name, decision: 'deny', why: pre.deny }); return stop(STOP.POLICY_DENIED, { note: pre.deny }) }
    if (!tools[name]) { t('policy', { name, decision: 'deny', why: 'unknown tool' }); return stop(STOP.POLICY_DENIED, { note: `unknown tool ${name}` }) }
    if (pre?.interrupt) {
      t('interrupt', { name, args, why: pre.interrupt })
      return stop(STOP.AWAITING_APPROVAL, { checkpoint: { state: structuredClone(state), pending: { name, args } }, question: pre.interrupt })
    }
    if (state.toolCalls >= budget.maxToolCalls) return stop(STOP.BUDGET_EXHAUSTED, { limit: 'tool calls' })
    if (state.cost + tools[name].cost > budget.maxCost) return stop(STOP.BUDGET_EXHAUSTED, { limit: 'cost' })

    let result = tools[name].run(args)
    state.toolCalls++; state.cost += tools[name].cost
    const post = hooks.afterTool?.({ name, args, result, state })
    if (post?.result) result = post.result
    t('tool', { name, args, result })

    if (result?.error) {
      state.failures[name] = (state.failures[name] ?? 0) + 1
      if (state.failures[name] > budget.maxRetriesPerTool) return stop(STOP.REPEATED_FAILURE, { note: `${name}: ${result.error}` })
    } else {
      state.memory[name] = result
    }
  }
}

/** A well-behaved scripted policy for the burst-pipe case. */
export function burstPipePolicy(state) {
  const m = state.memory
  if (!m.classifyReport) return { tool: 'classifyReport', args: { text: 'Water main burst outside 14 Kraal Street, road flooding' } }
  if (!m.lookupAsset) return { tool: 'lookupAsset', args: { street: 'Kraal Street' } }
  if (!m.checkCrewAvailability) return { tool: 'checkCrewAvailability', args: {} }
  if (!m.draftWorkOrder) return { tool: 'draftWorkOrder', args: { asset: m.lookupAsset.assetId, priority: 'P1', crew: m.checkCrewAvailability.crew } }
  if (!m.submitWorkOrder) return { tool: 'submitWorkOrder', args: { draftId: m.draftWorkOrder.draftId } }
  return { done: true, answer: `Work order ${m.submitWorkOrder.workOrder} submitted for ${m.lookupAsset.assetId}` }
}

/** Misbehaving policies used by the tests and the demo. */
export const misbehaviour = {
  /** Keeps retrying the crew system forever. */
  retryForever: (state) => (state.memory.classifyReport ? { tool: 'checkCrewAvailability', args: {} } : { tool: 'classifyReport', args: { text: 'burst' } }),
  /** Tries to approve its own procurement. */
  overreach: () => ({ tool: 'approveProcurement', args: { amount: 48_000 } }),
  /** Never finishes. */
  wander: () => ({ tool: 'classifyReport', args: { text: 'burst' } }),
}

export const WORLD = { assets: { 'Kraal Street': { assetId: 'WM-0411', type: '160mm AC main', residentPhone: '+27 00 000 0000' } }, crewSystemDown: false }
