// Article 2: "Stop sending every agent task to the most expensive model".
//
// Gamtoos Assist is the citizen help service of Gamtoos Valley Municipality, a
// fictional Eastern Cape municipality. Sessions, turns and difficulties below
// are synthetic. The router chooses a model per USER TURN (the boundary the
// routing paper studies), never per tool call.

import { rng, pick } from './rng.mjs'
import { runTurn, MODELS } from './sim-model.mjs'

/** Turn types. `surface` is how hard the latest message looks; `true` is how hard it is. */
export const TURN_TYPES = {
  'office-hours':      { surface: 0.10, true: 0.10, consequence: 'low' },
  'rates-balance':     { surface: 0.35, true: 0.35, consequence: 'low' },
  'meter-reading':     { surface: 0.25, true: 0.30, consequence: 'low' },
  'identity-conflict': { surface: 0.40, true: 0.75, consequence: 'high' },
  'indigent-decline':  { surface: 0.30, true: 0.60, consequence: 'high', needsOfficial: true },
}
// A follow-up after a failed turn. Its wording looks routine; the work is not.
const RECOVERY = { surface: 0.15, true: 0.55, consequence: 'low' }

export function makeSessions(n = 200, seed = 7) {
  const r = rng(seed)
  const weights = ['office-hours', 'office-hours', 'rates-balance', 'rates-balance', 'meter-reading', 'meter-reading', 'identity-conflict', 'indigent-decline']
  return Array.from({ length: n }, (_, i) => {
    const len = 2 + Math.floor(r() * 5)
    return { id: `S${String(i + 1).padStart(3, '0')}`, turns: Array.from({ length: len }, () => pick(r, weights)) }
  })
}

/**
 * Hard gates run BEFORE any routing policy. They are not probabilistic.
 * High-consequence turns may only use a model approved for them, and turns
 * that would decline an indigent-subsidy application go to an official.
 */
export function hardGates(turn) {
  const forcedModel = turn.consequence === 'high' ? 'large' : null
  return { forcedModel, escalateToOfficial: Boolean(turn.needsOfficial) }
}

export const POLICIES = {
  'always-large': () => 'large',
  'always-small': () => 'small',
  /** Looks only at the latest message. */
  'latest-message': ({ turn }) => (turn.surface < 0.3 ? 'small' : 'large'),
  /**
   * Reads the minimum session state: did the last turn fail, is a risk flag
   * open, which model holds the cache. Escalates on recovery; steps back down
   * only after two clean, easy turns (downward switches recover cache cost
   * quickly; upward switches are a quality decision, not a saving).
   */
  'session-aware': ({ turn, state }) => {
    if (state.lastFailed || state.riskFlag) return 'large'
    if (state.current === 'large' && state.cleanEasyStreak < 2) return 'large'
    return turn.surface < 0.3 ? 'small' : 'large'
  },
}

const MAX_RECOVERY = 2

export function runPolicy(policyName, sessions) {
  const policy = POLICIES[policyName]
  const totals = { sessions: sessions.length, sessionsAccepted: 0, turns: 0, smallTurns: 0, cost: 0, cacheHits: 0, gateOverrides: 0, escalations: 0 }
  const trace = []
  for (const s of sessions) {
    const queue = s.turns.map((t) => ({ type: t, ...TURN_TYPES[t] }))
    const state = { lastFailed: false, riskFlag: false, current: null, cleanEasyStreak: 0, recoveries: 0 }
    let context = 600 // system prompt and tool definitions
    let accepted = true
    for (let i = 0; i < queue.length; i++) {
      const turn = queue[i]
      const gate = hardGates(turn)
      let model = policy({ turn, state })
      if (gate.forcedModel && model !== gate.forcedModel) { model = gate.forcedModel; totals.gateOverrides++ }
      const res = runTurn({
        turnId: `${s.id}:${i}:${turn.type}`, modelKey: model, difficulty: turn.true,
        recovering: turn.type === 'recovery', contextTokens: context, newTokens: 120, outputTokens: 220,
        previousModelKey: state.current,
      })
      totals.turns++; totals.cost += res.cost
      if (model === 'small') totals.smallTurns++
      if (res.cacheHit) totals.cacheHits++
      if (gate.escalateToOfficial) totals.escalations++
      trace.push({ session: s.id, turn: i, type: turn.type, model: MODELS[model].id, ok: res.ok, cost: res.cost, cacheHit: res.cacheHit })
      // state update
      state.current = model
      state.riskFlag = state.riskFlag || turn.consequence === 'high'
      state.lastFailed = !res.ok
      state.cleanEasyStreak = res.ok && turn.surface < 0.3 ? state.cleanEasyStreak + 1 : 0
      context += 120 + 220
      if (!res.ok) {
        if (state.recoveries < MAX_RECOVERY) { state.recoveries++; queue.splice(i + 1, 0, { type: 'recovery', ...RECOVERY }) }
        else { accepted = false; break }
      }
    }
    if (accepted) totals.sessionsAccepted++
  }
  return {
    policy: policyName,
    sessionPassRate: totals.sessionsAccepted / totals.sessions,
    turns: totals.turns,
    shareOfTurnsOnSmall: totals.smallTurns / totals.turns,
    totalCost: totals.cost,
    costPerAcceptedSession: totals.cost / Math.max(1, totals.sessionsAccepted),
    cacheHitRate: totals.cacheHits / totals.turns,
    gateOverrides: totals.gateOverrides,
    escalationsToOfficial: totals.escalations,
    trace,
  }
}
