# Practical Agent Engineering lab

A small, public-safe lab that accompanies three CloudNala Insights articles:

| Article | Lab module | What it demonstrates |
|---|---|---|
| [Use a workflow until the unknown forces you to use an agent](https://cloudnala.co.za/insights/use-a-workflow-until-the-unknown-forces-an-agent) | `src/workflow.mjs` | Deterministic invoice checks, plus one bounded agent step with read-only tools, a call budget, a typed output and schema validation. The workflow, not the agent, chooses every next step. |
| [Stop sending every agent task to the most expensive model](https://cloudnala.co.za/insights/stop-sending-every-agent-task-to-the-most-expensive-model) | `src/routing.mjs` | Four routing policies on the same 200 sessions: always-large, always-small, latest-message and session-aware. Hard gates run before routing. Prompt-cache effects are counted when the model changes. |
| [You do not control the agent until you control the loop](https://cloudnala.co.za/insights/you-do-not-control-the-agent-until-you-control-the-loop) | `src/harness.mjs` | A framework-neutral loop with budgets, hooks, typed stop reasons, cancellation versus interruption for approval, a checkpoint and resume, redaction and a trace. |

## Read this first: what the numbers mean

**The models are simulated.** `src/sim-model.mjs` is a deterministic stand-in with *assumed* success rates and *illustrative* prices ("credits", with the large model priced at 10x the small one). Every result therefore follows from those assumptions. The lab shows **how to measure** a workflow, a router or a harness. It does **not** show how any real model performs. To measure real models, replace `runTurn` and the scripted policies with an adapter for your provider that keeps the same interface, then run the same scenarios.

All organisations, people, suppliers, assets, amounts and cases are fictional. Gamtoos Valley Municipality is invented for this lab.

## Run it

Requires Node.js 22 or later. There are no dependencies and nothing to install. The lab makes no network calls and costs nothing to run.

```bash
npm test     # 14 deterministic tests
npm start    # runs all three experiments, writes results/results.json and results/results.md
```

## Teardown

Delete the folder. The lab creates nothing outside `results/`.

## Stop reasons used by the harness

| Stop reason | Meaning | Resumable |
|---|---|---|
| `completed` | Goal met; result returned | No |
| `awaiting_approval` | Paused before a risky action; checkpoint returned | Yes, with an approval decision |
| `escalated_to_person` | Agent or approver handed the case back to a person | No |
| `cancelled` | Ended on request before any further action | No |
| `budget_exhausted` | Turn, tool-call, cost or time budget reached | No |
| `repeated_failure` | The same tool failed more times than allowed | No |
| `policy_denied` | The agent asked for a tool outside its authority | No |

## What this lab is not

- It is not production code. There is no persistence, identity, concurrency control or real integration.
- It is not a benchmark. To compare real models, use your own tasks, a labelled golden set and repeated runs.
- It is not tied to a framework. The harness concepts map onto frameworks such as Strands Agents (hook events `BeforeToolCallEvent` and `AfterToolCallEvent`, `stop_reason == "interrupt"` and `agent.cancel()`, per its documentation as checked on 5 November 2026), but no framework code is included.

## Licence

MIT (see `LICENSE`). Built by [CloudNala](https://cloudnala.co.za) for the Insights series [Not Every Workflow Needs an Agent](https://cloudnala.co.za/insights/series/not-every-workflow-needs-an-agent) and [Practical Agent Engineering for South Africa](https://cloudnala.co.za/insights/series/practical-agent-engineering).
