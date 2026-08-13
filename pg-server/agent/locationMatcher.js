const LOCATION_ALIASES = Object.freeze({
  环境学院: ['理科楼群'],
  二期实验楼: ['实验中心'],
  实验楼: ['实验中心'],
  实验室: ['实验中心'],
  宿舍: ['学生公寓区 A', '学生公寓区 B'],
  学生宿舍: ['学生公寓区 A', '学生公寓区 B'],
  体育馆: ['方肇周体育馆'],
  南门: ['南门入口'],
  北门: ['北门广场'],
})

function normalizeLocationName(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s·•・—_-]/g, '')
}

function matchLocation(input, places = []) {
  const requested = String(input || '').trim()
  const query = normalizeLocationName(requested)
  if (!query) return { status: 'missing', selected_node: null, candidates: [], confidence: 0 }

  const exact = places.filter((place) => normalizeLocationName(place.name) === query || normalizeLocationName(place.nodeCode) === query)
  if (exact.length === 1) {
    return { status: 'matched', match_method: 'exact', selected_node: exact[0], candidates: exact, confidence: 1 }
  }

  const aliases = LOCATION_ALIASES[requested] || []
  const aliasCandidates = places.filter((place) =>
    aliases.includes(place.name) || (place.aliases || []).some((alias) => normalizeLocationName(alias) === query),
  )
  if (aliasCandidates.length === 1) {
    return { status: 'matched', match_method: 'alias', selected_node: aliasCandidates[0], candidates: aliasCandidates, confidence: 0.9 }
  }
  if (aliasCandidates.length > 1) {
    return { status: 'needs_confirmation', match_method: 'alias', selected_node: null, candidates: aliasCandidates.slice(0, 5), confidence: 0.72 }
  }

  const partial = places.filter((place) => {
    const name = normalizeLocationName(place.name)
    return name && (name.includes(query) || query.includes(name))
  })
  return {
    status: partial.length === 1 ? 'needs_confirmation' : partial.length > 1 ? 'needs_confirmation' : 'not_found',
    match_method: partial.length ? 'partial' : 'none',
    selected_node: null,
    candidates: partial.slice(0, 5),
    confidence: partial.length === 1 ? 0.65 : partial.length ? 0.5 : 0,
  }
}

module.exports = { LOCATION_ALIASES, normalizeLocationName, matchLocation }
