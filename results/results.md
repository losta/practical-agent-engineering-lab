# Lab results

> SIMULATED. The models are a deterministic simulator with assumed success rates and illustrative prices (`src/sim-model.mjs`).
> These numbers show how to measure; they say nothing about how any real model performs.

## 1. Workflow with one bounded agent step (61 synthetic invoices)

| Measure | Value |
|---|---:|
| invoices | 61 |
| postedStraightThrough | 49 |
| postedAfterBoundedStep | 7 |
| boundedStepInvocations | 10 |
| boundedStepInvalidOutputs | 1 |
| toOfficer | 5 |
| maxToolCallsUsed | 3 |

## 2. Routing policies (200 synthetic Gamtoos Assist sessions)

| Policy | Session pass rate | Turns run | Turns on small model | Cost per accepted session | Cache hit rate | Gate overrides |
|---|---:|---:|---:|---:|---:|---:|
| always-large | 97.5% | 885 | 0% | 11.353 | 77.4% | 0 |
| always-small | 47.5% | 826 | 80.4% | 8.355 | 55.1% | 162 |
| latest-message | 59% | 830 | 59.9% | 11.121 | 43.5% | 0 |
| session-aware | 96.5% | 907 | 17.2% | 10.697 | 66.7% | 0 |

## 3. Harness stop reasons (burst-pipe report)

| Scenario | Stop reason |
|---|---|
| happy path, first run | `awaiting_approval` |
| happy path, after approval | `completed` |
| approver declines | `escalated_to_person` |
| crew system down, agent retries | `repeated_failure` |
| agent asks to approve procurement | `policy_denied` |
| agent never finishes | `budget_exhausted` |
| operator cancels | `cancelled` |

Resident phone number present in the trace after the redaction hook: **no**.
