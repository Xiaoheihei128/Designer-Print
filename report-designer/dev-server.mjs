// 开发服务器启动器(JS-API 方式)
// 原因: 本机 `npm run dev`(vite CLI)加载配置时 unocss 插件失效(虚拟模块 404);
//       等价配置经 createServer 启动则一切正常。故用本脚本替代 CLI 启动。
// 用法: node dev-server.mjs  [--port 5173]
import { createServer } from 'vite'

const portArg = process.argv.indexOf('--port')
const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 5173

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { port, host: true },
})

await server.listen()
server.printUrls()
