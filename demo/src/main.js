import { createApp } from 'vue'

async function bootstrap() {
  const role = new URLSearchParams(window.location.search).get('role')
  if (role === 'school') {
    await import('cesium/Build/Cesium/Widgets/widgets.css')
    const { default: SchoolApp } = await import('./App.vue')
    createApp(SchoolApp).mount('#app')
    return
  }

  const { default: RolePortal } = await import('./RolePortal.vue')
  createApp(RolePortal).mount('#app')
}

bootstrap()
