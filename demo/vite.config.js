import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // 核心：强制 Vite 绕过 exports 检查，直接映射真实文件路径
    alias: {
      'cesium/Source': fileURLToPath(new URL('./node_modules/cesium/Source', import.meta.url)),
      'cesium/Build': fileURLToPath(new URL('./node_modules/cesium/Build', import.meta.url))
    },
    // 关键：禁用 Vite 7.x 的严格 exports 检查，兼容旧版 AMD 模块
    conditions: ['import', 'module', 'browser', 'development'],
    mainFields: ['module', 'main']
  },
  server: {
    fs: {
      // 允许 Vite 访问项目根目录和 node_modules，彻底解决 403
      allow: ['.', 'node_modules']
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    // 禁止 Vite 预构建 Cesium，避免破坏源码目录结构
    exclude: ['cesium']
  },
  // 关键：禁用 Vite 7.x 的严格模块解析，兼容旧版包结构
  ssr: {
    noExternal: ['cesium']
  }
})