import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// 目标目录：demo/public/hotspotsdata
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const hotspotsDir = path.resolve(__dirname, '..', 'public', 'hotspotsdata')

function generateIndex() {
  try {
    if (!fs.existsSync(hotspotsDir)) {
      console.warn('hotspotsdata 目录不存在:', hotspotsDir)
      return
    }

    const files = fs.readdirSync(hotspotsDir)
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .sort()

    const indexPath = path.join(hotspotsDir, 'index.json')
    fs.writeFileSync(indexPath, JSON.stringify(files, null, 2), 'utf8')
    console.log('生成 hotspots index.json，包含', files.length, '个 csv 文件')
  } catch (err) {
    console.error('生成 index.json 失败:', err)
    process.exitCode = 1
  }
}

generateIndex()
