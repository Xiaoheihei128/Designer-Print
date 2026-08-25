<!--
  OpenPrint 设计器壳组件
  将 OpenPrint(src/op) 三栏设计器挂载为独立页面:
  - 复用 OpenPrint 的 TopToolbar / LeftPanel / RightPanel / CanvasStage
  - 仅当配置 VITE_OPENPRINT_API_BASE 时才切云端模板仓库, 否则全本地 localStorage
  - 本组件懒加载(路由 defineAsyncComponent), naive-ui/fabric 等依赖自动进独立 chunk
-->
<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import 'virtual:uno.css'
import '@op/assets/main.css'
import '@op/theme/brand.css'
import {
  NConfigProvider,
  NDialogProvider,
  NGlobalStyle,
  NMessageProvider,
  darkTheme,
  zhCN,
  dateZhCN,
} from 'naive-ui'
import TopToolbar from '@op/design/toolbar/TopToolbar.vue'
import LeftPanel from '@op/design/panels/LeftPanel.vue'
import RightPanel from '@op/design/panels/RightPanel.vue'
import CanvasStage from '@op/design/canvas/CanvasStage.vue'
import SignaturePadModal from '@op/design/panels/SignaturePadModal.vue'
import { useUiStore } from '@op/design/stores/ui'
import { darkThemeOverrides, lightThemeOverrides, svipThemeOverrides } from '@op/theme/naive-theme'
import { getBackendConfig } from '@op/config/backend'
import { createHttpRepository } from '@op/repository/http-repo'
import { useDesignerStore } from '@op/design/stores/designer'

const route = useRoute()
const uiStore = useUiStore()
const designerStore = useDesignerStore()

// 后端衔接: 仅当配置了 VITE_OPENPRINT_API_BASE 才切云端模板仓库
const backend = getBackendConfig()
if (backend) {
  designerStore.setRepository(createHttpRepository(backend.options), 'cloud')
}

// 等待画布内核就绪(CanvasStage 初始化完成后 designer 非 null)
function waitDesignerReady(timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      // setup store 中暴露的 shallowRef 已被解包, designer 为 CanvasDesigner | null
      if ((designerStore as any).designer) resolve()
      else if (Date.now() - started > timeoutMs) resolve()
      else setTimeout(tick, 50)
    }
    tick()
  })
}

// 支持 ?id=xxx: 从模板仓库加载指定模板(来自匹配页等入口)
onMounted(async () => {
  const id = route.query.id
  if (!id) return
  await waitDesignerReady()
  try {
    const record = await designerStore.repository.get(String(id))
    if (record) {
      designerStore.loadTemplate(record)
      document.title = `OpenPrint 设计器 - ${record.name}`
    }
  } catch (e) {
    console.error('加载模板失败:', e)
  }
})

/** SVIP 属深色系: 非 light 一律用 darkTheme 基座 */
const isDark = computed(() => uiStore.effectiveTheme !== 'light')
const naiveTheme = computed(() => (isDark.value ? darkTheme : null))
const themeOverrides = computed(() => {
  switch (uiStore.effectiveTheme) {
    case 'svip':
      return svipThemeOverrides
    case 'dark':
      return darkThemeOverrides
    default:
      return lightThemeOverrides
  }
})
</script>

<template>
  <div class="openprint-shell">
    <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
      <NGlobalStyle />
      <NMessageProvider>
        <NDialogProvider>
          <div class="flex h-full flex-col">
            <TopToolbar />

            <div class="flex min-h-0 flex-1">
              <!-- 左侧组件库面板(组件/数据源/图层 三 tab) -->
              <aside class="w-250px flex-shrink-0 overflow-y-auto border-r border-brand-border bg-brand-surface">
                <LeftPanel />
              </aside>

              <!-- 中央画布 -->
              <main class="min-w-0 flex-1 bg-brand-bg">
                <CanvasStage />
              </main>

              <!-- 右侧属性面板 -->
              <aside
                v-if="uiStore.rightPanelVisible"
                class="w-300px flex-shrink-0 border-l border-brand-border bg-brand-surface"
              >
                <RightPanel />
              </aside>
            </div>

            <!-- 弹出式手写签名画板 -->
            <SignaturePadModal />
          </div>
        </NDialogProvider>
      </NMessageProvider>
    </NConfigProvider>
  </div>
</template>

<style scoped>
.openprint-shell {
  height: 100vh;
  overflow: hidden;
}
</style>

<!-- 覆盖全局 style.css 对 #app 的 1126px 居中约束, 使设计器占满全屏 -->
<style>
body:has(.openprint-shell) #app,
body:has(.openprint-shell) #app > div {
  width: 100% !important;
  max-width: none !important;
  min-height: 0 !important;
  height: 100%;
  margin: 0 !important;
  border-inline: none;
}
</style>
