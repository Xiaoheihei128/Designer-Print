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

        // 健康检查
        app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

        app.Run();
    }
}
