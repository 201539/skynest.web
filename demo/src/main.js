import { createApp } from 'vue'

async function bootstrap() {
  const params = new URLSearchParams(window.location.search)

  // The unified three-role application is the formal entry. Keep the role
  // portal delivered by the remote branch available only as a legacy demo.
  if (params.get('portal') === '1') {
    const { default: RolePortal } = await import('./RolePortal.vue')
    createApp(RolePortal).mount('#app')
    return
  }

  await import('cesium/Build/Cesium/Widgets/widgets.css')
  const { default: App } = await import('./App.vue')
  createApp(App).mount('#app')
}

bootstrap()
