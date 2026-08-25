<template>
  <div class="properties-panel">
    <div class="panel-title">
      <span>属性</span>
      <span v-if="store.selectedTarget === 'page'" class="panel-subtitle">页面设置</span>
      <span v-else-if="store.selectedControl" class="panel-subtitle">{{ store.selectedControl.name }}</span>
    </div>

    <!-- 选中页面时显示页面设置 -->
    <div v-if="store.selectedTarget === 'page'" class="panel-content">
      <div class="property-section">
        <div class="section-title">
          <span>页面设置</span>
        </div>
        <div class="section-body">
          <div class="property-row">
            <label>纸张大小</label>
            <el-select :model-value="store.template.paper.size" @change="handlePageSizeChange" size="small">
              <el-option v-for="size in paperSizes" :key="size.name" :label="`${size.name} (${size.width}×${size.height}mm)`" :value="size.name" />
            </el-select>
          </div>
          <div class="property-row">
            <label>方向</label>
            <el-radio-group :model-value="store.template.paper.orientation" @change="handlePageOrientationChange" size="small">
              <el-radio-button value="portrait">竖向</el-radio-button>
              <el-radio-button value="landscape">横向</el-radio-button>
            </el-radio-group>
          </div>
          <div class="property-row">
            <label>宽度 (mm)</label>
            <el-input-number :model-value="store.template.paper.width" @change="handlePageWidthChange" :min="50" :max="1000" size="small" />
          </div>
          <div class="property-row">
            <label>高度 (mm)</label>
            <el-input-number :model-value="store.template.paper.height" @change="handlePageHeightChange" :min="50" :max="1000" size="small" />
          </div>
          <div class="property-row">
            <label>边距 (mm)</label>
            <div class="margins-grid">
              <div class="margin-cell">
                <el-input-number :model-value="store.template.paper.margins.top" @change="v => updateMargin('top', v)" :min="0" :max="100" size="small" controls-position="right" />
                <span class="margin-label">上</span>
              </div>
              <div class="margin-cell">
                <el-input-number :model-value="store.template.paper.margins.bottom" @change="v => updateMargin('bottom', v)" :min="0" :max="100" size="small" controls-position="right" />
                <span class="margin-label">下</span>
              </div>
              <div class="margin-cell">
                <el-input-number :model-value="store.template.paper.margins.left" @change="v => updateMargin('left', v)" :min="0" :max="100" size="small" controls-position="right" />
                <span class="margin-label">左</span>
              </div>
              <div class="margin-cell">
                <el-input-number :model-value="store.template.paper.margins.right" @change="v => updateMargin('right', v)" :min="0" :max="100" size="small" controls-position="right" />
                <span class="margin-label">右</span>
              </div>
            </div>
          </div>
          <div class="property-row">
            <label>背景颜色</label>
            <input type="color" :value="store.template.pages[0]?.background || '#ffffff'" @change="handlePageBgChange" class="color-input" />
            <span class="margin-hint">画布背景</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="!store.selectedControl" class="no-selection">
      <p>请选择控件或点击画布空白处配置页面</p>
    </div>

    <div v-else class="panel-content">
      <!-- 通用属性 -->
      <div class="property-section">
        <div class="section-title" @click="sections.general = !sections.general">
          <span>通用属性</span>
          <el-icon><ArrowDown v-if="sections.general" /><ArrowRight v-else /></el-icon>
        </div>
        <div v-show="sections.general" class="section-body">
          <div class="property-row">
            <label>名称</label>
            <el-input v-model="localControl.name" size="small" @change="updateProperty('name', localControl.name)" />
          </div>
          <div class="property-row">
            <label>X (mm)</label>
            <el-input-number
              v-model="localControl.x"
              size="small"
              :min="0"
              :step="1"
              controls-position="right"
              @change="updateProperty('x', localControl.x)"
            />
          </div>
          <div class="property-row">
            <label>Y (mm)</label>
            <el-input-number
              v-model="localControl.y"
              size="small"
              :min="0"
              :step="1"
              controls-position="right"
              @change="updateProperty('y', localControl.y)"
            />
          </div>
          <div class="property-row">
            <label>宽度 (mm)</label>
            <el-input-number
              v-model="localControl.width"
              size="small"
              :min="5"
              :step="1"
              controls-position="right"
              @change="updateProperty('width', localControl.width)"
            />
          </div>
          <div class="property-row">
            <label>高度 (mm)</label>
            <el-input-number
              v-model="localControl.height"
              size="small"
              :min="5"
              :step="1"
              controls-position="right"
              @change="updateProperty('height', localControl.height)"
            />
          </div>
          <div class="property-row">
            <label>锁定</label>
            <el-switch v-model="localControl.locked" @change="updateProperty('locked', localControl.locked)" />
          </div>
          <div class="property-row">
            <label>显示</label>
            <el-switch v-model="localControl.visible" @change="updateProperty('visible', localControl.visible)" />
          </div>
        </div>
      </div>

      <!-- 外观属性 -->
      <div class="property-section">
        <div class="section-title" @click="sections.appearance = !sections.appearance">
          <span>外观属性</span>
          <el-icon><ArrowDown v-if="sections.appearance" /><ArrowRight v-else /></el-icon>
        </div>
        <div v-show="sections.appearance" class="section-body">
          <!-- Label 和 TextField -->
          <template v-if="['Label', 'TextField', 'TextArea'].includes(store.selectedControl.type)">
            <div class="property-row">
              <label>字体</label>
              <el-select v-model="localProps.fontFamily" size="small" @change="updateProps({ fontFamily: localProps.fontFamily })">
                <el-option label="思源黑体" value="思源黑体" />
                <el-option label="微软雅黑" value="微软雅黑" />
                <el-option label="宋体" value="宋体" />
                <el-option label="Arial" value="Arial" />
                <el-option label="Times New Roman" value="Times New Roman" />
              </el-select>
            </div>
            <div class="property-row">
              <label>字号</label>
              <el-input-number v-model="localProps.fontSize" size="small" :min="6" :max="72" @change="updateProps({ fontSize: localProps.fontSize })" />
            </div>
            <div class="property-row" v-if="store.selectedControl.type === 'Label'">
              <label>粗细</label>
              <el-select v-model="localProps.fontWeight" size="small" @change="updateProps({ fontWeight: localProps.fontWeight })">
                <el-option label="正常" value="normal" />
                <el-option label="粗体" value="bold" />
              </el-select>
            </div>
            <div class="property-row">
              <label>颜色</label>
              <el-color-picker v-model="localProps.color" size="small" @change="updateProps({ color: localProps.color })" />
            </div>
            <div class="property-row" v-if="store.selectedControl.type === 'Label'">
              <label>背景色</label>
              <el-color-picker v-model="localProps.backgroundColor" size="small" @change="updateProps({ backgroundColor: localProps.backgroundColor })" />
            </div>
            <div class="property-row">
              <label>对齐</label>
              <el-select v-model="localProps.textAlign" size="small" @change="updateProps({ textAlign: localProps.textAlign })">
                <el-option label="左对齐" value="left" />
                <el-option label="居中" value="center" />
                <el-option label="右对齐" value="right" />
              </el-select>
            </div>
          </template>

          <!-- Rectangle -->
          <template v-if="store.selectedControl.type === 'Rectangle'">
            <div class="property-row">
              <label>边框样式</label>
              <el-select v-model="localProps.borderStyle" size="small" @change="updateProps({ borderStyle: localProps.borderStyle })">
                <el-option label="无" value="none" />
                <el-option label="细线" value="thin" />
                <el-option label="中等" value="medium" />
                <el-option label="粗线" value="thick" />
              </el-select>
            </div>
            <div class="property-row">
              <label>边框颜色</label>
              <el-color-picker v-model="localProps.borderColor" size="small" @change="updateProps({ borderColor: localProps.borderColor })" />
            </div>
            <div class="property-row">
              <label>填充颜色</label>
              <el-color-picker v-model="localProps.fillColor" size="small" @change="updateProps({ fillColor: localProps.fillColor })" />
            </div>
            <div class="property-row">
              <label>圆角</label>
              <el-input-number v-model="localProps.cornerRadius" size="small" :min="0" :max="50" @change="updateProps({ cornerRadius: localProps.cornerRadius })" />
            </div>
          </template>

          <!-- Line -->
          <template v-if="store.selectedControl.type === 'Line'">
            <div class="property-row">
              <label>方向</label>
              <el-select v-model="localProps.direction" size="small" @change="updateProps({ direction: localProps.direction })">
                <el-option label="水平" value="horizontal" />
                <el-option label="垂直" value="vertical" />
              </el-select>
            </div>
            <div class="property-row">
              <label>线条样式</label>
              <el-select v-model="localProps.strokeStyle" size="small" @change="updateProps({ strokeStyle: localProps.strokeStyle })">
                <el-option label="实线" value="solid" />
                <el-option label="虚线" value="dashed" />
                <el-option label="点线" value="dotted" />
              </el-select>
            </div>
            <div class="property-row">
              <label>线条宽度</label>
              <el-input-number v-model="localProps.strokeWidth" size="small" :min="1" :max="10" @change="updateProps({ strokeWidth: localProps.strokeWidth })" />
            </div>
            <div class="property-row">
              <label>颜色</label>
              <el-color-picker v-model="localProps.color" size="small" @change="updateProps({ color: localProps.color })" />
            </div>
          </template>

          <!-- Barcode -->
          <template v-if="store.selectedControl.type === 'Barcode'">
            <div class="property-row">
              <label>条形码类型</label>
              <el-select v-model="localProps.barcodeType" size="small" @change="updateProps({ barcodeType: localProps.barcodeType })">
                <el-option label="CODE128" value="CODE128" />
                <el-option label="CODE39" value="CODE39" />
                <el-option label="EAN13" value="EAN13" />
                <el-option label="UPC" value="UPC" />
              </el-select>
            </div>
            <div class="property-row">
              <label>显示文字</label>
              <el-switch v-model="localProps.showText" size="small" @change="updateProps({ showText: localProps.showText })" />
            </div>
          </template>

          <!-- PageNumber -->
          <template v-if="store.selectedControl.type === 'PageNumber'">
            <div class="property-row">
              <label>格式</label>
              <el-input v-model="localProps.format" size="small" placeholder="第 {page} 页 / 共 {total} 页" @change="updateProps({ format: localProps.format })" />
            </div>
            <div class="property-row">
              <label>字号</label>
              <el-input-number v-model="localProps.fontSize" size="small" :min="6" :max="24" @change="updateProps({ fontSize: localProps.fontSize })" />
            </div>
            <div class="property-row">
              <label>颜色</label>
              <el-color-picker v-model="localProps.color" size="small" @change="updateProps({ color: localProps.color })" />
            </div>
          </template>

          <!-- ReportTitle -->
          <template v-if="store.selectedControl.type === 'ReportTitle'">
            <div class="property-row">
              <label>字号</label>
              <el-input-number v-model="localProps.fontSize" size="small" :min="10" :max="72" @change="updateProps({ fontSize: localProps.fontSize })" />
            </div>
            <div class="property-row">
              <label>粗细</label>
              <el-select v-model="localProps.fontWeight" size="small" @change="updateProps({ fontWeight: localProps.fontWeight })">
                <el-option label="正常" value="normal" />
                <el-option label="粗体" value="bold" />
              </el-select>
            </div>
            <div class="property-row">
              <label>颜色</label>
              <el-color-picker v-model="localProps.color" size="small" @change="updateProps({ color: localProps.color })" />
            </div>
            <div class="property-row">
              <label>对齐</label>
              <el-select v-model="localProps.align" size="small" @change="updateProps({ align: localProps.align })">
                <el-option label="左对齐" value="left" />
                <el-option label="居中" value="center" />
                <el-option label="右对齐" value="right" />
              </el-select>
            </div>
          </template>

          <!-- DateTime -->
          <template v-if="store.selectedControl.type === 'DateTime'">
            <div class="property-row">
              <label>格式</label>
              <el-input v-model="localProps.format" size="small" placeholder="yyyy-MM-dd HH:mm:ss" @change="updateProps({ format: localProps.format })" />
            </div>
            <div class="property-row">
              <label>字号</label>
              <el-input-number v-model="localProps.fontSize" size="small" :min="6" :max="24" @change="updateProps({ fontSize: localProps.fontSize })" />
            </div>
            <div class="property-row">
              <label>颜色</label>
              <el-color-picker v-model="localProps.color" size="small" @change="updateProps({ color: localProps.color })" />
            </div>
          </template>
        </div>
      </div>

      <!-- 数据属性 -->
      <div class="property-section" v-if="['TextField', 'Barcode', 'QRCode', 'Table'].includes(store.selectedControl.type)">
        <div class="section-title" @click="sections.data = !sections.data">
          <span>数据属性</span>
          <el-icon><ArrowDown v-if="sections.data" /><ArrowRight v-else /></el-icon>
        </div>
        <div v-show="sections.data" class="section-body">
          <!-- TextField -->
          <template v-if="store.selectedControl.type === 'TextField'">
            <div class="property-row">
              <label>绑定字段</label>
              <el-input v-model="localProps.dataBinding" size="small" placeholder="如: Header.MaterialName" @change="updateProps({ dataBinding: localProps.dataBinding })" />
            </div>
            <div class="property-row">
              <label>格式化</label>
              <el-input v-model="localProps.format" size="small" placeholder="如: {0:N2}" @change="updateProps({ format: localProps.format })" />
            </div>
            <div class="property-row">
              <label>空值显示</label>
              <el-input v-model="localProps.nullValue" size="small" placeholder="空值显示文本" @change="updateProps({ nullValue: localProps.nullValue })" />
            </div>
          </template>

          <!-- TextArea -->
          <template v-if="store.selectedControl.type === 'TextArea'">
            <div class="property-row">
              <label>绑定字段</label>
              <el-input v-model="localProps.dataBinding" size="small" placeholder="如: Header.Description" @change="updateProps({ dataBinding: localProps.dataBinding })" />
            </div>
            <div class="property-row">
              <label>占位文本</label>
              <el-input v-model="localProps.placeholder" size="small" placeholder="未绑定时显示" @change="updateProps({ placeholder: localProps.placeholder })" />
            </div>
            <div class="property-row">
              <label>背景色</label>
              <input type="color" :value="localProps.backgroundColor || '#ffffff'" @change="updateProps({ backgroundColor: $event.target.value })" class="color-input" />
            </div>
          </template>

          <!-- Barcode / QRCode -->
          <template v-if="['Barcode', 'QRCode'].includes(store.selectedControl.type)">
            <div class="property-row">
              <label>绑定字段</label>
              <el-input v-model="localProps.dataBinding" size="small" placeholder="如: Header.ReportNo" @change="updateProps({ dataBinding: localProps.dataBinding })" />
            </div>
          </template>

          <!-- Table -->
          <template v-if="store.selectedControl.type === 'Table'">
            <div class="property-row">
              <label>数据绑定</label>
              <el-input v-model="localProps.dataBinding" size="small" placeholder="如: ReportItems" @change="updateProps({ dataBinding: localProps.dataBinding })" />
            </div>
            <div class="property-row">
              <label>边框样式</label>
              <el-select v-model="localProps.border.style" size="small" @change="updateProps({ border: { ...localProps.border, style: localProps.border.style } })">
                <el-option label="无" value="none" />
                <el-option label="细线" value="thin" />
                <el-option label="中等" value="medium" />
                <el-option label="粗线" value="thick" />
              </el-select>
            </div>
            <div class="property-row">
              <label>边框颜色</label>
              <el-color-picker v-model="localProps.border.color" size="small" @change="updateProps({ border: { ...localProps.border, color: localProps.border.color } })" />
            </div>
          </template>
        </div>
      </div>

      <!-- 单元格属性(当单元格被选中时) -->
      <div class="property-section" v-if="store.selectedCell && store.selectedControl?.type === 'Table'">
        <div class="section-title" @click="sections.cell = !sections.cell">
          <span>单元格属性</span>
          <el-icon><ArrowDown v-if="sections.cell" /><ArrowRight v-else /></el-icon>
        </div>
        <div v-show="sections.cell" class="section-body">
          <div class="cell-info">
            <span class="cell-type-badge" :class="store.selectedCell.rowType">
              {{ getRowTypeName(store.selectedCell.rowType) }}
            </span>
            <span class="cell-pos">第 {{ store.selectedCell.colIndex + 1 }} 列</span>
          </div>
          <div class="property-row">
            <label>列标题</label>
            <el-input
              v-model="localColumn.title"
              size="small"
              @change="updateColumnProperty('title', localColumn.title)"
            />
          </div>
          <div class="property-row">
            <label>绑定字段</label>
            <el-input
              v-model="localColumn.field"
              size="small"
              placeholder="如: MaterialName"
              @change="updateColumnProperty('field', localColumn.field)"
            />
          </div>
          <div class="property-row">
            <label>列宽</label>
            <el-input-number
              v-model="localColumn.width"
              size="small"
              :min="10"
              :max="200"
              @change="updateColumnProperty('width', localColumn.width)"
            />
          </div>
          <div class="property-row">
            <label>对齐</label>
            <el-select
              v-model="localColumn.align"
              size="small"
              @change="updateColumnProperty('align', localColumn.align)"
            >
              <el-option label="左对齐" value="left" />
              <el-option label="居中" value="center" />
              <el-option label="右对齐" value="right" />
            </el-select>
          </div>
          <div class="property-row">
            <label>最小宽度</label>
            <el-input-number
              v-model="localColumn.minWidth"
              size="small"
              :min="5"
              :max="50"
              @change="updateColumnProperty('minWidth', localColumn.minWidth)"
            />
          </div>
          <div class="property-row">
            <label>数值格式</label>
            <el-input
              v-model="localColumn.format"
              size="small"
              placeholder="如: {0:N2}"
              @change="updateColumnProperty('format', localColumn.format)"
            />
          </div>

          <div class="subsection-title" style="margin-top: 8px;">富格式</div>
          <div class="property-row">
            <label>字号</label>
            <el-input-number
              v-model="localColumn.fontSize"
              size="small"
              :min="6"
              :max="36"
              @change="updateColumnProperty('fontSize', localColumn.fontSize)"
            />
          </div>
          <div class="property-row">
            <label>字重</label>
            <el-radio-group
              v-model="localColumn.fontWeight"
              size="small"
              @change="updateColumnProperty('fontWeight', localColumn.fontWeight)"
            >
              <el-radio-button value="normal">普通</el-radio-button>
              <el-radio-button value="bold">加粗</el-radio-button>
            </el-radio-group>
          </div>
          <div class="property-row">
            <label>文字颜色</label>
            <input
              type="color"
              :value="localColumn.textColor || '#000000'"
              @change="updateColumnProperty('textColor', $event.target.value)"
              class="color-input"
            />
          </div>
          <div class="property-row">
            <label>背景色</label>
            <input
              type="color"
              :value="localColumn.backgroundColor || '#ffffff'"
              @change="updateColumnProperty('backgroundColor', $event.target.value)"
              class="color-input"
            />
          </div>
        </div>
      </div>

      <!-- 表格配置(仅 Table 控件) -->
      <div class="property-section" v-if="store.selectedControl?.type === 'Table'">
        <div class="section-title" @click="sections.table = !sections.table">
          <span>表格配置</span>
          <el-icon><ArrowDown v-if="sections.table" /><ArrowRight v-else /></el-icon>
        </div>
        <div v-show="sections.table" class="section-body">
          <el-tabs type="border-card" size="small">
            <!-- 表头 -->
            <el-tab-pane label="表头">
              <div class="property-row">
                <label>启用</label>
                <el-switch v-model="localProps.headerRow.enabled" size="small" @change="updateProps({ headerRow: { ...localProps.headerRow } })" />
              </div>
              <div class="property-row">
                <label>行高模式</label>
                <el-select v-model="headerHeightType" size="small" @change="handleHeaderHeightChange">
                  <el-option label="自动" value="auto" />
                  <el-option label="固定" value="fixed" />
                </el-select>
              </div>
              <div class="property-row" v-if="headerHeightType === 'fixed'">
                <label>固定高度</label>
                <el-input-number v-model="localProps.headerRow.height" size="small" :min="5" :max="50" @change="updateProps({ headerRow: { ...localProps.headerRow } })" />
              </div>
              <div class="property-row" v-if="headerHeightType === 'auto'">
                <label>最小高度</label>
                <el-input-number v-model="localProps.headerRow.minHeight" size="small" :min="5" :max="30" @change="updateProps({ headerRow: { ...localProps.headerRow } })" />
              </div>
              <div class="property-row" v-if="headerHeightType === 'auto'">
                <label>最大高度</label>
                <el-input-number v-model="localProps.headerRow.maxHeight" size="small" :min="10" :max="50" @change="updateProps({ headerRow: { ...localProps.headerRow } })" />
              </div>
              <div class="property-row">
                <label>位置模式</label>
                <el-select v-model="localProps.headerRow.position" size="small" @change="updateProps({ headerRow: { ...localProps.headerRow } })">
                  <el-option label="固顶(每页顶部)" value="sticky" />
                  <el-option label="跟随内容" value="follow" />
                </el-select>
              </div>
              <div class="property-row">
                <label>每页重复</label>
                <el-switch v-model="localProps.headerRow.repeatOnEachPage" size="small" @change="updateProps({ headerRow: { ...localProps.headerRow } })" />
              </div>
              <div class="property-row">
                <label>背景色</label>
                <el-color-picker v-model="localProps.headerRow.backgroundColor" size="small" @change="updateProps({ headerRow: { ...localProps.headerRow } })" />
              </div>
            </el-tab-pane>

            <!-- 数据行 -->
            <el-tab-pane label="数据行">
              <div class="property-row">
                <label>行高模式</label>
                <el-select v-model="dataRowHeightType" size="small" @change="handleDataRowHeightChange">
                  <el-option label="自动" value="auto" />
                  <el-option label="固定" value="fixed" />
                </el-select>
              </div>
              <div class="property-row" v-if="dataRowHeightType === 'fixed'">
                <label>固定高度</label>
                <el-input-number v-model="localProps.dataRow.height" size="small" :min="5" :max="50" @change="updateProps({ dataRow: { ...localProps.dataRow } })" />
              </div>
              <div class="property-row" v-if="dataRowHeightType === 'auto'">
                <label>最小高度</label>
                <el-input-number v-model="localProps.dataRow.minHeight" size="small" :min="5" :max="30" @change="updateProps({ dataRow: { ...localProps.dataRow } })" />
              </div>
              <div class="property-row" v-if="dataRowHeightType === 'auto'">
                <label>最大高度</label>
                <el-input-number v-model="localProps.dataRow.maxHeight" size="small" :min="10" :max="50" @change="updateProps({ dataRow: { ...localProps.dataRow } })" />
              </div>
              <div class="property-row">
                <label>最小行数</label>
                <el-input-number v-model="localProps.dataRow.minRows" size="small" :min="0" :max="100" @change="updateProps({ dataRow: { ...localProps.dataRow } })" />
              </div>
              <div class="property-row">
                <label>最大行数</label>
                <el-input-number v-model="localProps.dataRow.maxRows" size="small" :min="1" :max="500" @change="updateProps({ dataRow: { ...localProps.dataRow } })" />
              </div>
            </el-tab-pane>

            <!-- 空白行填充 -->
            <el-tab-pane label="空白行填充">
              <div class="property-row">
                <label>启用</label>
                <el-switch v-model="localProps.fillEmptyRows.enabled" size="small" @change="updateProps({ fillEmptyRows: { ...localProps.fillEmptyRows } })" />
              </div>
              <template v-if="localProps.fillEmptyRows.enabled">
                <div class="property-row">
                  <label>最小空白行</label>
                  <el-input-number v-model="localProps.fillEmptyRows.minEmptyRows" size="small" :min="0" :max="100" @change="updateProps({ fillEmptyRows: { ...localProps.fillEmptyRows } })" />
                </div>
                <div class="property-row">
                  <label>填满到表尾</label>
                  <el-switch v-model="localProps.fillEmptyRows.fillToBottom" size="small" @change="updateProps({ fillEmptyRows: { ...localProps.fillEmptyRows } })" />
                </div>
              </template>
            </el-tab-pane>

            <!-- 表尾 -->
            <el-tab-pane label="表尾">
              <div class="property-row">
                <label>启用</label>
                <el-switch v-model="localProps.footerRow.enabled" size="small" @change="updateProps({ footerRow: { ...localProps.footerRow } })" />
              </div>
              <template v-if="localProps.footerRow.enabled">
                <div class="property-row">
                  <label>行高模式</label>
                  <el-select v-model="footerHeightType" size="small" @change="handleFooterHeightChange">
                    <el-option label="自动" value="auto" />
                    <el-option label="固定" value="fixed" />
                  </el-select>
                </div>
                <div class="property-row" v-if="footerHeightType === 'fixed'">
                  <label>固定高度</label>
                  <el-input-number v-model="localProps.footerRow.height" size="small" :min="5" :max="50" @change="updateProps({ footerRow: { ...localProps.footerRow } })" />
                </div>
                <div class="property-row" v-if="footerHeightType === 'auto'">
                  <label>最小高度</label>
                  <el-input-number v-model="localProps.footerRow.minHeight" size="small" :min="5" :max="50" @change="updateProps({ footerRow: { ...localProps.footerRow } })" />
                </div>
                <div class="property-row" v-if="footerHeightType === 'auto'">
                  <label>最大高度</label>
                  <el-input-number v-model="localProps.footerRow.maxHeight" size="small" :min="10" :max="100" @change="updateProps({ footerRow: { ...localProps.footerRow } })" />
                </div>
                <div class="property-row">
                  <label>位置模式</label>
                  <el-select v-model="localProps.footerRow.position" size="small" @change="updateProps({ footerRow: { ...localProps.footerRow } })">
                    <el-option label="固底(每页底部)" value="sticky" />
                    <el-option label="跟随内容" value="follow" />
                  </el-select>
                </div>
                <div class="property-row" v-if="localProps.footerRow.position === 'sticky'">
                  <label>每页显示</label>
                  <el-switch v-model="localProps.footerRow.stickToEachPage" size="small" @change="updateProps({ footerRow: { ...localProps.footerRow } })" />
                </div>
                <div class="property-row" v-if="localProps.footerRow.position === 'sticky'">
                  <label>仅最后一页</label>
                  <el-switch v-model="localProps.footerRow.stickToLastPage" size="small" @change="updateProps({ footerRow: { ...localProps.footerRow } })" />
                </div>
                <div class="property-row">
                  <label>距离底部</label>
                  <el-input-number v-model="localProps.footerRow.minSpaceFromBottom" size="small" :min="0" :max="50" @change="updateProps({ footerRow: { ...localProps.footerRow } })" />
                </div>
                <div class="property-row">
                  <label>背景色</label>
                  <el-color-picker v-model="localProps.footerRow.backgroundColor" size="small" @change="updateProps({ footerRow: { ...localProps.footerRow } })" />
                </div>
              </template>
            </el-tab-pane>
          </el-tabs>
        </div>
      </div>

      <!-- 静态表格配置(仅 StaticTable 控件) -->
      <div class="property-section" v-if="store.selectedControl?.type === 'StaticTable'">
        <div class="section-title" @click="sections.staticTable = !sections.staticTable">
          <span>静态表格</span>
          <el-icon><ArrowDown v-if="sections.staticTable" /><ArrowRight v-else /></el-icon>
        </div>
        <div v-show="sections.staticTable" class="section-body">
          <div class="property-row">
            <label>行数</label>
            <el-input-number
              :model-value="store.selectedControl.properties.rows"
              @change="updateStaticTableSize('rows', $event)"
              :min="1"
              :max="50"
              size="small"
            />
          </div>
          <div class="property-row">
            <label>列数</label>
            <el-input-number
              :model-value="store.selectedControl.properties.cols"
              @change="updateStaticTableSize('cols', $event)"
              :min="1"
              :max="20"
              size="small"
            />
          </div>
          <div class="property-row">
            <label>默认行高</label>
            <el-input-number
              :model-value="store.selectedControl.properties.defaultRowHeight"
              @change="updateStaticTableProp('defaultRowHeight', $event)"
              :min="3"
              :max="50"
              size="small"
            />
          </div>
          <div class="property-row">
            <label>默认列宽</label>
            <el-input-number
              :model-value="store.selectedControl.properties.defaultColWidth"
              @change="updateStaticTableProp('defaultColWidth', $event)"
              :min="10"
              :max="200"
              size="small"
            />
          </div>

          <div class="subsection-title">默认边框</div>
          <div class="property-row">
            <label>样式</label>
            <el-select
              :model-value="store.selectedControl.properties.defaultBorderStyle"
              @change="updateStaticTableProp('defaultBorderStyle', $event)"
              size="small"
            >
              <el-option label="实线" value="solid" />
              <el-option label="虚线" value="dashed" />
              <el-option label="点线" value="dotted" />
              <el-option label="无边框" value="none" />
            </el-select>
          </div>
          <div class="property-row">
            <label>粗细(px)</label>
            <el-input-number
              :model-value="store.selectedControl.properties.defaultBorderWidth"
              @change="updateStaticTableProp('defaultBorderWidth', $event)"
              :min="0"
              :max="10"
              size="small"
            />
          </div>
          <div class="property-row">
            <label>颜色</label>
            <input
              type="color"
              :value="store.selectedControl.properties.defaultBorderColor || '#000000'"
              @change="updateStaticTableProp('defaultBorderColor', $event.target.value)"
              class="color-input"
            />
          </div>

          <!-- 边框样式预设 -->
          <div class="property-row" style="flex-wrap: wrap; gap: 4px;">
            <el-tooltip content="全边框" placement="top"><el-button size="small" @click="applyBorderPreset('all')">┻</el-button></el-tooltip>
            <el-tooltip content="无边框" placement="top"><el-button size="small" @click="applyBorderPreset('none')">☐</el-button></el-tooltip>
            <el-tooltip content="只留外边框" placement="top"><el-button size="small" @click="applyBorderPreset('outer')">◻</el-button></el-tooltip>
            <el-tooltip content="只有内部边框" placement="top"><el-button size="small" @click="applyBorderPreset('inner')">▦</el-button></el-tooltip>
            <el-tooltip content="只有下边框（表头风格）" placement="top"><el-button size="small" @click="applyBorderPreset('bottom')">━</el-button></el-tooltip>
          </div>

          <!-- 行列尺寸快捷操作 -->
          <div class="subsection-title">行列尺寸</div>
          <div class="row-col-size-section">
            <div v-if="store.selectedStaticTableRow" class="size-hint-box">
              <span class="size-hint-label">📐 选中第 {{ (store.selectedStaticTableRow.rowIndex ?? 0) + 1 }} 行</span>
              <div class="property-row">
                <label>行高 (mm)</label>
                <el-input-number
                  :model-value="store.selectedControl?.properties?.rowHeights?.[store.selectedStaticTableRow.rowIndex] ?? store.selectedControl?.properties?.defaultRowHeight ?? 10"
                  @change="v => store.updateStaticTableRowHeight(store.selectedControlId, store.selectedStaticTableRow!.rowIndex, v)"
                  :min="3" :max="100" :step="0.5"
                  size="small"
                  controls-position="right"
                  style="width: 100%"
                />
              </div>
            </div>
            <div v-else-if="store.selectedStaticTableColumn" class="size-hint-box">
              <span class="size-hint-label">📐 选中第 {{ (store.selectedStaticTableColumn.colIndex ?? 0) + 1 }} 列</span>
              <div class="property-row">
                <label>列宽 (mm)</label>
                <el-input-number
                  :model-value="store.selectedControl?.properties?.colWidths?.[store.selectedStaticTableColumn.colIndex] ?? store.selectedControl?.properties?.defaultColWidth ?? 30"
                  @change="v => store.updateStaticTableColWidth(store.selectedControlId, store.selectedStaticTableColumn!.colIndex, v)"
                  :min="5" :max="200" :step="0.5"
                  size="small"
                  controls-position="right"
                  style="width: 100%"
                />
              </div>
            </div>
            <div v-else class="size-hint-box hint">
              💡 点击列头/行号选中整列/整行后可批量调整尺寸
            </div>
            <!-- 斑马线开关 -->
            <div class="property-row" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #dcdfe6;">
              <label>斑马线</label>
              <el-switch
                :model-value="!!store.selectedControl?.properties?.alternatingRows"
                @change="v => updateStaticTableProp('alternatingRows', v || undefined)"
                size="small"
              />
              <input
                v-if="store.selectedControl?.properties?.alternatingRows"
                type="color"
                :value="store.selectedControl?.properties?.alternatingRowColor || '#f0f7ff'"
                @input="e => updateStaticTableProp('alternatingRowColor', (e.target as HTMLInputElement).value)"
                class="color-input"
                style="width: 28px; height: 28px; padding: 0; margin-left: 6px;"
                title="交替行背景色"
              />
            </div>
          </div>

          <!-- 列边框批量配置（选中列时） -->
          <template v-if="store.selectedStaticTableColumn && store.selectedControl?.type === 'StaticTable'">
            <div class="subsection-title">列边框（第 {{ (store.selectedStaticTableColumn.colIndex ?? 0) + 1 }} 列）</div>
            <div class="col-border-section">
              <div class="property-row">
                <label>左边框</label>
                <el-select
                  :model-value="getColBorderStyle(store.selectedStaticTableColumn.colIndex, 'left', 'style')"
                  @change="v => setColBorderStyle(store.selectedStaticTableColumn!.colIndex, 'left', 'style', v)"
                  size="small"
                  style="width: 80px"
                >
                  <el-option label="无" value="none" />
                  <el-option label="实线" value="solid" />
                  <el-option label="虚线" value="dashed" />
                  <el-option label="点线" value="dotted" />
                </el-select>
                <input
                  type="color"
                  :value="getColBorderStyle(store.selectedStaticTableColumn.colIndex, 'left', 'color')"
                  @input="e => setColBorderStyle(store.selectedStaticTableColumn!.colIndex, 'left', 'color', (e.target as HTMLInputElement).value)"
                  class="color-input"
                  style="width: 32px; height: 28px; padding: 0;"
                />
                <el-input-number
                  :model-value="getColBorderStyle(store.selectedStaticTableColumn.colIndex, 'left', 'width')"
                  @change="v => setColBorderStyle(store.selectedStaticTableColumn!.colIndex, 'left', 'width', v)"
                  :min="0" :max="10" :step="0.5"
                  size="small"
                  controls-position="right"
                  style="width: 70px"
                />
              </div>
              <div class="property-row">
                <label>右边框</label>
                <el-select
                  :model-value="getColBorderStyle(store.selectedStaticTableColumn.colIndex, 'right', 'style')"
                  @change="v => setColBorderStyle(store.selectedStaticTableColumn!.colIndex, 'right', 'style', v)"
                  size="small"
                  style="width: 80px"
                >
                  <el-option label="无" value="none" />
                  <el-option label="实线" value="solid" />
                  <el-option label="虚线" value="dashed" />
                  <el-option label="点线" value="dotted" />
                </el-select>
                <input
                  type="color"
                  :value="getColBorderStyle(store.selectedStaticTableColumn.colIndex, 'right', 'color')"
                  @input="e => setColBorderStyle(store.selectedStaticTableColumn!.colIndex, 'right', 'color', (e.target as HTMLInputElement).value)"
                  class="color-input"
                  style="width: 32px; height: 28px; padding: 0;"
                />
                <el-input-number
                  :model-value="getColBorderStyle(store.selectedStaticTableColumn.colIndex, 'right', 'width')"
                  @change="v => setColBorderStyle(store.selectedStaticTableColumn!.colIndex, 'right', 'width', v)"
                  :min="0" :max="10" :step="0.5"
                  size="small"
                  controls-position="right"
                  style="width: 70px"
                />
              </div>
              <div class="col-border-hint">
                💡 仅设置该列内所有单元格的对应边框方向
              </div>
            </div>
          </template>

          <!-- 动态重复行配置 -->
          <div class="subsection-title">动态数据</div>
          <div class="repeat-config-section">
            <div class="property-row">
              <label>启用动态行</label>
              <el-switch
                :model-value="!!store.selectedControl?.properties?.repeatBinding"
                @change="v => updateStaticTableProp('repeatBinding', v ? (store.selectedControl?.properties?.repeatBinding || 'Items') : undefined)"
                size="small"
              />
            </div>
            <template v-if="store.selectedControl?.properties?.repeatBinding !== undefined">
              <div class="property-row">
                <label>数据源路径</label>
                <el-input
                  :model-value="store.selectedControl?.properties?.repeatBinding || ''"
                  @change="v => updateStaticTableProp('repeatBinding', v)"
                  size="small"
                  placeholder="如: Items 或 Details.List"
                />
              </div>
              <div class="property-row">
                <label>重复起始行</label>
                <el-input-number
                  :model-value="store.selectedControl?.properties?.repeatRowStart ?? 1"
                  @change="v => updateStaticTableProp('repeatRowStart', v)"
                  :min="0"
                  :max="(store.selectedControl?.properties?.rows || 4) - 1"
                  size="small"
                  controls-position="right"
                />
              </div>
              <div class="property-row">
                <label>重复结束行</label>
                <el-input-number
                  :model-value="store.selectedControl?.properties?.repeatRowEnd ?? ((store.selectedControl?.properties?.rows || 4) - 2)"
                  @change="v => updateStaticTableProp('repeatRowEnd', v)"
                  :min="0"
                  :max="(store.selectedControl?.properties?.rows || 4) - 1"
                  size="small"
                  controls-position="right"
                />
              </div>
              <div class="property-row">
                <label>展开方向</label>
                <el-select
                  :model-value="store.selectedControl?.properties?.repeatExpand || 'down'"
                  @change="v => updateStaticTableProp('repeatExpand', v)"
                  size="small"
                >
                  <el-option label="向下扩展" value="down" />
                  <el-option label="向上扩展" value="up" />
                </el-select>
              </div>
              <div class="repeat-hint-box">
                💡 重复行内单元格的「绑定字段」请使用相对路径，
                如 <code>MaterialName</code>（对应 <code>Items[i].MaterialName</code>）
              </div>
            </template>
          </div>

          <!-- 单元格编辑入口 -->
          <div class="subsection-title">表格操作</div>

          <!-- 当前选中单元格位置提示 -->
          <div v-if="selectedStaticCell" class="cell-operation-bar">
            <span class="cell-pos-label">
              选中:行{{ selectedStaticCell.row + 1 }} × 列{{ selectedStaticCell.col + 1 }}
            </span>
            <span v-if="selectedStaticCell.rowspan > 1 || selectedStaticCell.colspan > 1" class="cell-merged-hint">
              已合并 {{ selectedStaticCell.rowspan }}行 × {{ selectedStaticCell.colspan }}列
            </span>
          </div>
          <div class="keyboard-hints">
            <span>⌨️ 方向键移动</span>
            <span>Shift+点击范围选择</span>
            <span>Ctrl+点击多选</span>
            <span>Delete删除</span>
          </div>

          <!-- 插入行列 -->
          <div class="operation-group">
            <div class="operation-row-label">插入</div>
            <div class="operation-btns">
              <el-button size="small" @click="handleInsertStaticRowBefore" :disabled="!selectedStaticCell">
                <el-icon><Top /></el-icon> 上插行
              </el-button>
              <el-button size="small" @click="handleInsertStaticRowAfter" :disabled="!selectedStaticCell">
                <el-icon><Bottom /></el-icon> 下插行
              </el-button>
              <el-button size="small" @click="handleInsertStaticColBefore" :disabled="!selectedStaticCell">
                <el-icon><Back /></el-icon> 左插列
              </el-button>
              <el-button size="small" @click="handleInsertStaticColAfter" :disabled="!selectedStaticCell">
                <el-icon><Right /></el-icon> 右插列
              </el-button>
            </div>
          </div>

          <!-- 删除/复制行列 -->
          <div class="operation-group">
            <div class="operation-row-label">删除</div>
            <div class="operation-btns">
              <el-button size="small" type="danger" plain @click="handleDeleteStaticRow" :disabled="!selectedStaticCell || store.selectedControl?.properties.rows <= 1">
                <el-icon><Top /></el-icon> 删除行
              </el-button>
              <el-button size="small" type="danger" plain @click="handleDeleteStaticCol" :disabled="!selectedStaticCell || store.selectedControl?.properties.cols <= 1">
                <el-icon><Back /></el-icon> 删除列
              </el-button>
            </div>
          </div>

          <!-- 复制行列 -->
          <div class="operation-group">
            <div class="operation-row-label">复制</div>
            <div class="operation-btns">
              <el-button size="small" @click="handleDuplicateStaticRow" :disabled="!selectedStaticCell">
                <el-icon><CopyDocument /></el-icon> 复制行
              </el-button>
              <el-button size="small" @click="handleDuplicateStaticCol" :disabled="!selectedStaticCell">
                <el-icon><CopyDocument /></el-icon> 复制列
              </el-button>
            </div>
          </div>

          <!-- 合并/拆分单元格 -->
          <div class="operation-group">
            <div class="operation-row-label">单元格</div>
            <div class="operation-btns">
              <el-button size="small" type="success" @click="handleMergeStaticCells" :disabled="store.multiSelectedStaticCells.length < 2">
                <el-icon><Plus /></el-icon> 合并选中 ({{ store.multiSelectedStaticCells.length }})
              </el-button>
              <el-button size="small" type="warning" plain @click="handleSplitStaticCell" :disabled="!selectedStaticCell || (selectedStaticCell.rowspan === 1 && selectedStaticCell.colspan === 1)">
                <el-icon><RefreshRight /></el-icon> 拆分单元格
              </el-button>
            </div>
          </div>

          <!-- 选中列宽调整 -->
          <div v-if="selectedStaticCell" class="column-width-section">
            <div class="column-width-label">
              列 {{ selectedStaticCell.col + 1 }} 宽度 (mm)
              <el-slider
                :model-value="getStaticColWidth(selectedStaticCell.col)"
                @update:model-value="v => store.updateStaticTableColWidth(store.selectedControlId, selectedStaticCell.col, v)"
                :min="5"
                :max="200"
                :step="1"
                size="small"
                show-input
              />
            </div>
          </div>

          <!-- 选中行高调整 -->
          <div v-if="selectedStaticCell" class="row-height-section">
            <div class="row-height-label">
              行 {{ selectedStaticCell.row + 1 }} 高度 (mm)
              <el-slider
                :model-value="getStaticRowHeight(selectedStaticCell.row)"
                @update:model-value="v => store.updateStaticTableRowHeight(store.selectedControlId, selectedStaticCell.row, v)"
                :min="3"
                :max="50"
                :step="1"
                size="small"
                show-input
              />
            </div>
          </div>

          <div class="subsection-title">单元格编辑</div>
          <div v-if="selectedStaticCell" class="cell-edit-entry">
            <div class="cell-edit-summary">
              <span class="cell-pos">行{{ selectedStaticCell.row + 1 }} 列{{ selectedStaticCell.col + 1 }}</span>
              <span class="cell-type-badge" :class="'type-' + (selectedStaticCell.content?.type || 'empty')">
                {{ getCellTypeLabel(selectedStaticCell) }}
              </span>
            </div>
            <el-button
              type="primary"
              size="small"
              @click="store.openStaticCellEditor()"
              class="edit-cell-btn"
            >
              <el-icon><Edit /></el-icon>
              编辑单元格属性
            </el-button>
            <el-button
              v-if="store.multiSelectedStaticCells.length >= 2"
              size="small"
              @click="batchFillDialogVisible = true"
              class="edit-cell-btn"
              style="margin-left: 4px;"
            >
              📝 批量填充 ({{ store.multiSelectedStaticCells.length }}格)
            </el-button>
          </div>
          <div v-else class="cell-edit-empty">
            <span>点击画布上的单元格开始编辑</span>
          </div>

          <!-- 单元格编辑弹窗 -->
          <el-dialog
            v-model="cellEditDialogVisible"
            :title="selectedStaticCell ? `编辑单元格 (行${selectedStaticCell.row + 1} 列${selectedStaticCell.col + 1})` : '编辑单元格'"
            width="780px"
            append-to-body
            :close-on-click-modal="true"
          >
          <div v-if="selectedStaticCell" class="cell-edit-panel">
            <div class="cell-edit-columns">
              <!-- 左列：布局 + 内容 -->
              <div class="cell-edit-col">
                <!-- 布局 -->
                <div class="subsection-title">布局</div>
                <div class="layout-grid">
                  <!-- Row 1: 跨行 / 跨列 -->
                  <div class="layout-row">
                    <label class="layout-label">跨行</label>
                    <el-input-number
                      :model-value="selectedStaticCell.rowspan || 1"
                      @change="updateStaticCellProp('rowspan', $event)"
                      :min="1"
                      :max="(store.selectedControl.properties.rows || 1) - selectedStaticCell.row"
                      size="small"
                      controls-position="right"
                    />
                    <label class="layout-label">跨列</label>
                    <el-input-number
                      :model-value="selectedStaticCell.colspan || 1"
                      @change="updateStaticCellProp('colspan', $event)"
                      :min="1"
                      :max="(store.selectedControl.properties.cols || 1) - selectedStaticCell.col"
                      size="small"
                      controls-position="right"
                    />
                  </div>
                  <!-- Row 2: 列宽 / 最小宽度 -->
                  <div class="layout-row">
                    <label class="layout-label">列宽 (mm)</label>
                    <el-input-number
                      :model-value="selectedStaticCell.width ?? store.selectedControl?.properties?.defaultColWidth"
                      @change="updateStaticCellProp('width', $event)"
                      :min="5"
                      :max="200"
                      size="small"
                      controls-position="right"
                    />
                    <label class="layout-label">最小宽度</label>
                    <el-select
                      :model-value="selectedStaticCell.minWidth ?? 'default'"
                      @change="v => updateStaticCellProp('minWidth', v === 'default' ? undefined : v)"
                      size="small"
                    >
                      <el-option label="默认" value="default" />
                      <el-option label="5mm" :value="5" />
                      <el-option label="10mm" :value="10" />
                      <el-option label="15mm" :value="15" />
                      <el-option label="20mm" :value="20" />
                      <el-option label="30mm" :value="30" />
                      <el-option label="50mm" :value="50" />
                    </el-select>
                  </div>
                  <!-- Row 3: 行高 / 最小行高 -->
                  <div class="layout-row">
                    <label class="layout-label">行高 (mm)</label>
                    <el-input-number
                      :model-value="selectedStaticCell.height ?? store.selectedControl?.properties?.defaultRowHeight"
                      @change="updateStaticCellProp('height', $event)"
                      :min="3"
                      :max="200"
                      size="small"
                      controls-position="right"
                    />
                    <label class="layout-label">最小行高</label>
                    <el-select
                      :model-value="selectedStaticCell.minHeight ?? 'default'"
                      @change="v => updateStaticCellProp('minHeight', v === 'default' ? undefined : v)"
                      size="small"
                    >
                      <el-option label="默认" value="default" />
                      <el-option label="3mm" :value="3" />
                      <el-option label="5mm" :value="5" />
                      <el-option label="8mm" :value="8" />
                      <el-option label="10mm" :value="10" />
                      <el-option label="15mm" :value="15" />
                      <el-option label="20mm" :value="20" />
                    </el-select>
                  </div>
                  <!-- Row 4: 插行按钮 -->
                  <div class="layout-row buttons-row">
                    <el-button size="small" @click="handleInsertStaticRowBefore" class="flex-btn">+上插行</el-button>
                    <el-button size="small" @click="handleInsertStaticRowAfter" class="flex-btn">+下行</el-button>
                  </div>
                  <!-- Row 5: 插列按钮 -->
                  <div class="layout-row buttons-row">
                    <el-button size="small" @click="handleInsertStaticColBefore" class="flex-btn">+左插列</el-button>
                    <el-button size="small" @click="handleInsertStaticColAfter" class="flex-btn">+右插列</el-button>
                  </div>
                </div>

                <!-- 内容 -->
                <div class="subsection-title" style="margin-top: 16px;">内容</div>
                <!-- 格式工具栏 -->
                <div class="cell-format-toolbar">
                  <el-tooltip content="加粗" placement="top">
                    <button
                      class="fmt-btn"
                      :class="{ active: selectedStaticCell.fontWeight === 'bold' }"
                      @click="toggleCellFontWeight"
                      type="button"
                    ><b>B</b></button>
                  </el-tooltip>
                  <el-tooltip content="斜体" placement="top">
                    <button
                      class="fmt-btn"
                      :class="{ active: selectedStaticCell.fontStyle === 'italic' }"
                      @click="toggleCellFontStyle"
                      type="button"
                    ><i>I</i></button>
                  </el-tooltip>
                  <el-tooltip content="下划线" placement="top">
                    <button
                      class="fmt-btn"
                      :class="{ active: selectedStaticCell.textDecoration === 'underline' }"
                      @click="toggleCellUnderline"
                      type="button"
                    ><u>U</u></button>
                  </el-tooltip>
                  <span class="fmt-sep"></span>
                  <el-tooltip content="左对齐" placement="top">
                    <button
                      class="fmt-btn"
                      :class="{ active: selectedStaticCell.align === 'left' }"
                      @click="setCellAlign('left')"
                      type="button"
                    >⬅️</button>
                  </el-tooltip>
                  <el-tooltip content="居中" placement="top">
                    <button
                      class="fmt-btn"
                      :class="{ active: selectedStaticCell.align === 'center' }"
                      @click="setCellAlign('center')"
                      type="button"
                    >⬆️</button>
                  </el-tooltip>
                  <el-tooltip content="右对齐" placement="top">
                    <button
                      class="fmt-btn"
                      :class="{ active: selectedStaticCell.align === 'right' }"
                      @click="setCellAlign('right')"
                      type="button"
                    >➡️</button>
                  </el-tooltip>
                  <span class="fmt-sep"></span>
                  <el-tooltip content="文字颜色" placement="top">
                    <input
                      type="color"
                      class="fmt-color"
                      :value="selectedStaticCell.textColor || '#000000'"
                      @input="e => updateStaticCellProp('textColor', (e.target as HTMLInputElement).value)"
                      title="文字颜色"
                    />
                  </el-tooltip>
                  <el-tooltip content="背景颜色" placement="top">
                    <input
                      type="color"
                      class="fmt-color"
                      :value="selectedStaticCell.backgroundColor || '#ffffff'"
                      @input="e => updateStaticCellProp('backgroundColor', (e.target as HTMLInputElement).value)"
                      title="背景颜色"
                    />
                  </el-tooltip>
                  <el-tooltip content="字号" placement="top">
                    <el-input-number
                      :model-value="selectedStaticCell.fontSize || 10"
                      @change="v => updateStaticCellProp('fontSize', v)"
                      :min="6" :max="72" :step="1"
                      size="small"
                      controls-position="right"
                      class="fmt-fontsize"
                    />
                  </el-tooltip>
                </div>
                <el-radio-group
                  :model-value="selectedStaticCell.content?.type || 'text'"
                  @change="updateStaticCellContentType"
                  size="small"
                  class="cell-content-tabs"
                >
                  <el-radio-button value="text">文本</el-radio-button>
                  <el-radio-button value="image">图片</el-radio-button>
                  <el-radio-button value="qrcode">二维码</el-radio-button>
                  <el-radio-button value="barcode">条形码</el-radio-button>
                </el-radio-group>

                <!-- 文本字段 -->
                <template v-if="!selectedStaticCell.content || selectedStaticCell.content.type === 'text'">
                  <div class="property-row">
                    <label>静态文本</label>
                    <el-input
                      :model-value="selectedStaticCell.content?.value || ''"
                      @input="v => updateStaticCellContent('value', v)"
                      size="small"
                    />
                  </div>
                  <div class="property-row">
                    <label>绑定字段</label>
                    <el-input
                      :model-value="selectedStaticCell.content?.field || ''"
                      @input="v => updateStaticCellContent('field', v)"
                      size="small"
                      placeholder="如: Header.MaterialName"
                    />
                  </div>
                  <div class="property-row">
                    <label>数值格式</label>
                    <el-input
                      :model-value="selectedStaticCell.content?.format || ''"
                      @input="v => updateStaticCellContent('format', v)"
                      size="small"
                      placeholder="如: {0:N2}"
                    />
                  </div>
                </template>

                <!-- 图片字段 -->
                <template v-else-if="selectedStaticCell.content.type === 'image'">
                  <div class="property-row">
                    <label>图片地址</label>
                    <el-input
                      :model-value="selectedStaticCell.content.src || ''"
                      @input="v => updateStaticCellContent('src', v)"
                      size="small"
                      placeholder="URL 或字段"
                    />
                  </div>
                  <div class="property-row">
                    <label>绑定字段</label>
                    <el-input
                      :model-value="selectedStaticCell.content.field || ''"
                      @input="v => updateStaticCellContent('field', v)"
                      size="small"
                      placeholder="如: Header.Signature"
                    />
                  </div>
                  <div class="property-row">
                    <label>填充</label>
                    <el-select
                      :model-value="selectedStaticCell.content.fit || 'contain'"
                      @change="v => updateStaticCellContent('fit', v)"
                      size="small"
                    >
                      <el-option label="包含" value="contain" />
                      <el-option label="覆盖" value="cover" />
                      <el-option label="拉伸" value="fill" />
                    </el-select>
                  </div>
                </template>

                <!-- 二维码字段 -->
                <template v-else-if="selectedStaticCell.content.type === 'qrcode'">
                  <div class="property-row">
                    <label>静态内容</label>
                    <el-input
                      :model-value="selectedStaticCell.content.value || ''"
                      @input="v => updateStaticCellContent('value', v)"
                      size="small"
                    />
                  </div>
                  <div class="property-row">
                    <label>绑定字段</label>
                    <el-input
                      :model-value="selectedStaticCell.content.field || ''"
                      @input="v => updateStaticCellContent('field', v)"
                      size="small"
                    />
                  </div>
                  <div class="property-row">
                    <label>尺寸(px)</label>
                    <el-input-number
                      :model-value="selectedStaticCell.content.size || 80"
                      @input="v => updateStaticCellContent('size', v)"
                      :min="30"
                      :max="300"
                      size="small"
                      controls-position="right"
                    />
                  </div>
                </template>

                <!-- 条形码字段 -->
                <template v-else-if="selectedStaticCell.content.type === 'barcode'">
                  <div class="property-row">
                    <label>静态内容</label>
                    <el-input
                      :model-value="selectedStaticCell.content.value || ''"
                      @input="v => updateStaticCellContent('value', v)"
                      size="small"
                    />
                  </div>
                  <div class="property-row">
                    <label>绑定字段</label>
                    <el-input
                      :model-value="selectedStaticCell.content.field || ''"
                      @input="v => updateStaticCellContent('field', v)"
                      size="small"
                    />
                  </div>
                  <div class="property-row">
                    <label>类型</label>
                    <el-select
                      :model-value="selectedStaticCell.content.format || 'CODE128'"
                      @change="v => updateStaticCellContent('format', v)"
                      size="small"
                    >
                      <el-option label="CODE128" value="CODE128" />
                      <el-option label="CODE39" value="CODE39" />
                      <el-option label="EAN13" value="EAN13" />
                      <el-option label="UPC" value="UPC" />
                    </el-select>
                  </div>
                  <div class="property-row">
                    <label>显示文字</label>
                    <el-switch
                      :model-value="selectedStaticCell.content.showText !== false"
                      @change="v => updateStaticCellContent('showText', v)"
                    />
                  </div>
                </template>
              </div>

              <!-- 右列：单元格样式 + 边框 -->
              <div class="cell-edit-col">
                <!-- 单元格样式 -->
                <div class="subsection-title">单元格样式</div>
                <div class="cell-style-grid">
                  <!-- 水平对齐 -->
                  <div class="cell-style-cell">
                    <label>水平对齐</label>
                    <div class="align-icon-group">
                      <button
                        type="button"
                        class="align-icon-btn"
                        :class="{ active: (selectedStaticCell.align || 'left') === 'left' }"
                        @click="updateStaticCellProp('align', 'left')"
                        title="左对齐"
                      >
                        <svg viewBox="0 0 16 16" width="14" height="14"><rect x="2" y="3" width="12" height="2" fill="currentColor"/><rect x="2" y="7" width="9" height="2" fill="currentColor"/><rect x="2" y="11" width="5" height="2" fill="currentColor"/></svg>
                      </button>
                      <button
                        type="button"
                        class="align-icon-btn"
                        :class="{ active: selectedStaticCell.align === 'center' }"
                        @click="updateStaticCellProp('align', 'center')"
                        title="居中对齐"
                      >
                        <svg viewBox="0 0 16 16" width="14" height="14"><rect x="2" y="3" width="12" height="2" fill="currentColor"/><rect x="3.5" y="7" width="9" height="2" fill="currentColor"/><rect x="5.5" y="11" width="5" height="2" fill="currentColor"/></svg>
                      </button>
                      <button
                        type="button"
                        class="align-icon-btn"
                        :class="{ active: selectedStaticCell.align === 'right' }"
                        @click="updateStaticCellProp('align', 'right')"
                        title="右对齐"
                      >
                        <svg viewBox="0 0 16 16" width="14" height="14"><rect x="2" y="3" width="12" height="2" fill="currentColor"/><rect x="5" y="7" width="9" height="2" fill="currentColor"/><rect x="9" y="11" width="5" height="2" fill="currentColor"/></svg>
                      </button>
                    </div>
                  </div>

                  <!-- 垂直对齐 -->
                  <div class="cell-style-cell">
                    <label>垂直对齐</label>
                    <div class="align-icon-group">
                      <button
                        type="button"
                        class="align-icon-btn"
                        :class="{ active: selectedStaticCell.valign === 'top' }"
                        @click="updateStaticCellProp('valign', 'top')"
                        title="顶端对齐"
                      >
                        <svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="2" width="2" height="12" fill="currentColor"/><rect x="7" y="2" width="2" height="9" fill="currentColor"/><rect x="11" y="2" width="2" height="5" fill="currentColor"/></svg>
                      </button>
                      <button
                        type="button"
                        class="align-icon-btn"
                        :class="{ active: (selectedStaticCell.valign || 'middle') === 'middle' }"
                        @click="updateStaticCellProp('valign', 'middle')"
                        title="垂直居中"
                      >
                        <svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="2" width="2" height="12" fill="currentColor"/><rect x="7" y="3.5" width="2" height="9" fill="currentColor"/><rect x="11" y="5.5" width="2" height="5" fill="currentColor"/></svg>
                      </button>
                      <button
                        type="button"
                        class="align-icon-btn"
                        :class="{ active: selectedStaticCell.valign === 'bottom' }"
                        @click="updateStaticCellProp('valign', 'bottom')"
                        title="底端对齐"
                      >
                        <svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="2" width="2" height="12" fill="currentColor"/><rect x="7" y="5" width="2" height="9" fill="currentColor"/><rect x="11" y="9" width="2" height="5" fill="currentColor"/></svg>
                      </button>
                    </div>
                  </div>

                  <!-- 字号 -->
                  <div class="cell-style-cell">
                    <label>字号</label>
                    <el-input-number
                      :model-value="selectedStaticCell.fontSize || 10"
                      @change="updateStaticCellProp('fontSize', $event)"
                      :min="6"
                      :max="36"
                      size="small"
                      controls-position="right"
                    />
                  </div>

                  <!-- 加粗 -->
                  <div class="cell-style-cell">
                    <label>加粗</label>
                    <el-switch
                      :model-value="selectedStaticCell.fontWeight === 'bold'"
                      @change="v => updateStaticCellProp('fontWeight', v ? 'bold' : 'normal')"
                    />
                  </div>

                  <!-- 文字颜色 -->
                  <div class="cell-style-cell">
                    <label>文字颜色</label>
                    <div class="color-picker-combo">
                      <input
                        type="color"
                        :value="selectedStaticCell.textColor || '#000000'"
                        @input="updateStaticCellProp('textColor', $event.target.value)"
                        class="color-swatch"
                      />
                      <el-icon class="color-dropdown-icon"><ArrowDown /></el-icon>
                    </div>
                  </div>

                  <!-- 背景色 -->
                  <div class="cell-style-cell">
                    <label>背景色</label>
                    <div class="color-picker-combo">
                      <input
                        type="color"
                        :value="selectedStaticCell.backgroundColor || '#ffffff'"
                        @input="updateStaticCellProp('backgroundColor', $event.target.value)"
                        class="color-swatch"
                      />
                      <el-icon class="color-dropdown-icon"><ArrowDown /></el-icon>
                    </div>
                  </div>

                  <!-- 内边距 (整行) -->
                  <div class="cell-style-cell cell-style-cell-full">
                    <label>内边距</label>
                    <el-input-number
                      :model-value="selectedStaticCell.padding ?? 1"
                      @change="updateStaticCellProp('padding', $event)"
                      :min="0"
                      :max="10"
                      size="small"
                      controls-position="right"
                    />
                  </div>

                  <!-- 竖排文字 -->
                  <div class="cell-style-cell cell-style-cell-full">
                    <label>竖排文字</label>
                    <el-switch
                      :model-value="selectedStaticCell.writingMode === 'vertical-rl'"
                      @change="v => updateStaticCellProp('writingMode', v ? 'vertical-rl' : 'horizontal-tb')"
                    />
                  </div>
                </div>

                <!-- 边框 -->
                <div class="subsection-title" style="margin-top: 16px;">边框</div>
                <div class="border-grid">
                  <div class="border-row">
                    <div class="border-cell-spacer"></div>
                    <el-input-number
                      :model-value="selectedStaticCell.borderTop?.width"
                      @change="v => updateStaticCellBorder('borderTop', 'width', v)"
                      placeholder="上"
                      size="small"
                      :min="0"
                      :max="10"
                      controls-position="right"
                    />
                    <div class="border-cell-spacer"></div>
                  </div>
                  <div class="border-row">
                    <el-input-number
                      :model-value="selectedStaticCell.borderLeft?.width"
                      @change="v => updateStaticCellBorder('borderLeft', 'width', v)"
                      placeholder="左"
                      size="small"
                      :min="0"
                      :max="10"
                      controls-position="right"
                    />
                    <div class="border-center-input">
                      <input type="text" readonly />
                    </div>
                    <el-input-number
                      :model-value="selectedStaticCell.borderRight?.width"
                      @change="v => updateStaticCellBorder('borderRight', 'width', v)"
                      placeholder="右"
                      size="small"
                      :min="0"
                      :max="10"
                      controls-position="right"
                    />
                  </div>
                  <div class="border-row">
                    <div class="border-cell-spacer"></div>
                    <el-input-number
                      :model-value="selectedStaticCell.borderBottom?.width"
                      @change="v => updateStaticCellBorder('borderBottom', 'width', v)"
                      placeholder="下"
                      size="small"
                      :min="0"
                      :max="10"
                      controls-position="right"
                    />
                    <div class="border-cell-spacer"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <template #footer>
            <el-button @click="store.closeStaticCellEditor()">关闭</el-button>
          </template>
          </el-dialog>

          <!-- 批量填充弹窗 -->
          <el-dialog
            v-model="batchFillDialogVisible"
            title="批量填充单元格内容"
            width="420px"
            append-to-body
            :close-on-click-modal="true"
          >
            <div style="padding: 8px 0;">
              <div class="property-row" style="margin-bottom: 12px;">
                <label>填充方式</label>
                <el-radio-group v-model="batchFillField" size="small">
                  <el-radio-button value="value">填充文本值</el-radio-button>
                  <el-radio-button value="field">填充绑定字段</el-radio-button>
                </el-radio-group>
              </div>
              <div class="property-row">
                <label>{{ batchFillField === 'value' ? '填充文本' : '绑定字段' }}</label>
                <el-input
                  v-model="batchFillValue"
                  :placeholder="batchFillField === 'value' ? '输入要填充的文本内容' : '如: MaterialName'"
                  size="small"
                  style="flex: 1;"
                />
              </div>
              <div style="font-size: 12px; color: #909399; margin-top: 8px;">
                将对选中的 {{ store.multiSelectedStaticCells.length || 1 }} 个单元格统一填充此内容
              </div>
            </div>
            <template #footer>
              <el-button size="small" @click="batchFillDialogVisible = false">取消</el-button>
              <el-button type="primary" size="small" @click="confirmBatchFill">确定填充</el-button>
            </template>
          </el-dialog>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { ArrowDown, ArrowRight, Edit, CopyDocument } from '@element-plus/icons-vue'
import { useReportDesignerStore } from '@/stores/reportDesigner'
import { PAPER_SIZES } from '@/types/template'

const store = useReportDesignerStore()

const paperSizes = PAPER_SIZES

const sections = reactive({
  general: true,
  appearance: true,
  data: true,
  table: true,
  cell: true,
  staticTable: true,
})

// 本地副本
const localControl = ref<any>({})
const localProps = ref<any>({})
const localColumn = ref<any>({})

// 行类型名称
function getRowTypeName(rowType: string): string {
  switch (rowType) {
    case 'header': return '表头'
    case 'data': return '数据行'
    case 'footer': return '表尾'
    default: return rowType
  }
}

// 更新列属性
function updateColumnProperty(key: string, value: any) {
  if (!store.selectedCell) return
  store.updateTableColumn(
    store.selectedCell.tableId,
    store.selectedCell.colIndex,
    { [key]: value }
  )
}

// === StaticTable ===
// 优先从 store 读取(Canvas 中点击单元格触发),同时支持本地手动选择
// 单元格编辑弹窗 - 与 store 双向绑定
const cellEditDialogVisible = computed({
  get: () => store.staticCellEditorOpen,
  set: (val) => {
    if (!val) store.closeStaticCellEditor()
  }
})

const batchFillDialogVisible = ref(false)
const batchFillValue = ref('')
const batchFillField = ref('value')

function confirmBatchFill() {
  if (!batchFillValue.value.trim()) return
  const tableId = store.selectedControlId
  if (!tableId) return
  const control = store.selectedControl as any
  if (!control || control.type !== 'StaticTable') return
  const cells = control.properties.cells.map((c: any) => {
    const isMultiSelected = store.multiSelectedStaticCells.some(
      (s: any) => s.tableId === tableId && s.cellId === c.id
    )
    const isSingleSelected = store.selectedStaticTableCell?.tableId === tableId && store.selectedStaticTableCell?.cellId === c.id
    if (!isMultiSelected && !isSingleSelected) return c
    const content: any = { type: 'text' }
    if (batchFillField.value === 'value') {
      content.value = batchFillValue.value
    } else {
      content.field = batchFillValue.value
    }
    return { ...c, content }
  })
  store.updateControl(tableId, { properties: { ...control.properties, cells } })
  batchFillDialogVisible.value = false
  batchFillValue.value = ''
}

// 选中静态表格后,设置选中的第一个 cell 为默认
watch(() => store.selectedStaticTableCell, (cell) => {
  if (cell) store.closeStaticCellEditor()  // 重新选择时不自动打开
})

const selectedStaticCellId = computed({
  get: () => store.selectedStaticTableCell?.cellId || null,
  set: (val) => {
    if (val && store.selectedControlId) {
      store.selectStaticTableCell(store.selectedControlId, val)
    } else {
      store.clearStaticTableCellSelection()
    }
  }
})

// 获取选中的单元格
const selectedStaticCell = computed(() => {
  if (!store.selectedControl || store.selectedControl.type !== 'StaticTable') return null
  if (!selectedStaticCellId.value) return null
  return (store.selectedControl.properties.cells || []).find((c: any) => c.id === selectedStaticCellId.value)
})

// 获取单元格类型标签
function getCellTypeLabel(cell: any): string {
  const type = cell.content?.type
  if (!type) return '空'
  const labels: Record<string, string> = { text: '文本', image: '图片', qrcode: '二维码', barcode: '条形码' }
  return labels[type] || '空'
}

// ============ StaticTable 表格操作处理器 ============

function handleInsertStaticRowBefore() {
  if (!selectedStaticCell.value) return
  store.insertStaticTableRowBefore(store.selectedControlId, selectedStaticCellId.value!)
}

function handleInsertStaticRowAfter() {
  if (!selectedStaticCell.value) return
  store.insertStaticTableRowAfter(store.selectedControlId, selectedStaticCellId.value!)
}

function handleInsertStaticColBefore() {
  if (!selectedStaticCell.value) return
  store.insertStaticTableColBefore(store.selectedControlId, selectedStaticCellId.value!)
}

function handleInsertStaticColAfter() {
  if (!selectedStaticCell.value) return
  store.insertStaticTableColAfter(store.selectedControlId, selectedStaticCellId.value!)
}

function handleDeleteStaticRow() {
  if (!selectedStaticCell.value) return
  store.deleteStaticTableRow(store.selectedControlId, selectedStaticCell.value.row)
}

function handleDeleteStaticCol() {
  if (!selectedStaticCell.value) return
  store.deleteStaticTableCol(store.selectedControlId, selectedStaticCell.value.col)
}

function handleDuplicateStaticRow() {
  if (!selectedStaticCell.value) return
  store.duplicateStaticTableRow(store.selectedControlId, selectedStaticCell.value.row)
}

function handleDuplicateStaticCol() {
  if (!selectedStaticCell.value) return
  store.duplicateStaticTableCol(store.selectedControlId, selectedStaticCell.value.col)
}

function handleMergeStaticCells() {
  store.mergeStaticTableCells(store.selectedControlId)
}

function handleSplitStaticCell() {
  if (!selectedStaticCellId.value) return
  store.splitStaticTableCell(store.selectedControlId, selectedStaticCellId.value)
}

// 获取指定列的宽度
function getStaticColWidth(colIndex: number): number {
  const props = store.selectedControl?.properties
  if (!props) return props?.defaultColWidth || 20
  return props.colWidths?.[colIndex] ?? props.defaultColWidth ?? 20
}

// 获取指定行的高度
function getStaticRowHeight(rowIndex: number): number {
  const props = store.selectedControl?.properties
  if (!props) return props?.defaultRowHeight || 10
  return props.rowHeights?.[rowIndex] ?? props.defaultRowHeight ?? 10
}

// 更新静态表格尺寸(行数/列数)
function updateStaticTableSize(key: 'rows' | 'cols', value: number) {
  const control = store.selectedControl as any
  if (!control || control.type !== 'StaticTable') return
  const props = { ...control.properties }
  const oldRows = props.rows
  const oldCols = props.cols
  props[key] = value

  // 过滤超出范围的 cells
  let cells = (props.cells || []).filter((c: any) => c.row < value && c.col < (key === 'cols' ? value : oldCols))

  // 添加新位置上的默认 cell
  const occupied = new Set(cells.map((c: any) => `${c.row}_${c.col}`))
  for (let r = 0; r < value; r++) {
    for (let c = 0; c < (key === 'cols' ? value : oldCols); c++) {
      if (!occupied.has(`${r}_${c}`)) {
        cells.push({
          id: `st_${Date.now()}_${r}_${c}_${Math.random().toString(36).slice(2, 6)}`,
          row: r,
          col: c,
          rowspan: 1,
          colspan: 1,
        })
      }
    }
  }

  props.cells = cells
  store.updateControl(control.id, { properties: props })
}

// 更新静态表格通用属性
function updateStaticTableProp(key: string, value: any) {
  const control = store.selectedControl as any
  if (!control || control.type !== 'StaticTable') return
  const props = { ...control.properties, [key]: value }
  store.updateControl(control.id, { properties: props })
}

// 边框样式预设
function applyBorderPreset(preset: 'all' | 'none' | 'outer' | 'inner' | 'bottom') {
  const control = store.selectedControl as any
  if (!control || control.type !== 'StaticTable') return
  const { rows, cols, cells, defaultBorderStyle = 'solid', defaultBorderColor = '#000000', defaultBorderWidth = 1 } = control.properties

  const newCells = cells.map((c: any) => {
    const { row, col, rowspan = 1, colspan = 1 } = c
    const isTop = row === 0
    const isBottom = row + rowspan === rows
    const isLeft = col === 0
    const isRight = col + colspan === cols

    if (preset === 'none') {
      return { ...c, borderTop: { style: 'none' }, borderRight: { style: 'none' }, borderBottom: { style: 'none' }, borderLeft: { style: 'none' } }
    }
    if (preset === 'all') {
      return {
        ...c,
        borderTop:    { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth },
        borderRight:  { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth },
        borderBottom: { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth },
        borderLeft:   { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth },
      }
    }
    if (preset === 'outer') {
      return {
        ...c,
        borderTop:    isTop    ? { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth } : { style: 'none' },
        borderBottom: isBottom ? { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth } : { style: 'none' },
        borderLeft:   isLeft   ? { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth } : { style: 'none' },
        borderRight:  isRight  ? { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth } : { style: 'none' },
      }
    }
    if (preset === 'inner') {
      return {
        ...c,
        borderTop:    !isTop    ? { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth } : { style: 'none' },
        borderBottom: !isBottom ? { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth } : { style: 'none' },
        borderLeft:   !isLeft   ? { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth } : { style: 'none' },
        borderRight:  !isRight  ? { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth } : { style: 'none' },
      }
    }
    if (preset === 'bottom') {
      // Header row (row 0) gets bottom border only
      return {
        ...c,
        borderTop:    { style: 'none' },
        borderBottom: isTop ? { style: defaultBorderStyle, color: defaultBorderColor, width: defaultBorderWidth } : { style: 'none' },
        borderLeft:   { style: 'none' },
        borderRight:  { style: 'none' },
      }
    }
    return c
  })

  store.updateControl(control.id, { properties: { ...control.properties, cells: newCells } })
}

// 获取某列单元格的边框值（取第一个有效 cell 的值）
function getColBorderStyle(colIndex: number, side: 'left' | 'right', key: 'style' | 'color' | 'width'): any {
  const control = store.selectedControl as any
  if (!control || control.type !== 'StaticTable') return key === 'style' ? 'solid' : key === 'color' ? '#000000' : 1
  const borderKey = side === 'left' ? 'borderLeft' : 'borderRight'
  const cell = control.properties.cells.find((c: any) => c.col === colIndex && !c.colspan)
  if (!cell) return key === 'style' ? 'solid' : key === 'color' ? '#000000' : 1
  const border = cell[borderKey] || {}
  if (key === 'style') return border.style || 'solid'
  if (key === 'color') return border.color || '#000000'
  return border.width ?? 1
}

// 设置某列所有单元格的指定边框
function setColBorderStyle(colIndex: number, side: 'left' | 'right', key: 'style' | 'color' | 'width', value: any) {
  const control = store.selectedControl as any
  if (!control || control.type !== 'StaticTable') return
  const borderKey = side === 'left' ? 'borderLeft' : 'borderRight'
  const cells = control.properties.cells.map((c: any) => {
    if (c.col !== colIndex) return c
    const border = { ...(c[borderKey] || {}) }
    border[key] = value
    return { ...c, [borderKey]: border }
  })
  store.updateControl(control.id, { properties: { ...control.properties, cells } })
}

// 更新单元格属性
function updateStaticCellProp(key: string, value: any) {
  if (!selectedStaticCell.value) return
  const control = store.selectedControl as any
  if (!control) return
  const cells = control.properties.cells.map((c: any) =>
    c.id === selectedStaticCellId.value ? { ...c, [key]: value } : c
  )
  store.updateControl(control.id, { properties: { ...control.properties, cells } })
}

function toggleCellFontWeight() {
  const current = selectedStaticCell.value?.fontWeight
  updateStaticCellProp('fontWeight', current === 'bold' ? 'normal' : 'bold')
}

function toggleCellFontStyle() {
  const current = selectedStaticCell.value?.fontStyle
  updateStaticCellProp('fontStyle', current === 'italic' ? 'normal' : 'italic')
}

function toggleCellUnderline() {
  const current = selectedStaticCell.value?.textDecoration
  updateStaticCellProp('textDecoration', current === 'underline' ? 'none' : 'underline')
}

function setCellAlign(align: 'left' | 'center' | 'right') {
  updateStaticCellProp('align', align)
}

// 更新单元格内容类型

// 更新单元格内容类型
function updateStaticCellContentType(type: string) {
  if (!selectedStaticCell.value) return
  const control = store.selectedControl as any
  if (!control) return
  const cells = control.properties.cells.map((c: any) => {
    if (c.id !== selectedStaticCellId.value) return c
    const newContent: any = { type, value: '', field: '' }
    if (type === 'qrcode') newContent.size = 80
    if (type === 'barcode') { newContent.format = 'CODE128'; newContent.showText = true }
    if (type === 'image') newContent.fit = 'contain'
    return { ...c, content: newContent }
  })
  store.updateControl(control.id, { properties: { ...control.properties, cells } })
}

// 更新单元格内容字段
function updateStaticCellContent(key: string, value: any) {
  if (!selectedStaticCell.value) return
  const control = store.selectedControl as any
  if (!control) return
  const cells = control.properties.cells.map((c: any) => {
    if (c.id !== selectedStaticCellId.value) return c
    const content = { ...(c.content || { type: 'text' }), [key]: value }
    return { ...c, content }
  })
  store.updateControl(control.id, { properties: { ...control.properties, cells } })
}

// 更新单元格边框
function updateStaticCellBorder(side: 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft', key: 'width' | 'style' | 'color', value: any) {
  if (!selectedStaticCell.value) return
  const control = store.selectedControl as any
  if (!control) return
  const cells = control.properties.cells.map((c: any) => {
    if (c.id !== selectedStaticCellId.value) return c
    const borderSide = { ...(c[side] || {}), [key]: value }
    return { ...c, [side]: borderSide }
  })
  store.updateControl(control.id, { properties: { ...control.properties, cells } })
}

// === 页面设置处理 ===
function handlePageSizeChange(sizeName: string) {
  const size = paperSizes.find(s => s.name === sizeName)
  if (!size) return
  const paper = { ...store.template.paper }
  if (paper.orientation === 'landscape') {
    paper.width = size.height
    paper.height = size.width
  } else {
    paper.width = size.width
    paper.height = size.height
  }
  paper.size = sizeName
  store.template.paper = paper
}

function handlePageOrientationChange(val: string) {
  const paper = { ...store.template.paper }
  const w = paper.width
  paper.width = paper.height
  paper.height = w
  paper.orientation = val as any
  store.template.paper = paper
}

function handlePageWidthChange(val: number) {
  store.template.paper = { ...store.template.paper, width: val }
}

function handlePageHeightChange(val: number) {
  store.template.paper = { ...store.template.paper, height: val }
}

function updateMargin(side: 'top' | 'bottom' | 'left' | 'right', val: number) {
  const paper = { ...store.template.paper, margins: { ...store.template.paper.margins, [side]: val } }
  store.template.paper = paper
}

function handlePageBgChange(e: Event) {
  const color = (e.target as HTMLInputElement).value
  if (store.template.pages[0]) {
    store.template.pages[0].background = color
  }
}

// 高度类型
const headerHeightType = ref('auto')
const dataRowHeightType = ref('auto')
const footerHeightType = ref('auto')

// 监听选中控件变化
watch(() => store.selectedControl, (control) => {
  if (control) {
    localControl.value = { ...control }
    localProps.value = { ...control.properties }

    // 判断高度类型
    headerHeightType.value = typeof control.properties.headerRow?.height === 'number' ? 'fixed' : 'auto'
    dataRowHeightType.value = typeof control.properties.dataRow?.height === 'number' ? 'fixed' : 'auto'
    footerHeightType.value = typeof control.properties.footerRow?.height === 'number' ? 'fixed' : 'auto'

    // StaticTable 自动展开面板
    if (control.type === 'StaticTable') {
      sections.staticTable = true
    } else {
      store.clearStaticTableCellSelection()
    }
  } else {
    localControl.value = {}
    localProps.value = {}
    selectedStaticCellId.value = null
  }
}, { immediate: true, deep: true })

// 监听单元格选中变化
watch(() => store.selectedCell, (cell) => {
  if (cell) {
    const control = store.selectedControl as any
    if (control?.type === 'Table' && control.properties.columns) {
      localColumn.value = { ...control.properties.columns[cell.colIndex] }
    }
  } else {
    localColumn.value = {}
  }
}, { immediate: true, deep: true })

// 更新基础属性
function updateProperty(key: string, value: any) {
  if (!store.selectedControlId) return
  store.updateControl(store.selectedControlId, { [key]: value })
}

// 更新 properties
function updateProps(updates: any) {
  if (!store.selectedControlId) return
  store.updateControl(store.selectedControlId, { properties: { ...localProps.value, ...updates } })
}

// 处理表头高度变化
function handleHeaderHeightChange() {
  if (headerHeightType.value === 'auto') {
    updateProps({ headerRow: { ...localProps.value.headerRow, height: 'auto' } })
  } else {
    updateProps({ headerRow: { ...localProps.value.headerRow, height: 10 } })
  }
}

// 处理数据行高度变化
function handleDataRowHeightChange() {
  if (dataRowHeightType.value === 'auto') {
    updateProps({ dataRow: { ...localProps.value.dataRow, height: 'auto' } })
  } else {
    updateProps({ dataRow: { ...localProps.value.dataRow, height: 8 } })
  }
}

// 处理表尾高度变化
function handleFooterHeightChange() {
  if (footerHeightType.value === 'auto') {
    updateProps({ footerRow: { ...localProps.value.footerRow, height: 'auto' } })
  } else {
    updateProps({ footerRow: { ...localProps.value.footerRow, height: 15 } })
  }
}
</script>

<style scoped>
.properties-panel {
  width: 300px;
  background: #fff;
  border-left: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-title {
  padding: 12px 16px;
  font-weight: 600;
  font-size: 14px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-subtitle {
  font-size: 12px;
  font-weight: 400;
  color: #909399;
}

.no-selection {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 13px;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
}

.property-section {
  border-bottom: 1px solid #f0f0f0;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  background: #fafafa;
}

.section-title:hover {
  background: #f0f0f0;
}

.section-body {
  padding: 12px 16px;
}

.property-row {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  gap: 8px;
}

.cell-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px;
  background: #f5f7fa;
  border-radius: 4px;
}

.cell-type-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.cell-type-badge.header {
  background: #e0e0e0;
  color: #303133;
}

.cell-type-badge.data {
  background: #d9ecff;
  color: #409eff;
}

.cell-type-badge.footer {
  background: #f5f5f5;
  color: #606266;
}

.cell-pos {
  font-size: 12px;
  color: #909399;
}

.property-row:last-child {
  margin-bottom: 0;
}

.subsection-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin: 12px 0 10px;
  padding: 4px 0 4px 10px;
  border-left: 3px solid #409eff;
  background: #fafbfc;
  line-height: 1.2;
}

.static-table-grid-config {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: auto;
  max-height: 320px;
  background: #fafafa;
}

.grid-row-header,
.grid-row {
  display: flex;
  align-items: center;
  border-bottom: 1px solid #ebeef5;
}

.grid-row-header {
  background: #f5f7fa;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

.grid-row:last-child {
  border-bottom: none;
}

.grid-corner {
  width: 28px;
  flex-shrink: 0;
  text-align: center;
  font-size: 11px;
  color: #909399;
}

.grid-col-label {
  flex: 1;
  min-width: 80px;
  text-align: center;
  font-size: 11px;
  color: #606266;
  border-right: 1px solid #ebeef5;
}

.grid-row-label {
  width: 28px;
  flex-shrink: 0;
  text-align: center;
  font-size: 11px;
  color: #606266;
  font-weight: 500;
  border-right: 1px solid #ebeef5;
}

.grid-cell-input {
  flex: 1;
  min-width: 80px;
  border: none;
  border-right: 1px solid #ebeef5;
  padding: 4px 6px;
  font-size: 11px;
  outline: none;
  background: transparent;
}

.grid-cell-input:focus {
  background: #fff;
  box-shadow: inset 0 0 0 1px #409eff;
}

.color-input {
  width: 40px;
  height: 24px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
}

.property-row label {
  width: 72px;
  font-size: 12px;
  color: #606266;
  flex-shrink: 0;
}

.property-row :deep(.el-input),
.property-row :deep(.el-select),
.property-row :deep(.el-input-number) {
  flex: 1;
}

:deep(.el-tabs__header) {
  margin: 0;
}

:deep(.el-tabs__nav-wrap) {
  background: #fafafa;
}

:deep(.el-tabs__content) {
  padding: 8px;
}

/* StaticTable 专用样式 */
.static-table-cells {
  display: none;  /* 不再使用,仅保留 class 以防外部引用 */
}

.cell-item {
  display: none;
}

.cell-pos {
  color: #606266;
  font-weight: 500;
}

.cell-type-badge {
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  background: #ebeef5;
  color: #909399;
}

.cell-type-badge.type-text {
  background: #d9ecff;
  color: #409eff;
}

.cell-type-badge.type-image {
  background: #fdf6ec;
  color: #e6a23c;
}

.cell-type-badge.type-qrcode,
.cell-type-badge.type-barcode {
  background: #f0f9eb;
  color: #67c23a;
}

.cell-edit-entry {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  background: #f5f7fa;
  border-radius: 4px;
  border: 1px solid #ebeef5;
}

.cell-edit-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #606266;
}

.cell-edit-entry .cell-pos {
  font-weight: 600;
  color: #303133;
}

.cell-edit-entry .cell-type-badge {
  font-size: 11px;
}

.edit-cell-btn {
  width: 100%;
}

.cell-edit-empty {
  padding: 16px;
  text-align: center;
  color: #909399;
  background: #fafafa;
  border: 1px dashed #dcdfe6;
  border-radius: 4px;
  font-size: 12px;
}

.cell-edit-panel {
  border-radius: 4px;
  padding: 4px;
}

.cell-edit-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.cell-edit-col {
  min-width: 0;
}

.layout-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.layout-row {
  display: grid;
  grid-template-columns: 72px 1fr 72px 1fr;
  gap: 8px;
  align-items: center;
}

.layout-row.buttons-row {
  grid-template-columns: 1fr 1fr;
}

.layout-row.buttons-row :deep(.el-button) {
  width: 100%;
}

.layout-row.buttons-row .flex-btn {
  flex: 1;
}

.layout-label {
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
  text-align: right;
  display: block;
  line-height: 1;
}

.layout-row :deep(.el-input-number),
.layout-row :deep(.el-select) {
  width: 100%;
  min-width: 0;
}

.cell-content-tabs {
  margin-bottom: 12px;
  width: 100%;
  display: flex;
}

.cell-content-tabs :deep(.el-radio-button) {
  flex: 1;
}

.cell-content-tabs :deep(.el-radio-button__inner) {
  width: 100%;
  padding: 6px 12px;
  font-size: 12px;
  border: 1px solid #dcdfe6;
}

.cell-content-tabs :deep(.el-radio-button__inner:hover) {
  color: #409eff;
}

.cell-content-tabs :deep(.el-radio-button.is-active .el-radio-button__inner) {
  background-color: #409eff;
  border-color: #409eff;
  color: #fff;
  box-shadow: -1px 0 0 0 #409eff;
}

/* 单元格格式工具栏 */
.cell-format-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: #f5f7fa;
  border-radius: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.fmt-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  transition: all 0.15s;
  padding: 0;
}

.fmt-btn:hover {
  border-color: #409eff;
  color: #409eff;
}

.fmt-btn.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}

.fmt-sep {
  width: 1px;
  height: 20px;
  background: #dcdfe6;
  margin: 0 2px;
}

.fmt-color {
  width: 28px;
  height: 28px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 2px;
  cursor: pointer;
  background: #fff;
}

.fmt-fontsize {
  width: 80px;
}

.fmt-fontsize :deep(.el-input__wrapper) {
  padding-left: 6px;
  padding-right: 6px;
}

.cell-style-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
  margin-bottom: 12px;
}

.cell-style-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cell-style-cell-full {
  grid-column: 1 / -1;
}

.cell-style-cell label {
  font-size: 12px;
  color: #606266;
}

.cell-style-cell :deep(.el-input-number) {
  width: 100%;
}

.cell-style-cell :deep(.el-switch) {
  align-self: flex-start;
}

.align-icon-group {
  display: flex;
  gap: 6px;
  width: 100%;
}

.align-icon-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  background: #f5f7fa;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  color: #606266;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s;
}

.align-icon-btn:hover {
  border-color: #409eff;
  color: #409eff;
}

.align-icon-btn.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}

.align-icon-btn svg {
  display: block;
}

.color-picker-combo {
  position: relative;
  display: inline-block;
  width: 100%;
  height: 28px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.color-swatch {
  width: 26px;
  height: 20px;
  margin-left: 4px;
  border: 1px solid #ebeef5;
  border-radius: 2px;
  cursor: pointer;
  background: transparent;
}

.color-dropdown-icon {
  margin-left: auto;
  margin-right: 6px;
  color: #909399;
  font-size: 12px;
  pointer-events: none;
}

.border-grid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: #fff;
  border-radius: 4px;
}

.border-row {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  width: 100%;
}

.border-row > :deep(.el-input-number) {
  width: 88px;
}

.border-cell {
  width: 88px;
  display: flex;
  justify-content: center;
}

.border-cell-spacer {
  width: 88px;
  display: flex;
  justify-content: center;
  visibility: hidden;
}

.border-center {
  width: 100px;
  height: 24px;
  background: #f5f7fa;
  border-radius: 2px;
}

.border-center-input {
  width: 120px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.border-center-input input {
  width: 100%;
  height: 100%;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  cursor: default;
}

/* 页面设置相关 */
.margins-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
  width: 100%;
}

.margin-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.margin-label {
  font-size: 11px;
  color: #909399;
}

.margin-hint {
  font-size: 11px;
  color: #909399;
  margin-left: 6px;
}

/* StaticTable 表格操作 */
.cell-operation-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding: 6px 10px;
  background: #f0f7ff;
  border-radius: 4px;
  border: 1px solid #d0e8ff;
}

.cell-pos-label {
  font-size: 13px;
  font-weight: 500;
  color: #409eff;
}

.cell-merged-hint {
  font-size: 12px;
  color: #909399;
}

.keyboard-hints {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
  color: #909399;
  margin-bottom: 10px;
  padding: 4px 8px;
  background: #fafafa;
  border-radius: 4px;
}

/* 动态重复行配置 */
.repeat-config-section {
  background: #f0f7ff;
  border: 1px solid #d0e8ff;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.repeat-hint-box {
  margin-top: 8px;
  padding: 8px;
  background: #fff;
  border-radius: 4px;
  font-size: 12px;
  color: #606266;
  line-height: 1.6;
}

/* 行列尺寸快捷操作 */
.row-col-size-section {
  background: #f5f5f5;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 10px;
}

.size-hint-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.size-hint-label {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.size-hint-box.hint {
  font-size: 12px;
  color: #909399;
  padding: 4px 0;
}

/* 列边框批量配置 */
.col-border-section {
  background: #f5f5f5;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 10px;
}

.col-border-hint {
  font-size: 11px;
  color: #909399;
  margin-top: 4px;
}

.repeat-hint-box code {
  background: #e8f4ff;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
  color: #409eff;
}

.operation-group {
  display: flex;
  align-items: flex-start;
  margin-bottom: 10px;
  gap: 8px;
}

.operation-row-label {
  font-size: 12px;
  color: #606266;
  min-width: 36px;
  padding-top: 6px;
}

.operation-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
}

.column-width-section,
.row-height-section {
  margin-bottom: 12px;
  padding: 8px 10px;
  background: #fafafa;
  border-radius: 4px;
}

.column-width-label,
.row-height-label {
  font-size: 12px;
  color: #606266;
}

.column-width-label :deep(.el-slider),
.row-height-section :deep(.el-slider) {
  margin: 6px 0;
}

.column-width-label :deep(.el-slider__runway),
.row-height-section :deep(.el-slider__runway) {
  height: 4px;
}
</style>
