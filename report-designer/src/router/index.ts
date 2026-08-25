import { createRouter, createWebHistory } from 'vue-router'
import TemplateList from '@/views/report-templates/index.vue'
import TemplateMatcher from '@/views/template-matcher/index.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/templates'
    },
    {
      path: '/templates',
      name: 'TemplateList',
      component: TemplateList
    },
    {
      path: '/designer',
      name: 'OpenPrintDesigner',
      // 老设计器已退役, /designer 指向 OpenPrint 设计器
      component: () => import('@/views/openprint-designer/index.vue')
    },
    {
      path: '/op-designer',
      name: 'OpenPrintDesignerAlias',
      redirect: '/designer'
    },
    {
      path: '/matcher',
      name: 'TemplateMatcher',
      component: TemplateMatcher
    }
  ]
})

export default router
