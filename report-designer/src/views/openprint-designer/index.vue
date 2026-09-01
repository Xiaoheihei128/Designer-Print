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
import { useBusinessDataStore } from '@op/design/stores/businessData'
import { useFieldCatalogStore } from '@op/design/stores/fieldCatalog'

const route = useRoute()
const uiStore = useUiStore()
const designerStore = useDesignerStore()
const businessDataStore = useBusinessDataStore()

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
  // 兜底：matcher 正常流程已用 Pinia 直传（setFromMatcher），这里仅在 Pinia 数据缺失时
  // 从 sessionStorage 恢复（如 SPA 重置、刷新整页）。
  if (!businessDataStore.data) {
    try {
      const raw = sessionStorage.getItem('op:matcher:lastData')
      if (raw) {
        const payload = JSON.parse(raw) as {
          __sourceId?: string
          __sourceName?: string
          data?: Record<string, unknown>
        }
        // 兼容老格式（v1 直接 JSON.stringify(parsed) 没有 __sourceId 包装）
        const data = payload.data ?? (payload as unknown as Record<string, unknown>)
        const sourceId = payload.__sourceId ?? 'matcher:restored'
        const sourceName = payload.__sourceName ?? 'matcher 数据（刷新恢复）'
        if (data && typeof data === 'object') {
          businessDataStore.setFromMatcher(data)
          // ★ 目录-数据一致性：用同一个 sourceId 注入，避免兜底路径覆盖 matcher 已设的 ID。
          //   老格式（无 __sourceId）落到 'matcher:restored'，新格式落到原 category 对应的 ID。
          const fieldCatalog = useFieldCatalogStore()
          fieldCatalog.injectFromJson(data, { sourceId, sourceName })
        }
        sessionStorage.removeItem('op:matcher:lastData')
      }
    } catch (e) {
      console.warn('读取匹配数据失败：', e)
    }
  }
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
    <!-- class="h-full": NConfigProvider 渲染的中间层 div 需要高度约束, 否则 100% 高度链断裂 -->
    <NConfigProvider class="h-full" :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
      <NGlobalStyle />
      <NMessageProvider>
        <NDialogProvider>
          <div class="flex h-full min-h-0 flex-col">
            <TopToolbar />

            <div class="flex min-h-0 flex-1">
              <!-- 左侧组件库面板(组件/数据源/图层 三 tab) -->
              <aside class="w-250px flex-shrink-0 min-h-0 overflow-y-auto border-r border-brand-border bg-brand-surface">
                <LeftPanel />
              </aside>

              <!-- 中央画布 -->
              <main class="min-w-0 flex-1 bg-brand-bg">
                <CanvasStage />
              </main>

              <!-- 右侧属性面板 -->
              <aside
                v-if="uiStore.rightPanelVisible"
                class="w-300px flex-shrink-0 min-h-0 overflow-y-auto border-l border-brand-border bg-brand-surface"
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
