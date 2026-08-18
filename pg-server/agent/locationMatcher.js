const LOCATION_ALIASES = Object.freeze({
  图书馆: ['杜厦图书馆'],
  行政楼: ['行政南楼'],
  体育馆: ['方肇周体育馆'],
  实验楼: ['实验中心'],
})

function normalizeLocationName(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s·•・—_\-号楼]/g, '').replace(/栋宿舍/g, '宿舍')
}

function semanticLocationScore(requested, placeName) {
  const query = normalizeLocationName(requested)
  const name = normalizeLocationName(placeName)
  if (!query || !name) return 0
  const queryNumber = query.match(/\d+/)?.[0]
  const nameNumber = name.match(/\d+/)?.[0]
  const types = ['宿舍', '图书馆', '学院', '实验', '行政', '体育馆', '食堂', '教学', '中心']
  const queryTypes = types.filter((type) => query.includes(type))
  const typeMatches = queryTypes.filter((type) => name.includes(type)).length
  let score = 0
  if (queryNumber && nameNumber) score += queryNumber === nameNumber ? 0.72 : -0.6
  if (queryTypes.length) score += (typeMatches / queryTypes.length) * 0.24
  const compactQuery = query.replace(/学生|南京大学|仙林校区/g, '')
  const compactName = name.replace(/学生|南京大学|仙林校区/g, '')
  if (compactQuery === compactName) score = Math.max(score, 0.96)
  else if (compactName.includes(compactQuery) || compactQuery.includes(compactName)) score = Math.max(score, 0.84)
  return Math.max(0, Math.min(1, score))
}

function matchLocation(input, places = []) {
  const requested = String(input || '').trim()
  const query = normalizeLocationName(requested)
  if (!query) {
    return {
      status: 'missing',
      selected_building: null,
      selected_node: null,
      candidates: [],
      confidence: 0,
    }
  }

  const exact = places.filter((place) => normalizeLocationName(place.name) === query || normalizeLocationName(place.nodeCode) === query)
  if (exact.length === 1) {
    return {
      status: 'matched',
      match_method: 'exact',
      selected_building: exact[0],
      selected_node: exact[0],
      candidates: exact,
      confidence: 1,
    }
  }

  const aliases = LOCATION_ALIASES[requested] || []
  const aliasCandidates = places.filter((place) =>
    aliases.includes(place.name) || (place.aliases || []).some((alias) => normalizeLocationName(alias) === query),
  )
  if (aliasCandidates.length === 1) {
    return {
      status: 'matched',
      match_method: 'alias',
      selected_building: aliasCandidates[0],
      selected_node: aliasCandidates[0],
      candidates: aliasCandidates,
      confidence: 0.9,
    }
  }
  if (aliasCandidates.length > 1) {
    return { status: 'needs_confirmation', match_method: 'alias', selected_building: null, selected_node: null, candidates: aliasCandidates.slice(0, 5), confidence: 0.72 }
  }

  const semantic = places
    .map((place) => ({ place, score: semanticLocationScore(requested, place.name) }))
    .filter((item) => item.score >= 0.7)
    .sort((a, b) => b.score - a.score)
  if (semantic.length && semantic[0].score >= 0.9 && (!semantic[1] || semantic[0].score - semantic[1].score >= 0.08)) {
    return {
      status: 'matched', match_method: 'semantic', selected_building: semantic[0].place,
      selected_node: semantic[0].place, candidates: semantic.slice(0, 5).map((item) => item.place), confidence: semantic[0].score,
    }
  }
  if (semantic.length) {
    return {
      status: 'needs_confirmation', match_method: 'semantic', selected_building: null, selected_node: null,
      candidates: semantic.slice(0, 5).map((item) => item.place), confidence: semantic[0].score,
    }
  }

  const partial = places.filter((place) => {
    const name = normalizeLocationName(place.name)
    return name && (name.includes(query) || query.includes(name))
  })
  return {
    status: partial.length === 1 ? 'needs_confirmation' : partial.length > 1 ? 'needs_confirmation' : 'not_found',
    match_method: partial.length ? 'partial' : 'none',
    selected_building: null,
    selected_node: null,
    candidates: partial.slice(0, 5),
    confidence: partial.length === 1 ? 0.65 : partial.length ? 0.5 : 0,
  }
}

module.exports = { LOCATION_ALIASES, normalizeLocationName, semanticLocationScore, matchLocation }
