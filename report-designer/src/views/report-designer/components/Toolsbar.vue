<template>
  <div class="toolsbar">
    <div class="toolsbar-row" v-for="(group, gi) in controlGroups" :key="gi">
      <div class="toolsbar-group-label" v-if="group.label">{{ group.label }}</div>
      <div class="toolsbar-items">
        <div
          v-for="meta in group.items"
          :key="meta.type"
          class="toolsbar-item"
          draggable="true"
          @dragstart="handleDragStart($event, meta.type)"
          @click="handleClick(meta.type)"
        >
          <el-icon><component :is="meta.icon" /></el-icon>
          <span class="toolsbar-item-label">{{ meta.name }}</span>
        </div>
      </div>
      <div class="toolsbar-divider" v-if="gi < controlGroups.length - 1"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Edit,
  Picture,
  Minus,
  Box,
  Tickets,
  Grid,
  List,
  Bottom,
  Document,
  Clock
} from '@element-plus/icons-vue'
import { CONTROL_METAS, type ControlType } from '@/types/control'

const emit = defineEmits<{
  (e: 'add-control', type: ControlType): void
}>()

// Icon 映射
const iconMap: Record<string, any> = {
  Edit,
  Picture,
  Minus,
  Box,
  Tickets,
  Grid,
  List,
  Bottom,
  Document,
  Clock,
}

// 控件分组（横向显示）
const controlGroups = computed(() => [
  {
    label: '',
    items: CONTROL_METAS
      .filter(m => ['Label', 'Image', 'Line', 'Rectangle', 'StaticTable', 'Table'].includes(m.type))
      .map(m => ({ ...m, icon: iconMap[m.icon] || Box }))
  },
  {
    label: '',
    items: CONTROL_METAS
      .filter(m => ['TextField', 'Barcode', 'QRCode'].includes(m.type))
      .map(m => ({ ...m, icon: iconMap[m.icon] || Box }))
  },
  {
    label: '',
    items: CONTROL_METAS
      .filter(m => ['PageNumber', 'ReportTitle', 'DateTime', 'PageBreak'].includes(m.type))
      .map(m => ({ ...m, icon: iconMap[m.icon] || Box }))
  },
])

// 处理拖拽开始
function handleDragStart(e: DragEvent, type: ControlType) {
  e.dataTransfer?.setData('control-type', type)
  e.dataTransfer!.effectAllowed = 'copy'
}

// 处理点击
function handleClick(type: ControlType) {
  emit('add-control', type)
}
</script>

<style scoped>
.toolsbar {
  display: flex;
  align-items: stretch;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  padding: 4px 8px;
  gap: 0;
  min-height: 44px;
  overflow-x: auto;
  overflow-y: hidden;
}

.toolsbar-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolsbar-group-label {
  font-size: 11px;
  color: #909399;
  padding: 0 6px;
}

.toolsbar-items {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolsbar-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: #303133;
  background: transparent;
  transition: all 0.15s;
  user-select: none;
  white-space: nowrap;
}

.toolsbar-item:hover {
  background: #ffffff;
  color: #409eff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.toolsbar-item:active {
  background: #ecf5ff;
}

.toolsbar-item .el-icon {
  font-size: 14px;
}

.toolsbar-item-label {
  font-size: 12px;
}

.toolsbar-divider {
  width: 1px;
  height: 22px;
  background: #d9d9d9;
  margin: 0 8px;
  align-self: center;
}
</style>