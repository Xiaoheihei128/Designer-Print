import { createServer } from 'vite'
const server = await createServer({ configFile: 'vite.config.ts' })
await server.listen(5176)
console.log('JS-API 服务器已监听 5176')
// 保持运行
process.on('SIGINT', async () => { await server.close(); process.exit(0) })
