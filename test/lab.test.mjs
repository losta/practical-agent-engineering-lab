import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeInvoices, processInvoices, boundedInvestigation, summarise } from '../src/workflow.mjs'
import { makeSessions, runPolicy, hardGates, TURN_TYPES } from '../src/routing.mjs'
import { runAgent, burstPipePolicy, misbehaviour, WORLD, STOP } from '../src/harness.mjs'

// ── Workflow ────────────────────────────────────────────────────────────────
test('deterministic checks route defects to an officer, never to the agent', () => {
  const results = processInvoices(makeInvoices())
  for (const r of results.filter((x) => /supplier|quantity|duplicate|VAT/.test(x.reason))) {
    assert.equal(r.route, 'officer')
    assert.equal(r.log.length, 0, `${r.invoice} should not have reached the bounded step`)
  }
})

test('bounded step uses read-only tools within its call budget', () => {
  const [item] = makeInvoices().filter((x) => x.invoice.desc !== x.po.desc)
  const out = boundedInvestigation(item, { maxToolCalls: 3 })
  assert.ok(out.calls.length <= 3)
  assert.ok(out.calls.every((c) => ['getPurchaseOrder', 'getSupplierCatalogue', 'getDeliveryNote'].includes(c)))
})

test('bounded step that runs out of budget returns unclear, not a guess', () => {
  const [item] = makeInvoices().filter((x) => x.invoice.desc !== x.po.desc)
  const out = boundedInvestigation(item, { maxToolCalls: 1 })
  assert.equal(out.finding, 'unclear')
  assert.equal(out.valid, false)
})

test('invalid bounded-step output is never posted', () => {
  const results = processInvoices(makeInvoices())
  for (const r of results) {
    const step = r.log.find((l) => l.step === 'bounded-investigation')
    if (step && !step.valid) assert.equal(r.route, 'officer')
  }
  assert.ok(summarise(results).boundedStepInvalidOutputs > 0, 'fixture should exercise schema failure')
})

// ── Routing ─────────────────────────────────────────────────────────────────
test('hard gates force high-consequence turns onto the approved model', () => {
  assert.equal(hardGates(TURN_TYPES['identity-conflict']).forcedModel, 'large')
  assert.equal(hardGates(TURN_TYPES['indigent-decline']).escalateToOfficial, true)
  const r = runPolicy('always-small', makeSessions())
  assert.ok(r.gateOverrides > 0)
})

test('routing results are reproducible', () => {
  const a = runPolicy('session-aware', makeSessions())
  const b = runPolicy('session-aware', makeSessions())
  assert.deepEqual(a.trace, b.trace)
})

test('every policy is measured on the same sessions', () => {
  const s = makeSessions()
  const ids = ['always-large', 'always-small', 'latest-message', 'session-aware'].map((p) => new Set(runPolicy(p, s).trace.map((t) => t.session)).size)
  assert.ok(ids.every((n) => n > 0))
})

// ── Harness ─────────────────────────────────────────────────────────────────
test('risky action interrupts for approval and resumes from the checkpoint', () => {
  const first = runAgent({ policy: burstPipePolicy, world: WORLD })
  assert.equal(first.stopReason, STOP.AWAITING_APPROVAL)
  assert.equal(first.checkpoint.pending.name, 'submitWorkOrder')
  const resumed = runAgent({ policy: burstPipePolicy, world: WORLD, checkpoint: first.checkpoint, approval: { approved: true, by: 'supervisor:test' } })
  assert.equal(resumed.stopReason, STOP.COMPLETED)
  assert.match(resumed.answer, /WO-77120/)
  assert.ok(resumed.state.trace.some((e) => e.event === 'tool' && e.approvedBy === 'supervisor:test'))
})

test('declined approval returns the case to a person', () => {
  const first = runAgent({ policy: burstPipePolicy, world: WORLD })
  const r = runAgent({ policy: burstPipePolicy, world: WORLD, checkpoint: first.checkpoint, approval: { approved: false, by: 'supervisor:test' } })
  assert.equal(r.stopReason, STOP.ESCALATED)
})

test('cancellation ends the run without side effects', () => {
  const r = runAgent({ policy: burstPipePolicy, world: WORLD, signal: { aborted: true } })
  assert.equal(r.stopReason, STOP.CANCELLED)
  assert.equal(r.state.toolCalls, 0)
})

test('repeated tool failure stops the loop', () => {
  const r = runAgent({ policy: misbehaviour.retryForever, world: { ...WORLD, crewSystemDown: true } })
  assert.equal(r.stopReason, STOP.REPEATED_FAILURE)
})

test('forbidden tools are denied by policy, not by the model', () => {
  assert.equal(runAgent({ policy: misbehaviour.overreach, world: WORLD }).stopReason, STOP.POLICY_DENIED)
})

test('budgets stop an agent that never finishes', () => {
  assert.equal(runAgent({ policy: misbehaviour.wander, world: WORLD }).stopReason, STOP.BUDGET_EXHAUSTED)
})

test('redaction hook keeps resident data out of the trace', () => {
  const first = runAgent({ policy: burstPipePolicy, world: WORLD })
  assert.ok(!JSON.stringify(first.state.trace).includes('residentPhone'))
})
