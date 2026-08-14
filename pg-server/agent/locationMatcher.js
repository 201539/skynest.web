const LOCATION_ALIASES = Object.freeze({
  图书馆: ['杜厦图书馆'],
  行政楼: ['行政南楼'],
  体育馆: ['方肇周体育馆'],
})

function normalizeLocationName(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s·•・—_-]/g, '')
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

module.exports = { LOCATION_ALIASES, normalizeLocationName, matchLocation }
