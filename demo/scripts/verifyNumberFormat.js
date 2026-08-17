import assert from 'node:assert/strict'

let formatCompactNumber
try {
  ;({ formatCompactNumber } = await import('../src/utils/numberFormat.js'))
} catch {
  formatCompactNumber = undefined
}

assert.equal(formatCompactNumber?.(0, 0), '0')
assert.equal(formatCompactNumber?.(90, 0), '90')
assert.equal(formatCompactNumber?.(180, 0), '180')
assert.equal(formatCompactNumber?.(1.5, 3), '1.5')

console.log(JSON.stringify({ ok: true, number_format_cases: 4 }))
