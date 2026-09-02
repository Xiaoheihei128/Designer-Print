import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import unocss from 'unocss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), unocss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // OpenPrint 设计器模块(独立命名空间, 内部 import 前缀为 @op/)
      '@op': fileURLToPath(new URL('./src/op', import.meta.url))
    },
    // CodeMirror 6 子包必须单例, 否则 instanceof 检查失败
    dedupe: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/commands',
      '@lezer/common',
      '@lezer/highlight',
      '@lezer/lr',
      '@lezer/json'
    ]
  },
  server: {
    port: 5173,
    host: true,
    // 局域网访问: 浏览器同源请求 /api → 转发到 .NET 后端
    // 前端各页面统一用相对路径 '/api/...', 局域网用户无需知道后端地址
    // 目标地址优先级: VITE_OPENPRINT_API_BASE > 默认 localhost:5000(开发约定)
    // 生产环境没有 vite proxy, 必须用 VITE_OPENPRINT_API_BASE 注入绝对 URL
    proxy: {
      '/api': {
        target: process.env.VITE_OPENPRINT_API_BASE ?? 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    // 预打包, 避免设计器内动态 import 触发二次优化导致 dev server 重启
    include: [
      'ajv',
      'fabric',
      'qrcode',
      '@bwip-js/generic',
      '@tiptap/vue-3',
      '@tiptap/starter-kit',
      '@tiptap/extension-text-style',
      '@tiptap/extension-font-family',
      'codemirror',
      'vue-codemirror6',
      '@codemirror/lang-json'
    ]
  }
})
