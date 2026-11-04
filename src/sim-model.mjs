// A deterministic stand-in for two hosted language models.
//
// This is a SIMULATOR, not a model. Its success rates and prices are
// assumptions written below, so any result the lab prints reflects these
// assumptions. The lab exists to show how to measure routing, workflow and
// harness decisions, not to report how any real model performs. Replace this
// module with a real adapter (same interface) to measure real models.

import { unit } from './rng.mjs'

/**
 * Prices are illustrative "credits" per 1,000 tokens, not any provider's
 * price list. The ratio (large is 10x small) is the assumption that matters.
 */
export const MODELS = {
  small: {
    id: 'small-model',
    inputPer1k: 0.2,
    cachedInputPer1k: 0.02,
    outputPer1k: 0.8,
    structuredOutput: true,
    approvedForHighConsequence: false,
  },
  large: {
    id: 'large-model',
    inputPer1k: 2.0,
    cachedInputPer1k: 0.2,
    outputPer1k: 8.0,
    structuredOutput: true,
    approvedForHighConsequence: true,
  },
}

/**
 * Probability that a model handles a turn acceptably.
 * `difficulty` is the turn's true difficulty in [0, 1]. A turn that must
 * recover from an earlier failure is harder for the small model than its
 * wording suggests: that is the effect session-aware routing is meant to catch.
 */
export function successProbability(modelKey, difficulty, { recovering = false } = {}) {
  const d = Math.min(1, difficulty + (recovering && modelKey === 'small' ? 0.35 : 0))
  return modelKey === 'large' ? 0.99 - 0.25 * d : 0.97 - 0.9 * d
}

/**
 * Simulate one turn on one model. Deterministic for a given turn id and model.
 * Returns success plus token accounting with prompt-cache effects.
 *
 * Cache rule (simplified): the accumulated session context is cached on the
 * model that processed the previous turn. Staying on that model bills the
 * prefix at the cached rate; switching bills the whole prefix at full rate.
 */
export function runTurn({ turnId, modelKey, difficulty, recovering, contextTokens, newTokens, outputTokens, previousModelKey }) {
  const m = MODELS[modelKey]
  const p = successProbability(modelKey, difficulty, { recovering })
  const ok = unit(`${turnId}:${modelKey}`) < p
  const cacheHit = previousModelKey === modelKey
  const prefixCost = (contextTokens / 1000) * (cacheHit ? m.cachedInputPer1k : m.inputPer1k)
  const newCost = (newTokens / 1000) * m.inputPer1k
  const outCost = (outputTokens / 1000) * m.outputPer1k
  return { ok, cost: prefixCost + newCost + outCost, cacheHit, model: m.id }
}
