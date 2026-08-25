// 模拟数据服务
// 提供预览用的测试数据

/**
 * 获取模拟数据
 */
export function getMockData(preset: string): any {
  switch (preset) {
    case 'rawMaterial':
      return getRawMaterialData()
    case 'finishedProduct':
      return getFinishedProductData()
    case 'semiFinished':
      return getSemiFinishedData()
    case 'package':
      return getPackageData()
    default:
      return getRawMaterialData()
  }
}

/**
 * 原料检验报告模拟数据
 */
function getRawMaterialData(): any {
  return {
    Header: {
      ReportNo: 'RM-2026-00123',
      ReportDate: '2026-08-12',
      Inspector: '张伟',
      Approver: '李明',
      SupplierName: '德之馨（上海）国际贸易有限公司',
      SupplierCode: 'SUP-2024-001',
      MaterialName: '香叶醇（天然）',
      MaterialCode: 'MAT-RA-0021',
      BatchNo: 'LOT-2026-08-001',
      Quantity: 50,
      Unit: 'kg',
      ProductionDate: '2026-07-15',
      ExpiryDate: '2029-07-14',
      InspectionBasis: 'GB/T 15046-2015',
      Result: '合格',
    },
    ReportItems: [
      {
        Item: '外观',
        Specification: '无色至淡黄色透明液体',
        Method: 'Visual',
        Result: '符合规定',
        Conclusion: '合格',
        AnalysisItem: '外观',
        TestStandard: '无色至淡黄色透明液体',
        FinalVal: '符合规定',
        InspectionResultName: '合格',
      },
      {
        Item: '香气',
        Specification: '具有玫瑰花香',
        Method: '感官评定',
        Result: '具有玫瑰花香',
        Conclusion: '合格',
        AnalysisItem: '香气',
        TestStandard: '具有玫瑰花香',
        FinalVal: '具有玫瑰花香',
        InspectionResultName: '合格',
      },
      {
        Item: '相对密度 (20°C)',
        Specification: '0.850 - 0.890',
        Method: 'GB/T 11540',
        Result: '0.872',
        Conclusion: '合格',
        AnalysisItem: '相对密度 (20°C)',
        TestStandard: '0.850 - 0.890',
        FinalVal: '0.872',
        InspectionResultName: '合格',
      },
      {
        Item: '折光指数 (20°C)',
        Specification: '1.460 - 1.485',
        Method: 'GB/T 14454.4',
        Result: '1.472',
        Conclusion: '合格',
        AnalysisItem: '折光指数 (20°C)',
        TestStandard: '1.460 - 1.485',
        FinalVal: '1.472',
        InspectionResultName: '合格',
      },
      {
        Item: '旋光度 (20°C)',
        Specification: '-5° ~ -1°',
        Method: 'GB/T 14454.5',
        Result: '-2.5°',
        Conclusion: '合格',
        AnalysisItem: '旋光度 (20°C)',
        TestStandard: '-5° ~ -1°',
        FinalVal: '-2.5°',
        InspectionResultName: '合格',
      },
      {
        Item: '溶解度 (25°C)',
        Specification: '1:1 溶于 70% 乙醇',
        Method: 'GB/T 14454.6',
        Result: '符合规定',
        Conclusion: '合格',
        AnalysisItem: '溶解度 (25°C)',
        TestStandard: '1:1 溶于 70% 乙醇',
        FinalVal: '符合规定',
        InspectionResultName: '合格',
      },
      {
        Item: '含量 (GC)',
        Specification: '≥ 98.0%',
        Method: 'GB/T 11538',
        Result: '99.2%',
        Conclusion: '合格',
        AnalysisItem: '含量 (GC)',
        TestStandard: '≥ 98.0%',
        FinalVal: '99.2%',
        InspectionResultName: '合格',
      }
    ],
    Footer: {
      TotalItems: 7,
      QualifiedItems: 7,
      UnqualifiedItems: 0,
      Conclusion: '该批原料经检验，符合标准要求，准予入库使用。',
    },
  }
}

/**
 * 成品检验报告模拟数据
 */
function getFinishedProductData(): any {
  return {
    Header: {
      ReportNo: 'FP-2026-00856',
      ReportDate: '2026-08-12',
      Inspector: '王芳',
      Approver: '陈刚',
      ProductName: '薰衣草精油（有机）',
      ProductCode: 'PRD-EO-LAV-001',
      BatchNo: 'LOT-EO-2026-08-015',
      Quantity: 200,
      Unit: 'kg',
      ProductionDate: '2026-08-08',
      ExpiryDate: '2028-08-07',
      InspectionBasis: 'GB/T 12652-2019',
      Result: '合格',
    },
    ReportItems: [
      {
        Item: '外观',
        Specification: '无色至淡黄色透明液体',
        Method: 'Visual',
        Result: '淡黄色透明液体',
        Conclusion: '合格',
        AnalysisItem: '外观',
        TestStandard: '无色至淡黄色透明液体',
        FinalVal: '淡黄色透明液体',
        InspectionResultName: '合格',
      },
      {
        Item: '香气',
        Specification: '具有薰衣草特征香气',
        Method: '感官评定',
        Result: '具有清新薰衣草香气',
        Conclusion: '合格',
        AnalysisItem: '香气',
        TestStandard: '具有薰衣草特征香气',
        FinalVal: '具有清新薰衣草香气',
        InspectionResultName: '合格',
      },
      {
        Item: '相对密度 (20°C)',
        Specification: '0.875 - 0.905',
        Method: 'GB/T 11540',
        Result: '0.891',
        Conclusion: '合格',
        AnalysisItem: '相对密度 (20°C)',
        TestStandard: '0.875 - 0.905',
        FinalVal: '0.891',
        InspectionResultName: '合格',
      },
      {
        Item: '折光指数 (20°C)',
        Specification: '1.460 - 1.475',
        Method: 'GB/T 14454.4',
        Result: '1.468',
        Conclusion: '合格',
        AnalysisItem: '折光指数 (20°C)',
        TestStandard: '1.460 - 1.475',
        FinalVal: '1.468',
        InspectionResultName: '合格',
      },
      {
        Item: '旋光度 (20°C)',
        Specification: '-12° ~ -6°',
        Method: 'GB/T 14454.5',
        Result: '-9.2°',
        Conclusion: '合格',
        AnalysisItem: '旋光度 (20°C)',
        TestStandard: '-12° ~ -6°',
        FinalVal: '-9.2°',
        InspectionResultName: '合格',
      },
      {
        Item: '乙酸芳樟酯含量',
        Specification: '≥ 30.0%',
        Method: 'GC',
        Result: '35.6%',
        Conclusion: '合格',
        AnalysisItem: '乙酸芳樟酯含量',
        TestStandard: '≥ 30.0%',
        FinalVal: '35.6%',
        InspectionResultName: '合格',
      },
      {
        Item: '芳樟醇含量',
        Specification: '≥ 25.0%',
        Method: 'GC',
        Result: '28.3%',
        Conclusion: '合格',
        AnalysisItem: '芳樟醇含量',
        TestStandard: '≥ 25.0%',
        FinalVal: '28.3%',
        InspectionResultName: '合格',
      },
      {
        Item: '樟脑含量',
        Specification: '≤ 2.0%',
        Method: 'GC',
        Result: '0.8%',
        Conclusion: '合格',
        AnalysisItem: '樟脑含量',
        TestStandard: '≤ 2.0%',
        FinalVal: '0.8%',
        InspectionResultName: '合格',
      }
    ],
    Footer: {
      TotalItems: 8,
      QualifiedItems: 8,
      UnqualifiedItems: 0,
      Conclusion: '该批产品经检验，符合有机产品标准要求。',
    },
  }
}

/**
 * 半成品检验报告模拟数据
 */
function getSemiFinishedData(): any {
  return {
    Header: {
      ReportNo: 'SF-2026-00334',
      ReportDate: '2026-08-12',
      Inspector: '刘洋',
      Approver: '赵敏',
      ProductName: '玫瑰香基',
      ProductCode: 'SF-BASE-ROSE-01',
      BatchNo: 'LOT-SF-2026-08-008',
      Quantity: 100,
      Unit: 'kg',
      ProductionDate: '2026-08-10',
      Result: '待定',
    },
    ReportItems: [
      {
        Item: '外观',
        Specification: '透明液体，无悬浮物',
        Method: 'Visual',
        Result: '符合规定',
        Conclusion: '合格',
        AnalysisItem: '外观',
        TestStandard: '透明液体，无悬浮物',
        FinalVal: '符合规定',
        InspectionResultName: '合格',
      },
      {
        Item: '香气',
        Specification: '具有玫瑰花香',
        Method: '感官评定',
        Result: '符合玫瑰特征香气',
        Conclusion: '合格',
        AnalysisItem: '香气',
        TestStandard: '具有玫瑰花香',
        FinalVal: '符合玫瑰特征香气',
        InspectionResultName: '合格',
      },
      {
        Item: '色号',
        Specification: '≤ 3',
        Method: 'GB/T 14454.2',
        Result: '1.5',
        Conclusion: '合格',
        AnalysisItem: '色号',
        TestStandard: '≤ 3',
        FinalVal: '1.5',
        InspectionResultName: '合格',
      },
      {
        Item: '相对密度',
        Specification: '0.980 - 1.020',
        Method: 'GB/T 11540',
        Result: '1.002',
        Conclusion: '合格',
        AnalysisItem: '相对密度',
        TestStandard: '0.980 - 1.020',
        FinalVal: '1.002',
        InspectionResultName: '合格',
      }
    ],
    Footer: {
      TotalItems: 4,
      QualifiedItems: 4,
      UnqualifiedItems: 0,
      Conclusion: '半成品待进一步加工。',
    },
  }
}

/**
 * 包材检验报告模拟数据
 */
function getPackageData(): any {
  return {
    Header: {
      ReportNo: 'PK-2026-00567',
      ReportDate: '2026-08-12',
      Inspector: '周杰',
      Approver: '吴婷',
      PackageName: '玻璃精油瓶（10ml）',
      PackageCode: 'PKG-GLB-10ML-001',
      BatchNo: 'LOT-PKG-2026-08-020',
      Quantity: 10000,
      Unit: '个',
      SupplierName: '江苏华杰玻璃制品有限公司',
      SupplierCode: 'SUP-PKG-003',
      Result: '合格',
    },
    ReportItems: [
      {
        Item: '外观',
        Specification: '无气泡、无裂纹、无明显色差',
        Method: 'Visual',
        Result: '符合规定',
        Conclusion: '合格',
        AnalysisItem: '外观',
        TestStandard: '无气泡、无裂纹、无明显色差',
        FinalVal: '符合规定',
        InspectionResultName: '合格',
      },
      {
        Item: '容量',
        Specification: '10ml ± 0.5ml',
        Method: '容量测定',
        Result: '10.2ml',
        Conclusion: '合格',
        AnalysisItem: '容量',
        TestStandard: '10ml ± 0.5ml',
        FinalVal: '10.2ml',
        InspectionResultName: '合格',
      },
      {
        Item: '瓶壁厚度',
        Specification: '≥ 2.0mm',
        Method: '厚度测定',
        Result: '2.3mm',
        Conclusion: '合格',
        AnalysisItem: '瓶壁厚度',
        TestStandard: '≥ 2.0mm',
        FinalVal: '2.3mm',
        InspectionResultName: '合格',
      },
      {
        Item: '密封性',
        Specification: '无渗漏',
        Method: '密封测试',
        Result: '无渗漏',
        Conclusion: '合格',
        AnalysisItem: '密封性',
        TestStandard: '无渗漏',
        FinalVal: '无渗漏',
        InspectionResultName: '合格',
      }
    ],
    Footer: {
      TotalItems: 4,
      QualifiedItems: 4,
      UnqualifiedItems: 0,
      Conclusion: '该批包材经检验，符合使用要求。',
    },
  }
}
