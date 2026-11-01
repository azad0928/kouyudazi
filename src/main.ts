import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// UniApp 入口：创建应用并挂载 Pinia
export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())
  return {
    app,
  }
}
