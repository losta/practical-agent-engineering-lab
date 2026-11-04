// Runs all three experiments and writes results/results.json and results/results.md.
// Usage: node src/run-all.mjs   (from labs/practical-agent-engineering)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeInvoices, processInvoices, summarise } from './workflow.mjs'
import { makeSessions, runPolicy, POLICIES } from './routing.mjs'
import { runAgent, burstPipePolicy, misbehaviour, WORLD, STOP } from './harness.mjs'
import { round } from './rng.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, '..', 'results')
fs.mkdirSync(outDir, { recursive: true })

// 1. Workflow with one bounded agent step
const workflow = summarise(processInvoices(makeInvoices()))

// 2. Routing policies on the same 200 synthetic sessions
const sessions = makeSessions()
const routing = Object.keys(POLICIES).map((p) => {
  const r = runPolicy(p, sessions)
  delete r.trace
  return r
})

// 3. Harness scenarios
const first = runAgent({ policy: burstPipePolicy, world: WORLD })
const resumed = runAgent({ policy: burstPipePolicy, world: WORLD, checkpoint: first.checkpoint, approval: { approved: true, by: 'supervisor:demo' } })
const scenarios = {
  'happy path, first run': first.stopReason,
  'happy path, after approval': resumed.stopReason,
  'approver declines': runAgent({ policy: burstPipePolicy, world: WORLD, checkpoint: first.checkpoint, approval: { approved: false, by: 'supervisor:demo' } }).stopReason,
  'crew system down, agent retries': runAgent({ policy: misbehaviour.retryForever, world: { ...WORLD, crewSystemDown: true } }).stopReason,
  'agent asks to approve procurement': runAgent({ policy: misbehaviour.overreach, world: WORLD }).stopReason,
  'agent never finishes': runAgent({ policy: misbehaviour.wander, world: WORLD }).stopReason,
  'operator cancels': runAgent({ policy: burstPipePolicy, world: WORLD, signal: { aborted: true } }).stopReason,
}
const residentDataInTrace = JSON.stringify(resumed.state.trace).includes('residentPhone')

const results = { generated: 'deterministic; same output on every run', workflow, routing, harness: { scenarios, residentDataInTrace, resumedTraceEvents: resumed.state.trace.length, stopReasons: Object.values(STOP) } }
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2) + '\n')

const pct = (x) => `${round(x * 100, 1)}%`
const md = [
  '# Lab results',
  '',
  '> SIMULATED. The models are a deterministic simulator with assumed success rates and illustrative prices (`src/sim-model.mjs`).',
  '> These numbers show how to measure; they say nothing about how any real model performs.',
  '',
  '## 1. Workflow with one bounded agent step (61 synthetic invoices)',
  '',
  '| Measure | Value |', '|---|---:|',
  ...Object.entries(workflow).map(([k, v]) => `| ${k} | ${v} |`),
  '',
  '## 2. Routing policies (200 synthetic Gamtoos Assist sessions)',
  '',
  '| Policy | Session pass rate | Turns run | Turns on small model | Cost per accepted session | Cache hit rate | Gate overrides |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...routing.map((r) => `| ${r.policy} | ${pct(r.sessionPassRate)} | ${r.turns} | ${pct(r.shareOfTurnsOnSmall)} | ${round(r.costPerAcceptedSession, 3)} | ${pct(r.cacheHitRate)} | ${r.gateOverrides} |`),
  '',
  '## 3. Harness stop reasons (burst-pipe report)',
  '',
  '| Scenario | Stop reason |', '|---|---|',
  ...Object.entries(scenarios).map(([k, v]) => `| ${k} | \`${v}\` |`),
  '',
  `Resident phone number present in the trace after the redaction hook: **${residentDataInTrace ? 'yes' : 'no'}**.`,
  '',
].join('\n')
fs.writeFileSync(path.join(outDir, 'results.md'), md)
console.log(md)
