// ReportDesigner.Api —— OpenPrint 打印模板后端
// 按 OpenPrint《后端对接规范》§4.1 实现 /api/print/templates CRUD:
//   GET    /api/print/templates        → 列表 { items, total }(摘要, 不含 content)
//   GET    /api/print/templates/{id}   → 详情(含 content, TemplateJSON 字符串)
//   POST   /api/print/templates        → 创建(201 + id)
//   PUT    /api/print/templates/{id}   → 全量更新(200)
//   DELETE /api/print/templates/{id}   → 物理删除(204)
// 错误信封: { code, message }
// 存储: data/templates/_index.json(摘要索引 + 完整记录)

using System.Text.Json;
using System.Text.Json.Serialization;

namespace ReportDesigner.Api;

/// <summary>模板记录: 元信息 + content(TemplateJSON 字符串) + matchRules(匹配规则 JSON 字符串)</summary>
public sealed record TemplateRecord(
    string Id,
    string Name,
    string Code,
    string? Category,
    string? Visibility,
    string? CreatedBy,
    string? CreatedAt,
    string? UpdatedBy,
    string? UpdatedAt,
    string Content,
    string? MatchRules,
    bool IsActive = true);

/// <summary>创建/更新请求体</summary>
public sealed class TemplateUpsertRequest
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("code")] public string? Code { get; set; }
    [JsonPropertyName("category")] public string? Category { get; set; }
    [JsonPropertyName("visibility")] public string? Visibility { get; set; }
    [JsonPropertyName("content")] public string? Content { get; set; }
    /// <summary>匹配规则 JSON 字符串(如 [{"field":"ReportType","operator":"Equals","value":"RawMaterial","priority":10}])</summary>
    [JsonPropertyName("matchRules")] public string? MatchRules { get; set; }
    /// <summary>启停状态(默认启用)</summary>
    [JsonPropertyName("isActive")] public bool? IsActive { get; set; }
}

public static class Program
{
    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    private static string Now() => DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
    private static string GenId() => $"tpl_{Guid.NewGuid():N}";

    private static List<TemplateRecord> LoadAll(string indexFile)
    {
        if (!File.Exists(indexFile)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<TemplateRecord>>(File.ReadAllText(indexFile), JsonOpts) ?? [];
        }
        catch { return []; }
    }

    private static void SaveAll(string indexFile, List<TemplateRecord> list) =>
        File.WriteAllText(indexFile, JsonSerializer.Serialize(list, JsonOpts));

    private static object ToSummary(TemplateRecord r) => new
    {
        id = r.Id,
        name = r.Name,
        code = r.Code,
        category = r.Category,
        visibility = r.Visibility ?? "private",
        createdBy = r.CreatedBy,
        createdAt = r.CreatedAt,
        updatedBy = r.UpdatedBy,
        updatedAt = r.UpdatedAt,
        permissions = new { editable = true, deletable = true, copyable = true },
        matchRules = r.MatchRules,
        isActive = r.IsActive,
    };

    private static object ToDetail(TemplateRecord r) => new
    {
        id = r.Id,
        name = r.Name,
        code = r.Code,
        category = r.Category,
        visibility = r.Visibility ?? "private",
        createdBy = r.CreatedBy,
        createdAt = r.CreatedAt,
        updatedBy = r.UpdatedBy,
        updatedAt = r.UpdatedAt,
        permissions = new { editable = true, deletable = true, copyable = true },
        content = r.Content,
        matchRules = r.MatchRules,
        isActive = r.IsActive,
    };

    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddCors();
        var app = builder.Build();

        // CORS: 允许前端开发服务器(本地任意端口)
        app.UseCors(c => c
            .SetIsOriginAllowed(_ => true)
            .AllowAnyMethod()
            .AllowAnyHeader());

        // ---- 存储层(JSON 文件) ----
        var dataDir = Path.Combine(AppContext.BaseDirectory, "data", "templates");
        Directory.CreateDirectory(dataDir);
        var indexFile = Path.Combine(dataDir, "_index.json");

        // 列表
        app.MapGet("/api/print/templates", () =>
        {
            var list = LoadAll(indexFile);
            return Results.Ok(new { items = list.Select(ToSummary).ToList(), total = list.Count });
        });

        // 详情
        app.MapGet("/api/print/templates/{id}", (string id) =>
        {
            var record = LoadAll(indexFile).FirstOrDefault(r => r.Id == id);
            return record is null
                ? Results.Json(new { code = "TEMPLATE_NOT_FOUND", message = $"模板 {id} 不存在" }, statusCode: 404)
                : Results.Ok(ToDetail(record));
        });

        // 创建
        app.MapPost("/api/print/templates", (TemplateUpsertRequest req) =>
        {
            var now = Now();
            var record = new TemplateRecord(
                Id: GenId(),
                Name: req.Name?.Trim() ?? "未命名模板",
                Code: req.Code?.Trim() ?? "",
                Category: req.Category,
                Visibility: req.Visibility ?? "private",
                CreatedBy: "admin",
                CreatedAt: now,
                UpdatedBy: "admin",
                UpdatedAt: now,
                Content: req.Content ?? "{}",
                MatchRules: req.MatchRules,
                IsActive: req.IsActive ?? true);

            var list = LoadAll(indexFile);
            list.Add(record);
            SaveAll(indexFile, list);
            return Results.Json(ToDetail(record), statusCode: 201);
        });

        // 全量更新
        app.MapPut("/api/print/templates/{id}", (string id, TemplateUpsertRequest req) =>
        {
            var list = LoadAll(indexFile);
            var index = list.FindIndex(r => r.Id == id);
            if (index < 0)
                return Results.Json(new { code = "TEMPLATE_NOT_FOUND", message = $"模板 {id} 不存在" }, statusCode: 404);

            var old = list[index];
            var updated = old with
            {
                Name = req.Name?.Trim() ?? old.Name,
                Code = req.Code?.Trim() ?? old.Code,
                Category = req.Category,
                Visibility = req.Visibility,
                UpdatedAt = Now(),
                Content = req.Content ?? old.Content,
                MatchRules = req.MatchRules ?? old.MatchRules,
                IsActive = req.IsActive ?? old.IsActive,
            };
            list[index] = updated;
            SaveAll(indexFile, list);
            return Results.Ok(ToDetail(updated));
        });

        // 删除
        app.MapDelete("/api/print/templates/{id}", (string id) =>
        {
            var list = LoadAll(indexFile);
            var removed = list.RemoveAll(r => r.Id == id);
            if (removed == 0)
                return Results.Json(new { code = "TEMPLATE_NOT_FOUND", message = $"模板 {id} 不存在" }, statusCode: 404);
            SaveAll(indexFile, list);
            return Results.NoContent();
        });

        // ---- 数据源目录(OpenPrint《后端对接规范》§4.2, 只读) ----
        // 检验报告数据源: Header 主表 + ReportItems 明细(与老系统数据契约一致)
        // 注意: 前端 HttpClient.list() 解包 { items, total } 信封
        app.MapGet("/api/print/data-sources", () =>
        {
            object[] items =
            [
                new
                {
                    id = "inspection-report",
                    name = "检验报告",
                    description = "原料/成品/半成品/包材检验报告(Header 主表 + ReportItems 明细)",
                    tables = new object[]
                    {
                        new { id = "header", name = "报告头", relation = "main", pathPrefix = "Header." },
                        new { id = "items", name = "检验明细", relation = "detail", pathPrefix = "ReportItems[].", isArray = true },
                    },
                },
            ];
            return Results.Ok(new { items, total = items.Length });
        });

        app.MapGet("/api/print/data-sources/inspection-report/fields", () =>
        {
            object[] items =
            [

            // Header 主表
            new { path = "Header.ReportNo", label = "报告编号", type = "string", tableId = "header", group = "基本信息", sort = 1, sample = "RM-2026-00123" },
            new { path = "Header.ReportDate", label = "报告日期", type = "date", tableId = "header", group = "基本信息", sort = 2, sample = "2026-08-12" },
            new { path = "Header.Inspector", label = "检验员", type = "string", tableId = "header", group = "基本信息", sort = 3, sample = "张伟" },
            new { path = "Header.Approver", label = "批准人", type = "string", tableId = "header", group = "基本信息", sort = 4, sample = "李明" },
            new { path = "Header.SupplierName", label = "供应商", type = "string", tableId = "header", group = "物料信息", sort = 5, sample = "德之馨(上海)" },
            new { path = "Header.SupplierCode", label = "供应商编码", type = "string", tableId = "header", group = "物料信息", sort = 6, sample = "SUP-2024-001" },
            new { path = "Header.MaterialName", label = "物料名称", type = "string", tableId = "header", group = "物料信息", sort = 7, sample = "香叶醇(天然)" },
            new { path = "Header.MaterialCode", label = "物料编码", type = "string", tableId = "header", group = "物料信息", sort = 8, sample = "MAT-RA-0021" },
            new { path = "Header.BatchNo", label = "批次号", type = "string", tableId = "header", group = "物料信息", sort = 9, sample = "LOT-2026-08-001" },
            new { path = "Header.Quantity", label = "数量", type = "number", tableId = "header", group = "物料信息", sort = 10, sample = 50 },
            new { path = "Header.Unit", label = "单位", type = "string", tableId = "header", group = "物料信息", sort = 11, sample = "kg" },
            new { path = "Header.ProductionDate", label = "生产日期", type = "date", tableId = "header", group = "物料信息", sort = 12, sample = "2026-07-15" },
            new { path = "Header.ExpiryDate", label = "有效期至", type = "date", tableId = "header", group = "物料信息", sort = 13, sample = "2029-07-14" },
            new { path = "Header.InspectionBasis", label = "检验依据", type = "string", tableId = "header", group = "检验信息", sort = 14, sample = "GB/T 15046-2015" },
            new { path = "Header.Result", label = "检验结论", type = "string", tableId = "header", group = "检验信息", sort = 15, sample = "合格" },
            // ReportItems 明细
            new { path = "ReportItems[].AnalysisItem", label = "检验项目", type = "string", tableId = "items", group = "检验明细", sort = 1, sample = "外观" },
            new { path = "ReportItems[].TestStandard", label = "标准要求", type = "string", tableId = "items", group = "检验明细", sort = 2, sample = "无色至淡黄色透明液体" },
            new { path = "ReportItems[].FinalVal", label = "实测值", type = "string", tableId = "items", group = "检验明细", sort = 3, sample = "符合规定" },
            new { path = "ReportItems[].InspectionResultName", label = "单项结论", type = "string", tableId = "items", group = "检验明细", sort = 4, sample = "合格" },
            ];
            return Results.Ok(new { items, total = items.Length });
        });

        // 健康检查
        app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

        app.Run();
    }
}
