const LOCATION_ALIASES = {
  实验楼: ['实验中心'],
  实验室: ['实验中心'],
  宿舍: ['学生公寓区 A', '学生公寓区 B'],
  学生宿舍: ['学生公寓区 A', '学生公寓区 B'],
  体育馆: ['方肇周体育馆'],
  南门: ['南门入口'],
  北门: ['北门广场'],
}

function normalizeLocationName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s·•・—_-]/g, '')
}

function toPlaceNode(place, index) {
  return {
    node_id: `place:${index}`,
    name: place.name,
    east_meters: Number(place.eastMeters),
    north_meters: Number(place.northMeters),
    flight_height: Number(place.height) || 80,
  }
}

function matchLocation(input, places = []) {
  const query = normalizeLocationName(input)

  if (!query) {
    return {
      status: 'missing',
      selected_node: null,
      candidates: [],
      confidence: 0,
    }
  }

  const nodes = places.map(toPlaceNode)
  const exact = nodes.find(
    (node) => normalizeLocationName(node.name) === query,
  )

  if (exact) {
    return {
      status: 'matched',
      match_method: 'exact',
      selected_node: exact,
      candidates: [exact],
      confidence: 1,
    }
  }

  const aliasNames = LOCATION_ALIASES[input?.trim()] || []
  const aliasCandidates = nodes.filter((node) =>
    aliasNames.includes(node.name),
  )

  if (aliasCandidates.length === 1) {
    return {
      status: 'matched',
      match_method: 'alias',
      selected_node: aliasCandidates[0],
      candidates: aliasCandidates,
      confidence: 0.9,
    }
  }

  if (aliasCandidates.length > 1) {
    return {
      status: 'needs_confirmation',
      match_method: 'alias',
      selected_node: null,
      candidates: aliasCandidates,
      confidence: 0.75,
    }
  }

  const partialCandidates = nodes.filter((node) => {
    const name = normalizeLocationName(node.name)
    return name.includes(query) || query.includes(name)
  })

  if (partialCandidates.length === 1) {
    return {
      status: 'needs_confirmation',
      match_method: 'partial',
      selected_node: null,
      candidates: partialCandidates,
      confidence: 0.65,
    }
  }

  return {
    status: partialCandidates.length > 1
      ? 'needs_confirmation'
      : 'not_found',
    match_method: partialCandidates.length ? 'partial' : 'none',
    selected_node: null,
    candidates: partialCandidates.slice(0, 5),
    confidence: partialCandidates.length ? 0.5 : 0,
  }
}

module.exports = {
  matchLocation,
  normalizeLocationName,
}
