const COMMON_BUILDING_ALIASES = Object.freeze({
  '110报警中心/保卫处': ['110报警中心', '保卫处', '校园报警中心'],
  '仙林校区第二体育场附属体育馆': ['第二体育馆', '二体', '二体体育馆'],
  '南京大学医院': ['校医院', '南大医院'],
  '南大国际会议中心': ['国际会议中心'],
  '杜厦图书馆': ['图书馆', '杜夏图书馆'],
  '方肇周体育馆': ['体育馆', '方肇洲体育馆'],
  '常州楼（计算机科学与技术系）': ['常州楼', '计算机系', '计算机学院'],
  '扬州楼（行政北楼）': ['扬州楼', '行政北楼', '北行政楼'],
  '行政南楼': ['行政楼', '南行政楼'],
  '学生第八餐厅、第九餐厅、清真餐厅、': ['八食堂', '九食堂', '清真餐厅'],
  '学生第十食堂/教工餐厅': ['十食堂', '教工餐厅'],
  '学生第四、五、六餐厅': ['四食堂', '五食堂', '六食堂'],
})

export function normalizeBuildingSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/幢/g, '栋')
    .replace(/[\s·•・—_－\-、，,。.；;:：/\\()[\]{}（）【】《》<>]/g, '')
}

function isSubsequence(query, target) {
  let queryIndex = 0
  for (let targetIndex = 0; targetIndex < target.length && queryIndex < query.length; targetIndex += 1) {
    if (query[queryIndex] === target[targetIndex]) queryIndex += 1
  }
  return queryIndex === query.length
}

function editDistance(left, right) {
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[right.length]
}

function minimumWindowDistance(query, target) {
  if (target.length <= query.length + 1) return editDistance(query, target)
  let best = Infinity
  for (const windowLength of [query.length - 1, query.length, query.length + 1]) {
    if (windowLength < 1 || windowLength > target.length) continue
    for (let index = 0; index <= target.length - windowLength; index += 1) {
      best = Math.min(best, editDistance(query, target.slice(index, index + windowLength)))
      if (best === 0) return 0
    }
  }
  return best
}

function scoreTerm(query, term) {
  if (term === query) return 0
  if (term.startsWith(query)) return 10 + Math.min(term.length - query.length, 9) / 10
  const includedAt = term.indexOf(query)
  if (includedAt >= 0) return 20 + includedAt / 10
  if (query.length >= 2 && isSubsequence(query, term)) return 30 + Math.min(term.length - query.length, 20) / 10
  const allowedDistance = query.length >= 6 ? 2 : query.length >= 3 ? 1 : 0
  if (allowedDistance) {
    const distance = minimumWindowDistance(query, term)
    if (distance <= allowedDistance) return 40 + distance
  }
  return Infinity
}

function buildingTerms(building) {
  const aliases = [
    ...(COMMON_BUILDING_ALIASES[building.building_name] || []),
    ...(Array.isArray(building.aliases) ? building.aliases : []),
  ]
  return [building.building_name, ...aliases]
    .map(normalizeBuildingSearchText)
    .filter(Boolean)
}

export function findExactBuilding(buildings, value) {
  const query = normalizeBuildingSearchText(value)
  if (!query) return null
  return buildings.find((building) => normalizeBuildingSearchText(building.building_name) === query) || null
}

export function rankBuildings(buildings, value) {
  const query = normalizeBuildingSearchText(value)
  return buildings
    .map((building) => ({
      building,
      score: query
        ? Math.min(...buildingTerms(building).map((term) => scoreTerm(query, term)))
        : 0,
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score || left.building.building_name.localeCompare(right.building.building_name, 'zh-CN'))
    .map((item) => item.building)
}
