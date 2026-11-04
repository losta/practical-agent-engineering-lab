// Article 1: "Use a workflow until the unknown forces you to use an agent".
//
// Gamtoos Valley Municipality accounts payable (fictional, synthetic data).
// The workflow code chooses every next step. Exactly one step, investigating a
// purchase-order description mismatch, is delegated to a bounded agent step
// with read-only tools, a call budget and a typed output. A finance officer
// decides every exception. Nothing the bounded step returns can post a payment.

import { rng, pick, unit } from './rng.mjs'

const SUPPLIERS = ['SUP-001', 'SUP-002', 'SUP-003', 'SUP-004', 'SUP-005']
const ITEMS = [
  { code: 'PIPE-110', desc: '110mm uPVC pressure pipe, 6m', alt: 'uPVC pipe 110 x 6000' },
  { code: 'VALVE-50', desc: '50mm gate valve, cast iron', alt: 'Gate valve DN50 CI' },
  { code: 'METER-20', desc: '20mm water meter, class C', alt: 'Water meter 20mm cl. C' },
  { code: 'COLD-25', desc: 'Cold asphalt, 25kg bag', alt: 'Pothole patch mix 25kg' },
]

/** Synthetic invoices. Some carry deliberate defects. */
export function makeInvoices(n = 60, seed = 11) {
  const r = rng(seed)
  const out = []
  for (let i = 0; i < n; i++) {
    const item = pick(r, ITEMS)
    const qty = 1 + Math.floor(r() * 40)
    const unitPrice = 100 + Math.floor(r() * 900)
    const po = { number: `PO-${2400 + i}`, supplier: pick(r, SUPPLIERS), itemCode: item.code, desc: item.desc, qty, unitPrice }
    const inv = { number: `INV-${9000 + i}`, po: po.number, supplier: po.supplier, desc: item.desc, qty, unitPrice, vat: 0 }
    const roll = r()
    if (roll < 0.10) inv.desc = item.alt // same item, supplier's own wording
    else if (roll < 0.14) inv.desc = 'Plumbing materials as per quotation' // vague: nothing to match against
    else if (roll < 0.17) { inv.desc = pick(r, ITEMS.filter((x) => x.code !== item.code)).desc } // genuinely different item
    else if (roll < 0.20) inv.qty = qty + 5 // over-billing
    else if (roll < 0.22) inv.supplier = 'SUP-999' // unregistered supplier
    inv.vat = Math.round(inv.qty * inv.unitPrice * 0.15 * 100) / 100
    out.push({ invoice: inv, po })
  }
  // one duplicate invoice number
  out.push({ invoice: { ...out[3].invoice }, po: out[3].po })
  return out
}

/** Deterministic checks. Each returns null (pass) or a reason (exception). */
export const CHECKS = [
  ['supplier-registered', ({ invoice }) => (SUPPLIERS.includes(invoice.supplier) ? null : 'supplier not on register')],
  ['po-matches-supplier', ({ invoice, po }) => (invoice.supplier === po.supplier ? null : 'supplier differs from PO')],
  ['quantity-within-po', ({ invoice, po }) => (invoice.qty <= po.qty ? null : 'quantity exceeds PO')],
  ['vat-correct', ({ invoice }) => (Math.abs(invoice.vat - invoice.qty * invoice.unitPrice * 0.15) < 0.01 ? null : 'VAT does not reconcile')],
]

/**
 * The bounded agent step. In production a model would run this; here a
 * deterministic investigator stands in. What matters is the contract:
 *   - read-only tools only
 *   - at most `maxToolCalls` calls
 *   - output must validate against FINDING_SCHEMA or the step counts as unclear
 *   - the step can recommend; it cannot post, approve or edit records
 */
export const FINDING_SCHEMA = { finding: ['same-item', 'different-item', 'unclear'], evidence: 'string[]', confidence: ['high', 'low'] }

const readOnlyTools = {
  getPurchaseOrder: (ctx) => ctx.po,
  getSupplierCatalogue: (ctx) => ITEMS.find((x) => x.code === ctx.po.itemCode),
  getDeliveryNote: (ctx) => ({ po: ctx.po.number, received: ctx.po.itemCode }),
}

export function boundedInvestigation(ctx, { maxToolCalls = 3 } = {}) {
  const calls = []
  const call = (name) => {
    if (calls.length >= maxToolCalls) throw new Error('budget')
    if (!(name in readOnlyTools)) throw new Error(`tool not allowed: ${name}`)
    calls.push(name)
    return readOnlyTools[name](ctx)
  }
  try {
    call('getPurchaseOrder')
    const cat = call('getSupplierCatalogue')
    if (ctx.invoice.desc === cat.alt) return validate({ finding: 'same-item', evidence: [`catalogue alias "${cat.alt}" for ${cat.code}`], confidence: 'high' }, calls)
    const dn = call('getDeliveryNote')
    const different = ITEMS.some((x) => x.desc === ctx.invoice.desc && x.code !== dn.received)
    if (different) return validate({ finding: 'different-item', evidence: [`delivery note shows ${dn.received}`], confidence: 'high' }, calls)
    // Simulate an occasional malformed model answer to exercise validation.
    if (unit(ctx.invoice.number) < 0.3) return validate({ finding: 'probably fine' }, calls)
    return validate({ finding: 'unclear', evidence: ['no catalogue alias, delivery note inconclusive'], confidence: 'low' }, calls)
  } catch (e) {
    return { finding: 'unclear', evidence: [`step stopped: ${e.message}`], confidence: 'low', calls, valid: false }
  }
}

function validate(out, calls) {
  const valid = FINDING_SCHEMA.finding.includes(out.finding) && Array.isArray(out.evidence) && FINDING_SCHEMA.confidence.includes(out.confidence)
  return valid ? { ...out, calls, valid } : { finding: 'unclear', evidence: ['output failed schema validation'], confidence: 'low', calls, valid: false }
}

/** The whole process. The workflow, not the agent, chooses every next step. */
export function processInvoices(batch) {
  const seen = new Set()
  const results = []
  for (const item of batch) {
    const { invoice } = item
    const log = []
    if (seen.has(invoice.number)) { results.push({ invoice: invoice.number, route: 'officer', reason: 'duplicate invoice number', log }); continue }
    seen.add(invoice.number)
    const failed = CHECKS.map(([name, fn]) => [name, fn(item)]).filter(([, why]) => why)
    if (failed.length) { results.push({ invoice: invoice.number, route: 'officer', reason: failed.map(([, w]) => w).join('; '), log }); continue }
    if (invoice.desc !== item.po.desc) {
      const step = boundedInvestigation(item)
      log.push({ step: 'bounded-investigation', ...step })
      // Even a confident "same-item" is a recommendation the workflow records;
      // posting still follows the workflow's own rule.
      const route = step.finding === 'same-item' && step.confidence === 'high' ? 'post' : 'officer'
      results.push({ invoice: invoice.number, route, reason: `description mismatch: ${step.finding}`, log })
      continue
    }
    results.push({ invoice: invoice.number, route: 'post', reason: 'all checks passed', log })
  }
  return results
}

export function summarise(results) {
  const by = (k) => results.filter((r) => r.route === k).length
  const stepRuns = results.filter((r) => r.log.some((l) => l.step === 'bounded-investigation'))
  const invalid = stepRuns.filter((r) => r.log.some((l) => l.valid === false)).length
  return {
    invoices: results.length,
    postedStraightThrough: results.filter((r) => r.route === 'post' && !r.log.length).length,
    postedAfterBoundedStep: stepRuns.filter((r) => r.route === 'post').length,
    boundedStepInvocations: stepRuns.length,
    boundedStepInvalidOutputs: invalid,
    toOfficer: by('officer'),
    maxToolCallsUsed: Math.max(0, ...stepRuns.flatMap((r) => r.log.map((l) => l.calls.length))),
  }
}
