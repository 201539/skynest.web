const proj4 = require('proj4')

proj4.defs('EPSG:4490', '+proj=longlat +ellps=GRS80 +no_defs')
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs')

const wgs842cgcs = proj4('EPSG:4326', 'EPSG:4490')
const cgcs2wgs84 = proj4('EPSG:4490', 'EPSG:4326')

function wgs84ToCgcs(lng, lat) {
  const [x, y] = wgs842cgcs.forward([lng, lat])
  return { x, y }
}

function cgcsToWgs84(x, y) {
  const [lng, lat] = cgcs2wgs84.forward([x, y])
  return { lng, lat }
}

module.exports = { wgs84ToCgcs, cgcsToWgs84 }
