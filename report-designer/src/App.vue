<template>
  <!-- 顶栏导航(OpenPrint 全屏设计器页除外) -->
  <nav v-if="showNav" class="app-nav">
    <span class="nav-brand">检验报告系统</span>
    <router-link to="/templates" class="nav-link" active-class="active">模板管理</router-link>
    <router-link to="/matcher" class="nav-link" active-class="active">匹配引擎</router-link>
    <router-link to="/op-designer" class="nav-link" active-class="active">设计器</router-link>
  </nav>

  <router-view />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

// OpenPrint 设计器自带全屏工具栏, 隐藏全局导航
const showNav = computed(() => route.path !== '/op-designer')
</script>

<style>
html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 48px;
  padding: 0 16px;
  background: #1f2d3d;
  box-sizing: border-box;
}

.nav-brand {
  color: #fff;
  font-weight: 600;
  font-size: 15px;
  margin-right: 24px;
}

.nav-link {
  color: #a0b3c8;
  text-decoration: none;
  font-size: 14px;
  padding: 6px 14px;
  border-radius: 4px;
  transition: all 0.15s;
}

.nav-link:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.nav-link.active {
  color: #fff;
  background: #409eff;
}
</style>
