import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 管理后台部署在 admin.shadowshub.xyz 根路径（独立子域，base 固定 /）
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: { port: 5174, host: true },
  build: { outDir: 'dist', target: 'es2020' },
})