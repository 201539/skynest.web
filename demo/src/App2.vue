<template> 
  <div id="cesiumContainer">
  </div>
</template>
<script setup>
import { onMounted } from "vue"
import * as Cesium from "cesium"
import Heatmap from "heatmap.js"
import TerrainProvider from "cesium/Source/Core/TerrainProvider"    
import TileAvailability from "cesium/Source/Core/TileAvailability"
window.CESIUM_BASE_URL ="/"

function parseCSVData(csvText) {
  const lines = csvText.trim().split('\n')
  const points = []
  
  // 跳过表头
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    
    const parts = line.split(',')
    if (parts.length >= 3) {
      const lng = parseFloat(parts[0])
      const lat = parseFloat(parts[1])
      const value = parseFloat(parts[2])
      
      if (!isNaN(lng) && !isNaN(lat) && !isNaN(value)) {
        points.push({ lng, lat, value })
      }
    }
  }
  
  return points
}
async function loadCSVFile(url) {
  try {
    const response = await fetch(url)
    const csvText = await response.text()
    return parseCSVData(csvText)
  } catch (error) {
    console.error('Error loading CSV:', error)
    return []
  }
}
function createHeatmap(viewer, points) {
  if (!points || points.length === 0) return null
  
  // 计算边界
  const lngs = points.map(p => p.lng)
  const lats = points.map(p => p.lat)
  const west = Math.min(...lngs)
  const east = Math.max(...lngs)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  
  // 创建 canvas
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const ctx = canvas.getContext('2d')
  
  // 计算值范围用于配色
  const values = points.map(p => p.value)
  const maxValue = Math.max(...values)
  const minValue = Math.min(...values)
  
  console.log(`热力图数据范围: ${minValue}-${maxValue}`)
  
  // 用高斯模糊绘制热力效果
  const intensityCanvas = document.createElement('canvas')
  intensityCanvas.width = canvas.width
  intensityCanvas.height = canvas.height
  const intensityCtx = intensityCanvas.getContext('2d')
  
  points.forEach(point => {
    const x = ((point.lng - west) / (east - west)) * canvas.width
    const y = ((north - point.lat) / (north - south)) * canvas.height
    // 使用对数分布处理数据，使低值也能显示
    const normalized = Math.pow((point.value - minValue) / (maxValue - minValue || 1), 0.6)
    
    // 根据值调整半径（高值更大）
    const radius = 30 + normalized * 40
    
    // 绘制圆形渐变
    const grad = intensityCtx.createRadialGradient(x, y, 0, x, y, radius)
    grad.addColorStop(0, `rgba(255,255,255,${normalized * 0.9})`)
    grad.addColorStop(0.7, `rgba(255,255,255,${normalized * 0.3})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    intensityCtx.fillStyle = grad
    intensityCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  })
  
  // 应用更强的模糊效果以显示热力分布
  ctx.filter = 'blur(25px)'
  ctx.drawImage(intensityCanvas, 0, 0)
  ctx.filter = 'none'
  
  // 应用亮度增强以突出热力
  ctx.globalCompositeOperation = 'lighten'
  ctx.drawImage(intensityCanvas, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  
  // 将强度图映射到颜色渐变
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  
  // 颜色渐变：深蓝 -> 蓝 -> 青 -> 绿 -> 黄 -> 橙 -> 红
  // 针对你的数据特点优化
  const colors = [
    [0, 10, 80],      // 深蓝
    [0, 50, 150],     // 蓝
    [0, 255, 255],    // 青
    [0, 220, 0],      // 绿
    [255, 255, 0],    // 黄
    [255, 165, 0],    // 橙
    [255, 0, 0]       // 红
  ]
  
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha > 0) {
      const t = alpha / 255
      const colorIndex = t * (colors.length - 1)
      const prevIndex = Math.floor(colorIndex)
      const nextIndex = Math.min(prevIndex + 1, colors.length - 1)
      const ratio = colorIndex - prevIndex
      
      const c1 = colors[prevIndex]
      const c2 = colors[nextIndex]
      
      data[i] = Math.round(c1[0] * (1 - ratio) + c2[0] * ratio)
      data[i + 1] = Math.round(c1[1] * (1 - ratio) + c2[1] * ratio)
      data[i + 2] = Math.round(c1[2] * (1 - ratio) + c2[2] * ratio)
      data[i + 3] = 220 // 增加透明度加强对比
    }
  }
  
  ctx.putImageData(imageData, 0, 0)
  
  // 生成有效的 data URL
  const heatmapDataURL = canvas.toDataURL('image/png')
  console.log('热力图已生成')
  
  // 创建 Cesium 图层
  const rectangle = Cesium.Rectangle.fromDegrees(west, south, east, north)
  const heatmapProvider = new Cesium.SingleTileImageryProvider({
    url: heatmapDataURL,
    rectangle: rectangle
  })
  
  const imageryLayer = viewer.imageryLayers.addImageryProvider(heatmapProvider)
  imageryLayer.alpha = 0.75  // 调整透明度以适应你的场景
  
  return imageryLayer
}

onMounted(async () => {
  Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI4MzFiMTU3Ni0yN2M5LTRmY2EtOTAyNS1jYWVhODZkOWY1M2IiLCJpZCI6MzgwMjU5LCJpYXQiOjE3Njk5MzIxNjR9.PwnlQWDCpc8Xste3mIlQ-iMQrP_tWGjn6dN4izRTFL8'
  /* const esri = new Cesium.ArcGisMapServerImageryProvider({
   url:"https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
   enablePickFeatures: false,
  }) */
  var viewer = new Cesium.Viewer('cesiumContainer',
    {
      //imageryProvider: esri,
      /* terrainProvider: 
      new Cesium.createWorldTerrain(), */
      /* new Cesium.CesiumTerrainProvider({
      url: "./terrain", })*/
      /* rectangle: Cesium.Rectangle.fromDegrees(117.9997730255127,31.99965476989746,119.00021553039551,33.00009727478027) */ })
    
  var njuposition = Cesium.Cartesian3.fromDegrees(118.956833, 32.111583, 100)
  try {
    const data = await loadCSVFile('./hotspotsdata/20250407_00.csv')
    console.log(data)
    if (data.length > 0) {
     const heatmapPrimitives = createHeatmap(viewer, data)
     console.log('热力图加载成功')
    } else {
      const sampleData = [
        { lng: 118.956833, lat: 32.111583, value: 1000 },
        { lng: 118.95, lat: 32.11, value: 500 },
        { lng: 118.96, lat: 32.12, value: 1500 },
        { lng: 118.94, lat: 32.10, value: 800 },
        { lng: 118.97, lat: 32.13, value: 2000 }
      ]
      const heatmapPrimitives = createHeatmap(viewer, sampleData)
    }
  } catch (error) {
    console.error('加载热力图数据失败:', error)
  }
  document.addEventListener('keydown',(e) => {
    if (e.key == "o"){
       viewer.camera.flyTo({
       destination: njuposition,
       orientation:{
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(10)
       }
    })
  }
    if (e.key === 'h') {
        const layers = viewer.imageryLayers
        const heatmapLayer = layers.get(1) // 假设热力图是第二个图层
        if (heatmapLayer) {
          heatmapLayer.show = !heatmapLayer.show
        }
      }
 })
  //const osmBuildings = viewer.scene.primitives.add(
   //new Cesium.createOsmBuildings()
  //)
  

  const campusmodel = viewer.entities.add({
    name: "CampusModel",
    position: Cesium.Cartesian3.fromDegrees( 118.944736, 32.107470, 0),
    model:{
      uri: "./Models/campus-model2.glb",
      scale:100,
      color:Cesium.Color.WHITE
    } 
  })
  var routePoints = [
    Cesium.Cartesian3.fromDegrees(118.950023, 32.121583, 128), // 飞行轨迹
    Cesium.Cartesian3.fromDegrees(118.950023, 32.122583, 133),
    Cesium.Cartesian3.fromDegrees(118.950023, 32.123583, 80),
    Cesium.Cartesian3.fromDegrees(118.950023, 32.124583, 128),
    Cesium.Cartesian3.fromDegrees(118.950023, 32.124583, 127)
    ];
  /* var routeLine = viewer.entities.add({
    polyline: {
        positions: routePoints,
        width: 3,
        material: Cesium.Color.GREEN
    }
  }) */
  var spline = new Cesium.CatmullRomSpline({
    times: [0, 0.25, 0.5, 0.75, 1.0],
    points: routePoints,
    firstTangent: Cesium.Cartesian3.ZERO, 
    lastTangent: Cesium.Cartesian3.ZERO
  })
  var curveEntity = viewer.entities.add({
    polyline: {
        positions: new Cesium.CallbackProperty(function(time, result) {
            // 生成曲线上的多个点用于显示
            var positions = [];
            for (var i = 0; i <= 100; i++) {
                var t = i / 100;
                positions.push(spline.evaluate(t));
            }
            return positions;
        }, false),
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.3,
            color: Cesium.Color.YELLOW
        })
    }
})

  var droneEntity = viewer.entities.add({
    name: '无人机',
    position: Cesium.Cartesian3.fromDegrees(118.950023, 32.121583, 128),
    model: {
        uri: './Models/parrot_camo_drone.glb', // 加载无人机3D模型
        minimumPixelSize: undefined
    },
    orientation: new Cesium.VelocityOrientationProperty()
})
  var startTime = Cesium.JulianDate.now()
  var flightDuration = 30
  var stopTime = Cesium.JulianDate.addSeconds(startTime, flightDuration, new Cesium.JulianDate())
  var positionProperty = new Cesium.SampledPositionProperty()
  /* for (var i = 0; i <= 100; i++) {
    var time = i / 100 * 20;
    var position = spline.evaluate(time);
    var julianTime = Cesium.JulianDate.addSeconds(
        startTime, 
        time, 
        new Cesium.JulianDate()
    );
    positionProperty.addSample(julianTime, position);
  } */
  /* for (var i = 0; i < routePoints.length; i++) {
    var time = Cesium.JulianDate.addSeconds(
        startTime, 
        (i / (routePoints.length - 1)) * 20, 
        new Cesium.JulianDate()
    )
  positionProperty.addSample(time, routePoints[i])} */
  for (var i = 0; i <= 100; i++) {
    var t = i / 100; // 归一化参数
    var time = Cesium.JulianDate.addSeconds(
        startTime, 
        t * flightDuration, 
        new Cesium.JulianDate()
    );
    var position = spline.evaluate(t);
    positionProperty.addSample(time, position);
}
  console.log(positionProperty)
  droneEntity.position = positionProperty
  droneEntity.orientation = new Cesium.VelocityOrientationProperty(positionProperty)
  viewer.clock.startTime = startTime.clone();
  viewer.clock.stopTime = stopTime.clone();
  viewer.clock.currentTime = startTime.clone();
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP; // 循环播放
  viewer.timeline.zoomTo(startTime, stopTime);
})
</script>
<style scoped> 
#cesiumContainer{
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
</style>