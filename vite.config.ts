import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

// UniApp + Vue3 + TypeScript 项目配置
export default defineConfig({
  plugins: [uni()],
})
