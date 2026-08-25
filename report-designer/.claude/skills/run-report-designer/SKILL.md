---
description: 启动 report-designer 开发服务器并做浏览器冒烟验证(含 node_modules 损坏的处理与 puppeteer 冒烟脚本)
---

# 启动 report-designer(Vite + Vue 3 开发服务器)

## 快速启动

```bash
cd d:/工作目录/260817/report-designer
npm run dev        # 监听 http://localhost:5173
```

服务器就绪标志:终端出现 `VITE v8.2.x ready in xxx ms` 和 `Local: http://localhost:5173/`。
验证:浏览器打开 http://localhost:5173 (根路径重定向到 `/templates` 模板列表页)。

### ⚠️ 图标修复(unocss presetIcons 失效)

unocss 66.8.1 的 presetIcons 在本机无法自动加载 @iconify-json/carbon(OpenPrint 原项目同样问题)。
图标由静态 CSS 提供:`node scripts/build-icons.mjs` 扫描 src/op 生成 `public/icons.css`,
已由 index.html 全局引入。新增 `i-carbon-*` 图标后需重新运行该脚本。

### ⚠️ OpenPrint 设计器需要 `npm run dev:op`(重要)

本机 vite CLI(`npm run dev`)加载配置时 **unocss 插件失效**(`virtual:uno.css` 解析 404,
表现为 `/op-designer` 页面 500);等价的 `createServer` JS-API 启动则一切正常。
因此 OpenPrint 设计器相关开发一律用:

```bash
npm run dev:op     # node dev-server.mjs, 同样监听 5173(可 --port 指定)
```

`npm run dev` 仍可用于旧页面(模板列表 / 旧设计器 / 匹配器),但打开 `/op-designer` 会 500。

## 局域网访问

- 前端 `dev:op` 已监听 `0.0.0.0`,局域网地址 = 本机 IP:5173(如 `http://192.168.0.5:5173`)
- API 走 **Vite 代理**:浏览器同源请求 `/api/*` → vite.config.ts proxy → `http://localhost:5000`
  (前端各页 + OpenPrint http-repo 均用相对路径,局域网用户无需知道后端地址、无跨域)
- 后端 `.NET` 保持 `localhost:5000` 即可(代理在服务器端转发)
- **Windows 防火墙**:需以管理员放行 5173 端口入站,否则局域网访问被拦:
  ```powershell
  # 管理员 PowerShell
  netsh advfirewall firewall add rule name="ReportDesigner 5173" dir=in action=allow protocol=TCP localport=5173
  ```

## 路由

| 路径 | 页面 |
|---|---|
| `/templates` | 模板管理(列表 + 规则配置, 接后端 CRUD) |
| `/designer` | **OpenPrint 设计器**(src/op, Fabric.js 内核; `/op-designer` 已重定向至此) |
| `/matcher` | 模板匹配引擎(接后端模板列表, 匹配结果跳转设计器) |

## 已知坑:node_modules 损坏(必读)

如果 `npm run dev` 报错 `'vite' 不是内部或外部命令`,或 `Cannot find native binding ... @rolldown/binding-win32-x64-msvc`:

```bash
# 原因: node_modules 缺少 .bin 目录和 rolldown 原生绑定(复制不完整)
rm -rf node_modules
npm install        # 完整重装(约 201 个包,需 1-2 分钟)
```

判定标准:`node_modules/.bin/vite` 是否存在;不存在即损坏。

## 冒烟验证(可选但推荐)

浏览器级冒烟测试覆盖:页面渲染、标尺布局、静态表格列头对齐、单元格数据绑定、上插行后绑定跟随、预览绑定值。

```bash
# 一次性依赖(puppeteer-core 不在项目 dependencies 中)
npm i -D puppeteer-core
node scripts/smoke.mjs        # 默认 http://localhost:5173
```

全部通过输出 `🎉 全部通过`;任一项失败输出 `❌` 并以退出码 1 结束。
注意:冒烟脚本会操作设计器画布(添加静态表格/绑定/上插行/预览),请勿在有人正在编辑时运行。

## 后端与全链路

OpenPrint 设计器默认连本机 .NET 后端(由 `report-designer/.env` 的 `VITE_OPENPRINT_API_BASE=http://localhost:5000` 控制;删除 .env 即回退本地 localStorage):

```bash
cd d:/工作目录/260817/report-designer-service/ReportDesigner.Api
dotnet run --urls http://localhost:5000
```

- 契约:OpenPrint《后端对接规范》§4.1 `/api/print/templates` CRUD,存储为 JSON 文件(`bin/Debug/.../data/templates/_index.json`)
- 额外字段 `matchRules`(匹配规则 JSON 字符串,详情/列表都返回)
- 前端同时起 `npm run dev:op`(5173)即可端到端:设计器保存 → 后端落库

旧模板迁移:
```bash
node scripts/convert-legacy-template.mjs <旧模板.json> [输出.json]
```
旧 ReportTemplate 结构 → OpenPrint TemplateData + matchRules(Label/TextField/Image/Line/Rect/Barcode/QRCode/Table 可映射;StaticTable 简化为空白表格;PageBreak 跳过)。

数据源(已接通): 后端 `GET /api/print/data-sources`(信封 `{items,total}`)提供检验报告字段目录
(Header 主表 + ReportItems[] 明细)。设计器左侧「数据源」tab 自动显示字段树,
文本控件绑定用属性面板「变量」模式填路径(如 `Header.ReportNo`);表格列字段下拉从字段树选明细字段。

模板匹配入口(已接通):
- `/matcher`:从后端拉取模板列表(含 matchRules)进行匹配;后端不可用时回退模拟数据
- 匹配结果点「使用此模板」→ 跳转 `/op-designer?id=<模板id>`,设计器自动加载该模板(页面标题显示模板名)
- 模板的 matchRules 可在后端记录中维护(`/api/print/templates` 的 matchRules 字段,JSON 数组:
  `[{"field":"Header.ReportType","operator":"Equals","value":"RawMaterial","priority":10}]`)

## 常见问题

- **预览不弹窗**:浏览器拦截了弹出窗口,设计器工具栏「预览」按钮需允许弹窗
- **端口被占用**:Vite 会自动换端口,以终端输出的 Local 为准
- **首次启动慢**:Vite 8 预构建依赖,首次访问页面约 2-3 秒
