export function formatCompactNumber(value, digits = 3) {
  if (value == null || value === '') return '--'
  const number = Number(value)
  if (!Number.isFinite(number)) return '--'

  const precision = Math.max(0, Math.trunc(Number(digits) || 0))
  const fixed = number.toFixed(precision)
  return precision > 0 ? fixed.replace(/\.?0+$/, '') : fixed
}
