import { createRouter, createWebHistory } from 'vue-router'
import ReportDesigner from '@/views/report-designer/index.vue'
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
      name: 'ReportDesigner',
      component: ReportDesigner
    },
    {
      path: '/op-designer',
      name: 'OpenPrintDesigner',
      component: () => import('@/views/openprint-designer/index.vue')
    },
    {
      path: '/matcher',
      name: 'TemplateMatcher',
      component: TemplateMatcher
    }
  ]
})

export default router
