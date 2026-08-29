using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var projects = endpoints.MapGroup("/api/v1/projects");
        projects.MapGet("", ListProjectsAsync);
        projects.MapPost("", CreateProjectAsync).RequireAuthorization("Engineer");
        projects.MapGet("/{projectId:guid}", GetProjectAsync);
        projects.MapPost("/{projectId:guid}/components", CreateComponentAsync).RequireAuthorization("Engineer");
        endpoints.MapPost("/api/v1/components/{componentId:guid}/move", MoveComponentAsync).RequireAuthorization("Engineer");
        projects.MapPost("/{projectId:guid}/clone-preview", ClonePreviewAsync).RequireAuthorization("Engineer");
        projects.MapPost("/{projectId:guid}/clone", CloneAsync).RequireAuthorization("Engineer");
        projects.MapGet("/{projectId:guid}/baselines", ListBaselinesAsync);
        projects.MapPost("/{projectId:guid}/baselines", CreateBaselineAsync).RequireAuthorization("SeniorEngineer");
        projects.MapGet("/{projectId:guid}/standard", GetProjectStandardAsync);
        projects.MapPost("/{projectId:guid}/standard", AssignProjectStandardAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapPost("/api/v1/baselines/{baselineId:guid}/release", ReleaseBaselineAsync).RequireAuthorization("SeniorEngineer");

        endpoints.MapPost("/api/v1/components/{componentId:guid}/versions", CreateVersionAsync).RequireAuthorization("Engineer");
        endpoints.MapPost("/api/v1/component-versions/{versionId:guid}/maturity", ChangeMaturityAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapPost("/api/v1/component-versions/{versionId:guid}/safety", ChangeSafetyAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapPost("/api/v1/component-versions/{versionId:guid}/recommend", RecommendAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapGet("/api/v1/audit", ListAuditEventsAsync);
        return endpoints;
    }

    private static async Task<IResult> ListProjectsAsync(
        IDbContextFactory<ConfigHubDbContext> contextFactory,
        CancellationToken cancellationToken)
    {
        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        var projects = await database.Projects.AsNoTracking()
            .OrderBy(project => project.Code)
            .Select(project => new
            {
                id = project.Id,
                code = project.Code,
                name = project.Name,
                description = project.Description,
                status = project.Status.ToString(),
                updatedAt = project.UpdatedAt,
                componentCount = database.ConfigurationComponents.Count(component => component.ProjectId == project.Id)
            })
            .ToListAsync(cancellationToken);
        return TypedResults.Ok(projects);
    }

    private static async Task<IResult> GetProjectAsync(
        Guid projectId,
        IDbContextFactory<ConfigHubDbContext> contextFactory,
        CancellationToken cancellationToken)
    {
        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        var project = await database.Projects.AsNoTracking()
            .Where(candidate => candidate.Id == projectId)
            .Select(candidate => new
            {
                id = candidate.Id,
                code = candidate.Code,
                name = candidate.Name,
                description = candidate.Description,
                status = candidate.Status.ToString(),
                createdAt = candidate.CreatedAt,
                updatedAt = candidate.UpdatedAt
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (project is null)
        {
            return Results.NotFound();
        }

        var components = await database.ConfigurationComponents.AsNoTracking()
            .Where(component => component.ProjectId == projectId)
            .OrderBy(component => component.SortOrder)
            .ThenBy(component => component.ComponentCode)
            .Select(component => new
            {
                id = component.Id,
                parentComponentId = component.ParentComponentId,
                code = component.ComponentCode,
                name = component.Name,
                sortOrder = component.SortOrder,
                versions = database.ComponentVersions
                    .Where(version => version.ComponentId == component.Id)
                    .OrderByDescending(version => version.SequenceNo)
                    .Select(version => new
                    {
                        id = version.Id,
                        versionNumber = version.VersionNumber,
                        sequenceNo = version.SequenceNo,
                        maturity = version.Maturity.ToString(),
                        safety = version.Safety.ToString(),
                        createdAt = version.CreatedAt
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);
        return TypedResults.Ok(new { project, components });
    }

    private static async Task<IResult> ClonePreviewAsync(Guid projectId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var project = await database.Projects.AsNoTracking().SingleOrDefaultAsync(item => item.Id == projectId, cancellationToken);
        if (project is null) return Results.NotFound();
        var components = await database.ConfigurationComponents.CountAsync(item => item.ProjectId == projectId, cancellationToken);
        var versions = await database.ConfigurationComponents.Where(item => item.ProjectId == projectId).Join(database.ComponentVersions, component => component.Id, version => version.ComponentId, (_, _) => 1).CountAsync(cancellationToken);
        return TypedResults.Ok(new { sourceProject = project.Code, copiedComponents = components, excludedVersions = versions, excludedBaselines = true, excludedMachines = true });
    }

    private static async Task<IResult> CloneAsync(Guid projectId, CloneProjectRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        var validation = ValidateIdentifier(request.Code, "项目编码", 50) ?? ValidateRequired(request.Name, "项目名称", 200) ?? ValidateRequired(request.Reason, "克隆原因", 500);
        if (validation is not null) return Results.ValidationProblem(validation);
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var source = await database.Projects.SingleOrDefaultAsync(item => item.Id == projectId, cancellationToken);
        if (source is null) return Results.NotFound();
        var normalizedCode = Normalize(request.Code!);
        if (await database.Projects.AnyAsync(item => item.NormalizedCode == normalizedCode, cancellationToken)) return Results.Conflict(new { message = "项目编码已存在。" });
        var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
        var now = DateTimeOffset.UtcNow;
        var target = new Project { Id = Guid.NewGuid(), Code = request.Code!.Trim(), NormalizedCode = normalizedCode, Name = request.Name!.Trim(), Description = source.Description, CreatedAt = now, UpdatedAt = now };
        var sourceComponents = await database.ConfigurationComponents.AsNoTracking().Where(item => item.ProjectId == projectId).OrderBy(item => item.LineageKey).ToListAsync(cancellationToken);
        var ids = sourceComponents.ToDictionary(item => item.Id, _ => Guid.NewGuid());
        foreach (var sourceComponent in sourceComponents)
        {
            database.ConfigurationComponents.Add(new ConfigurationComponent { Id = ids[sourceComponent.Id], ProjectId = target.Id, ParentComponentId = sourceComponent.ParentComponentId is null ? null : ids[sourceComponent.ParentComponentId.Value], ComponentCode = sourceComponent.ComponentCode, NormalizedComponentCode = sourceComponent.NormalizedComponentCode, LineageKey = sourceComponent.LineageKey, Name = sourceComponent.Name, SortOrder = sourceComponent.SortOrder, CreatedAt = now });
        }
        database.Projects.Add(target);
        AddAuditEvent(database, context, "ProjectCloned", "Project", target.Id, new { sourceProjectId = source.Id, reason = request.Reason!.Trim(), actor });
        await database.SaveChangesAsync(cancellationToken);
        return TypedResults.Created($"/api/v1/projects/{target.Id}", new { id = target.Id });
    }

    private static async Task<IResult> ListBaselinesAsync(Guid projectId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var baselines = await database.ConfigurationBaselines.AsNoTracking()
            .Where(item => item.ProjectId == projectId)
            .OrderByDescending(item => item.CreatedAt)
            .Select(item => new
            {
                id = item.Id,
                code = item.BaselineCode,
                revisionNo = item.RevisionNo,
                seriesCode = database.BaselineSeries.Where(series => series.Id == item.BaselineSeriesId).Select(series => series.SeriesCode).Single(),
                state = item.State.ToString(),
                itemCount = database.BaselineItems.Count(baselineItem => baselineItem.ConfigurationBaselineId == item.Id),
                createdAt = item.CreatedAt
            })
            .ToListAsync(cancellationToken);
        return TypedResults.Ok(baselines);
    }

    private static async Task<IResult> CreateBaselineAsync(
        Guid projectId,
        CreateBaselineRequest request,
        HttpContext context,
        IDbContextFactory<ConfigHubDbContext> factory,
        CancellationToken cancellationToken)
    {
        var validation = ValidateIdentifier(request.SeriesCode, "基线系列编码", 80)
            ?? ValidateIdentifier(request.BaselineCode, "基线编码", 100)
            ?? ValidateRequired(request.Reason, "创建原因", 500);
        if (validation is not null) return Results.ValidationProblem(validation);

        var idempotencyKey = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(idempotencyKey) || idempotencyKey.Length > 200)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["创建基线必须提供不超过 200 个字符的 Idempotency-Key。"] });

        var now = DateTimeOffset.UtcNow;
        var requestHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var scope = $"baselines.create:{projectId}";
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var existing = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == idempotencyKey, cancellationToken);
        if (existing is not null)
        {
            if (existing.RequestHash != requestHash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" });
            if (existing.Result is not null) return TypedResults.Ok(existing.Result.RootElement.Clone());
            return Results.Conflict(new { message = "该请求仍在处理。" });
        }

        if (!await database.Projects.AnyAsync(item => item.Id == projectId, cancellationToken)) return Results.NotFound();
        var normalizedCode = Normalize(request.BaselineCode!);
        if (await database.ConfigurationBaselines.AnyAsync(item => item.ProjectId == projectId && item.NormalizedBaselineCode == normalizedCode, cancellationToken))
            return Results.Conflict(new { message = "该项目中的基线编码已存在。" });

        var components = await database.ConfigurationComponents
            .Where(item => item.ProjectId == projectId)
            .OrderBy(item => item.LineageKey)
            .ToListAsync(cancellationToken);
        if (components.Count == 0) return Results.Conflict(new { message = "基线必须从至少一个组件开始创建。" });
        var componentIds = components.Select(item => item.Id).ToArray();
        var versions = await database.ComponentVersions
            .Where(item => componentIds.Contains(item.ComponentId))
            .OrderByDescending(item => item.SequenceNo)
            .ToListAsync(cancellationToken);
        var versionsByComponent = versions.GroupBy(item => item.ComponentId).ToDictionary(group => group.Key, group => group.First());
        var missing = components.Where(item => !versionsByComponent.ContainsKey(item.Id)).Select(item => item.ComponentCode).ToArray();
        if (missing.Length > 0) return Results.Conflict(new { message = $"以下组件没有可快照的版本：{string.Join("、", missing)}。" });

        var normalizedSeries = Normalize(request.SeriesCode!);
        var series = await database.BaselineSeries.SingleOrDefaultAsync(item => item.ProjectId == projectId && item.NormalizedSeriesCode == normalizedSeries, cancellationToken);
        var nextRevision = series is null
            ? 1
            : (await database.ConfigurationBaselines.Where(item => item.BaselineSeriesId == series.Id).Select(item => (int?)item.RevisionNo).MaxAsync(cancellationToken) ?? 0) + 1;
        series ??= new BaselineSeries { Id = Guid.NewGuid(), ProjectId = projectId, SeriesCode = request.SeriesCode!.Trim(), NormalizedSeriesCode = normalizedSeries, CreatedAt = now };
        var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
        var baseline = new ConfigurationBaseline
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            BaselineSeriesId = series.Id,
            BaselineCode = request.BaselineCode!.Trim(),
            NormalizedBaselineCode = normalizedCode,
            RevisionNo = nextRevision,
            Description = NormalizeOptional(request.Description, 2000),
            CreatedBy = actor,
            CreatedAt = now
        };
        var baselineItemIds = components.ToDictionary(item => item.Id, _ => Guid.NewGuid());

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = idempotencyKey, RequestHash = requestHash, CreatedAt = now, ExpiresAt = now.AddDays(7) });
        if (database.Entry(series).State == EntityState.Detached) database.BaselineSeries.Add(series);
        database.ConfigurationBaselines.Add(baseline);
        foreach (var component in components)
        {
            database.BaselineItems.Add(new BaselineItem
            {
                Id = baselineItemIds[component.Id],
                ConfigurationBaselineId = baseline.Id,
                ConfigurationComponentId = component.Id,
                ComponentVersionId = versionsByComponent[component.Id].Id,
                ParentBaselineItemId = component.ParentComponentId is null ? null : baselineItemIds[component.ParentComponentId.Value],
                ComponentCodeSnapshot = component.ComponentCode,
                ComponentNameSnapshot = component.Name,
                LineageKeySnapshot = component.LineageKey,
                SortOrder = component.SortOrder
            });
        }
        AddAuditEvent(database, context, "BaselineDraftCreated", "ConfigurationBaseline", baseline.Id, new { baseline.BaselineCode, baseline.RevisionNo, baseline.BaselineSeriesId, reason = request.Reason!.Trim(), itemCount = components.Count });
        await database.SaveChangesAsync(cancellationToken);
        var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == idempotencyKey, cancellationToken);
        record.Status = IdempotencyRecordStatus.Completed;
        record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = baseline.Id, revisionNo = baseline.RevisionNo, itemCount = components.Count }));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return TypedResults.Created($"/api/v1/baselines/{baseline.Id}", new { id = baseline.Id, revisionNo = baseline.RevisionNo, itemCount = components.Count });
    }

    private static async Task<IResult> ReleaseBaselineAsync(
        Guid baselineId,
        LifecycleRequest request,
        HttpContext context,
        IDbContextFactory<ConfigHubDbContext> factory,
        CancellationToken cancellationToken)
    {
        var validation = ValidateRequired(request.Reason, "发布原因", 500);
        if (validation is not null) return Results.ValidationProblem(validation);
        var idempotencyKey = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(idempotencyKey) || idempotencyKey.Length > 200)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["发布基线必须提供不超过 200 个字符的 Idempotency-Key。"] });

        var now = DateTimeOffset.UtcNow;
        var scope = $"baselines.release:{baselineId}";
        var requestHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var existing = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == idempotencyKey, cancellationToken);
        if (existing is not null)
        {
            if (existing.RequestHash != requestHash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" });
            if (existing.Result is not null) return TypedResults.Ok(existing.Result.RootElement.Clone());
            return Results.Conflict(new { message = "该请求仍在处理。" });
        }

        var baseline = await database.ConfigurationBaselines.SingleOrDefaultAsync(item => item.Id == baselineId, cancellationToken);
        if (baseline is null) return Results.NotFound();
        if (baseline.State != BaselineState.Draft) return Results.Conflict(new { message = "只有草稿基线可以发布。" });
        var itemCount = await database.BaselineItems.CountAsync(item => item.ConfigurationBaselineId == baselineId, cancellationToken);
        if (itemCount == 0) return Results.Conflict(new { message = "空基线不能发布。" });
        var blocked = await database.BaselineItems
            .Where(item => item.ConfigurationBaselineId == baselineId)
            .Join(database.ComponentVersions, item => item.ComponentVersionId, version => version.Id, (_, version) => version)
            .AnyAsync(version => version.Safety == VersionSafety.Blocked, cancellationToken);
        if (blocked) return Results.Conflict(new { message = "包含已阻断版本的基线不能发布。" });

        var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = idempotencyKey, RequestHash = requestHash, CreatedAt = now, ExpiresAt = now.AddDays(7) });
        baseline.State = BaselineState.Released;
        baseline.ReleasedBy = actor;
        baseline.ReleasedAt = now;
        baseline.ReleaseReason = request.Reason!.Trim();
        database.BaselineLifecycleTransitions.Add(new BaselineLifecycleTransition { Id = Guid.NewGuid(), ConfigurationBaselineId = baseline.Id, FromState = BaselineState.Draft.ToString(), ToState = BaselineState.Released.ToString(), Reason = baseline.ReleaseReason, Actor = actor, OccurredAt = now });
        AddAuditEvent(database, context, "BaselineReleased", "ConfigurationBaseline", baseline.Id, new { baseline.BaselineCode, reason = baseline.ReleaseReason, itemCount });
        await database.SaveChangesAsync(cancellationToken);
        var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == idempotencyKey, cancellationToken);
        record.Status = IdempotencyRecordStatus.Completed;
        record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = baseline.Id, state = baseline.State.ToString(), releasedAt = baseline.ReleasedAt }));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return TypedResults.Ok(new { id = baseline.Id, state = baseline.State.ToString(), releasedAt = baseline.ReleasedAt });
    }

    private static async Task<IResult> GetProjectStandardAsync(Guid projectId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var current = await database.ProjectStandardAssignments.AsNoTracking()
            .Where(item => item.ProjectId == projectId && item.ValidTo == null)
            .Select(item => new { baselineId = item.ConfigurationBaselineId, validFrom = item.ValidFrom, baselineCode = database.ConfigurationBaselines.Where(baseline => baseline.Id == item.ConfigurationBaselineId).Select(baseline => baseline.BaselineCode).Single() })
            .SingleOrDefaultAsync(cancellationToken);
        return TypedResults.Ok(current);
    }

    private static async Task<IResult> AssignProjectStandardAsync(Guid projectId, AssignProjectStandardRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        var validation = request.ConfigurationBaselineId == Guid.Empty ? new Dictionary<string, string[]> { ["configurationBaselineId"] = ["必须选择基线。"] } : ValidateRequired(request.Reason, "设置原因", 500);
        if (validation is not null) return Results.ValidationProblem(validation);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["设置项目标准必须提供不超过 200 个字符的 Idempotency-Key。"] });
        var now = DateTimeOffset.UtcNow;
        var scope = $"projects.standard:{projectId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var existing = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (existing is not null)
        {
            if (existing.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" });
            if (existing.Result is not null) return TypedResults.Ok(existing.Result.RootElement.Clone());
            return Results.Conflict(new { message = "该请求仍在处理。" });
        }
        var baseline = await database.ConfigurationBaselines.SingleOrDefaultAsync(item => item.Id == request.ConfigurationBaselineId, cancellationToken);
        if (baseline is null || baseline.ProjectId != projectId) return Results.ValidationProblem(new Dictionary<string, string[]> { ["configurationBaselineId"] = ["基线不存在或不属于该项目。"] });
        if (baseline.State != BaselineState.Released) return Results.Conflict(new { message = "只有已发布基线可以设为项目标准。" });
        var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) });
        var old = await database.ProjectStandardAssignments.SingleOrDefaultAsync(item => item.ProjectId == projectId && item.ValidTo == null, cancellationToken);
        if (old is not null) old.ValidTo = now;
        var assignment = new ProjectStandardAssignment { Id = Guid.NewGuid(), ProjectId = projectId, ConfigurationBaselineId = baseline.Id, ValidFrom = now, AssignedBy = actor, Reason = request.Reason!.Trim() };
        database.ProjectStandardAssignments.Add(assignment);
        AddAuditEvent(database, context, "ProjectStandardAssigned", "Project", projectId, new { baselineId = baseline.Id, reason = assignment.Reason, previousBaselineId = old?.ConfigurationBaselineId });
        await database.SaveChangesAsync(cancellationToken);
        var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        record.Status = IdempotencyRecordStatus.Completed;
        record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = assignment.Id, baselineId = baseline.Id, validFrom = assignment.ValidFrom }));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return TypedResults.Ok(new { id = assignment.Id, baselineId = baseline.Id, validFrom = assignment.ValidFrom });
    }

    private static async Task<IResult> CreateProjectAsync(
        CreateProjectRequest request,
        HttpContext httpContext,
        IDbContextFactory<ConfigHubDbContext> contextFactory,
        CancellationToken cancellationToken)
    {
        var validationError = ValidateIdentifier(request.Code, "项目编码", 50) ?? ValidateRequired(request.Name, "项目名称", 200) ?? ValidateRequired(request.Reason, "创建原因", 500);
        if (validationError is not null)
        {
            return Results.ValidationProblem(validationError);
        }

        var code = request.Code!.Trim();
        var name = request.Name!.Trim();
        var idempotencyKey = httpContext.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(idempotencyKey) || idempotencyKey.Length > 200)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["创建项目必须提供不超过 200 个字符的 Idempotency-Key。"] });
        }

        var now = DateTimeOffset.UtcNow;
        var project = new Project
        {
            Id = Guid.NewGuid(),
            Code = code,
            NormalizedCode = Normalize(code),
            Name = name,
            Description = NormalizeOptional(request.Description, 2000),
            CreatedAt = now,
            UpdatedAt = now
        };

        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        var requestHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var existing = await database.IdempotencyRecords.SingleOrDefaultAsync(record => record.Scope == "projects.create" && record.IdempotencyKey == idempotencyKey, cancellationToken);
        if (existing is not null)
        {
            if (existing.RequestHash != requestHash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" });
            if (existing.Result is not null) return TypedResults.Ok(existing.Result.RootElement.Clone());
            return Results.Conflict(new { message = "该请求仍在处理。" });
        }
        if (await database.Projects.AnyAsync(candidate => candidate.NormalizedCode == project.NormalizedCode, cancellationToken))
        {
            return Results.Conflict(new { message = "项目编码已存在。" });
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = "projects.create", IdempotencyKey = idempotencyKey, RequestHash = requestHash, CreatedAt = now, ExpiresAt = now.AddDays(7) });
        database.Projects.Add(project);
        AddAuditEvent(database, httpContext, "ProjectCreated", "Project", project.Id, new { project.Code, project.Name, reason = request.Reason!.Trim() });
        await database.SaveChangesAsync(cancellationToken);
        var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == "projects.create" && item.IdempotencyKey == idempotencyKey, cancellationToken);
        record.Status = IdempotencyRecordStatus.Completed;
        record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = project.Id }));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return TypedResults.Created($"/api/v1/projects/{project.Id}", new { id = project.Id });
    }

    private static async Task<IResult> ListAuditEventsAsync(
        Guid? entityId,
        IDbContextFactory<ConfigHubDbContext> contextFactory,
        CancellationToken cancellationToken)
    {
        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        var query = database.AuditEvents.AsNoTracking().OrderByDescending(auditEvent => auditEvent.OccurredAt);
        if (entityId is not null)
        {
            query = query.Where(auditEvent => auditEvent.EntityId == entityId).OrderByDescending(auditEvent => auditEvent.OccurredAt);
        }
        var events = await query.Take(50).Select(auditEvent => new
        {
            id = auditEvent.Id,
            actor = auditEvent.Actor,
            action = auditEvent.Action,
            entityType = auditEvent.EntityType,
            entityId = auditEvent.EntityId,
            correlationId = auditEvent.CorrelationId,
            occurredAt = auditEvent.OccurredAt
        }).ToListAsync(cancellationToken);
        return TypedResults.Ok(events);
    }

    private static async Task<IResult> CreateComponentAsync(
        Guid projectId,
        CreateComponentRequest request,
        HttpContext httpContext,
        IDbContextFactory<ConfigHubDbContext> contextFactory,
        CancellationToken cancellationToken)
    {
        var validationError = ValidateIdentifier(request.Code, "组件编码", 80) ?? ValidateRequired(request.Name, "组件名称", 200);
        if (validationError is not null)
        {
            return Results.ValidationProblem(validationError);
        }

        var code = request.Code!.Trim();
        var name = request.Name!.Trim();

        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        if (!await database.Projects.AnyAsync(project => project.Id == projectId, cancellationToken))
        {
            return Results.NotFound();
        }
        var parent = request.ParentComponentId is null
            ? null
            : await database.ConfigurationComponents.SingleOrDefaultAsync(component => component.Id == request.ParentComponentId, cancellationToken);
        if (request.ParentComponentId is not null && (parent is null || parent.ProjectId != projectId))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["parentComponentId"] = ["父组件不存在或不属于该项目。"] });
        }

        var normalizedCode = Normalize(code);
        if (await database.ConfigurationComponents.AnyAsync(
                component => component.ProjectId == projectId && component.NormalizedComponentCode == normalizedCode,
                cancellationToken))
        {
            return Results.Conflict(new { message = "该项目中组件编码已存在。" });
        }

        var maxSortOrder = await database.ConfigurationComponents
            .Where(component => component.ProjectId == projectId && component.ParentComponentId == request.ParentComponentId)
            .Select(component => (int?)component.SortOrder)
            .MaxAsync(cancellationToken) ?? 0;
        var component = new ConfigurationComponent
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            ParentComponentId = request.ParentComponentId,
            ComponentCode = code,
            NormalizedComponentCode = normalizedCode,
            LineageKey = parent is null ? normalizedCode : $"{parent.LineageKey}/{normalizedCode}",
            Name = name,
            SortOrder = maxSortOrder + 1,
            CreatedAt = DateTimeOffset.UtcNow
        };
        database.ConfigurationComponents.Add(component);
        AddAuditEvent(database, httpContext, "ComponentCreated", "ConfigurationComponent", component.Id, new { component.ProjectId, component.ComponentCode, component.Name });
        await database.SaveChangesAsync(cancellationToken);
        return TypedResults.Created($"/api/v1/projects/{projectId}", new { id = component.Id });
    }

    private static async Task<IResult> CreateVersionAsync(
        Guid componentId,
        CreateComponentVersionRequest request,
        HttpContext httpContext,
        IDbContextFactory<ConfigHubDbContext> contextFactory,
        CancellationToken cancellationToken)
    {
        var validationError = ValidateRequired(request.VersionNumber, "版本号", 160);
        if (validationError is not null)
        {
            return Results.ValidationProblem(validationError);
        }

        var versionNumber = request.VersionNumber!.Trim();

        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        var component = await database.ConfigurationComponents.SingleOrDefaultAsync(candidate => candidate.Id == componentId, cancellationToken);
        if (component is null)
        {
            return Results.NotFound();
        }

        var normalizedVersion = Normalize(versionNumber);
        if (await database.ComponentVersions.AnyAsync(
                version => version.ComponentId == componentId && version.NormalizedVersionNumber == normalizedVersion,
                cancellationToken))
        {
            return Results.Conflict(new { message = "该组件版本号已存在。" });
        }

        var nextSequenceNo = (await database.ComponentVersions
            .Where(version => version.ComponentId == componentId)
            .Select(version => (long?)version.SequenceNo)
            .MaxAsync(cancellationToken) ?? 0) + 10;
        var version = new ComponentVersion
        {
            Id = Guid.NewGuid(),
            ComponentId = componentId,
            VersionNumber = versionNumber,
            NormalizedVersionNumber = normalizedVersion,
            SequenceNo = nextSequenceNo,
            CreatedAt = DateTimeOffset.UtcNow
        };
        database.ComponentVersions.Add(version);
        AddAuditEvent(database, httpContext, "ComponentVersionCreated", "ComponentVersion", version.Id, new { version.ComponentId, version.VersionNumber, version.SequenceNo });
        await database.SaveChangesAsync(cancellationToken);
        return TypedResults.Created($"/api/v1/components/{componentId}/versions/{version.Id}", new { id = version.Id, sequenceNo = version.SequenceNo });
    }

    private static async Task<IResult> MoveComponentAsync(Guid componentId, MoveComponentRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["必须提供移动原因。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var component = await database.ConfigurationComponents.SingleOrDefaultAsync(item => item.Id == componentId, cancellationToken);
        if (component is null) return Results.NotFound();
        var parent = request.ParentComponentId is null ? null : await database.ConfigurationComponents.SingleOrDefaultAsync(item => item.Id == request.ParentComponentId, cancellationToken);
        if (request.ParentComponentId is not null && (parent is null || parent.ProjectId != component.ProjectId)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["parentComponentId"] = ["父组件不存在或不属于同一项目。"] });
        if (parent?.Id == component.Id || parent?.LineageKey.StartsWith(component.LineageKey + "/", StringComparison.Ordinal) == true) return Results.Conflict(new { message = "不能将组件移动到自身或其后代。" });
        var oldLineage = component.LineageKey;
        var newLineage = parent is null ? component.NormalizedComponentCode : $"{parent.LineageKey}/{component.NormalizedComponentCode}";
        var descendants = await database.ConfigurationComponents.Where(item => item.ProjectId == component.ProjectId && (item.LineageKey == oldLineage || item.LineageKey.StartsWith(oldLineage + "/"))).ToListAsync(cancellationToken);
        component.ParentComponentId = parent?.Id;
        foreach (var descendant in descendants) descendant.LineageKey = newLineage + descendant.LineageKey[oldLineage.Length..];
        AddAuditEvent(database, context, "ComponentMoved", "ConfigurationComponent", component.Id, new { from = oldLineage, to = newLineage, reason = request.Reason.Trim() });
        await database.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(new { id = component.Id, lineageKey = component.LineageKey });
    }

    private static async Task<IResult> ChangeMaturityAsync(Guid versionId, LifecycleRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<VersionMaturity>(request.State, true, out var next) || string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须提供有效状态和原因。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var version = await database.ComponentVersions.SingleOrDefaultAsync(item => item.Id == versionId, cancellationToken);
        if (version is null) return Results.NotFound();
        if (!IsAllowedMaturityTransition(version.Maturity, next)) return Results.Conflict(new { message = "不允许的成熟度转换。" });
        var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
        var previous = version.Maturity;
        version.Maturity = next;
        database.VersionLifecycleTransitions.Add(new VersionLifecycleTransition { Id = Guid.NewGuid(), ComponentVersionId = version.Id, Axis = LifecycleAxis.Maturity, FromState = previous.ToString(), ToState = next.ToString(), Reason = request.Reason.Trim(), Actor = actor, OccurredAt = DateTimeOffset.UtcNow });
        AddAuditEvent(database, context, "VersionMaturityChanged", "ComponentVersion", version.Id, new { from = previous.ToString(), to = next.ToString(), reason = request.Reason.Trim() });
        await database.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(new { maturity = version.Maturity.ToString(), safety = version.Safety.ToString() });
    }

    private static async Task<IResult> ChangeSafetyAsync(Guid versionId, LifecycleRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<VersionSafety>(request.State, true, out var next) || string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须提供有效状态和原因。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var version = await database.ComponentVersions.SingleOrDefaultAsync(item => item.Id == versionId, cancellationToken);
        if (version is null) return Results.NotFound();
        if (version.Safety == next) return Results.Conflict(new { message = "状态没有变化。" });
        var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
        var previous = version.Safety;
        version.Safety = next;
        database.VersionLifecycleTransitions.Add(new VersionLifecycleTransition { Id = Guid.NewGuid(), ComponentVersionId = version.Id, Axis = LifecycleAxis.Safety, FromState = previous.ToString(), ToState = next.ToString(), Reason = request.Reason.Trim(), Actor = actor, OccurredAt = DateTimeOffset.UtcNow });
        if (next == VersionSafety.Blocked)
        {
            var active = await database.VersionRecommendations.SingleOrDefaultAsync(item => item.ComponentVersionId == version.Id && item.RevokedAt == null, cancellationToken);
            if (active is not null) { active.RevokedAt = DateTimeOffset.UtcNow; active.RevokedBy = actor; active.RevokeReason = "版本已被阻断。"; }
        }
        AddAuditEvent(database, context, "VersionSafetyChanged", "ComponentVersion", version.Id, new { from = previous.ToString(), to = next.ToString(), reason = request.Reason.Trim() });
        await database.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(new { maturity = version.Maturity.ToString(), safety = version.Safety.ToString() });
    }

    private static async Task<IResult> RecommendAsync(Guid versionId, LifecycleRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["必须提供推荐原因。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var version = await database.ComponentVersions.SingleOrDefaultAsync(item => item.Id == versionId, cancellationToken);
        if (version is null) return Results.NotFound();
        if (version.Maturity is not VersionMaturity.Released and not VersionMaturity.Maintenance || version.Safety == VersionSafety.Blocked) return Results.Conflict(new { message = "只有未阻断的已发布或维护版本可以推荐。" });
        var component = await database.ConfigurationComponents.SingleAsync(item => item.Id == version.ComponentId, cancellationToken);
        var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
        var active = await database.VersionRecommendations.SingleOrDefaultAsync(item => item.ComponentId == component.Id && item.RevokedAt == null, cancellationToken);
        if (active is not null) { active.RevokedAt = DateTimeOffset.UtcNow; active.RevokedBy = actor; active.RevokeReason = "被新的推荐替代。"; }
        database.VersionRecommendations.Add(new VersionRecommendation { Id = Guid.NewGuid(), ComponentId = component.Id, ComponentVersionId = version.Id, AssignedBy = actor, Reason = request.Reason.Trim(), AssignedAt = DateTimeOffset.UtcNow });
        AddAuditEvent(database, context, "VersionRecommended", "ComponentVersion", version.Id, new { reason = request.Reason.Trim() });
        await database.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(new { recommended = true });
    }

    private static bool IsAllowedMaturityTransition(VersionMaturity current, VersionMaturity next) =>
        (current, next) switch
        {
            (VersionMaturity.Draft, VersionMaturity.Testing) => true,
            (VersionMaturity.Testing, VersionMaturity.Draft or VersionMaturity.Released) => true,
            (VersionMaturity.Released, VersionMaturity.Maintenance or VersionMaturity.Deprecated) => true,
            (VersionMaturity.Maintenance, VersionMaturity.Deprecated) => true,
            _ => false
        };

    private static Dictionary<string, string[]>? ValidateIdentifier(string? value, string fieldName, int maxLength)
    {
        var required = ValidateRequired(value, fieldName, maxLength);
        if (required is not null)
        {
            return required;
        }
        return value!.Trim().All(character => char.IsLetterOrDigit(character) || character is '-' or '_')
            ? null
            : new Dictionary<string, string[]> { ["code"] = [$"{fieldName}只能包含字母、数字、连字符或下划线。"] };
    }

    private static Dictionary<string, string[]>? ValidateRequired(string? value, string fieldName, int maxLength) =>
        string.IsNullOrWhiteSpace(value) || value.Trim().Length > maxLength
            ? new Dictionary<string, string[]> { ["value"] = [$"{fieldName}为必填项，且不能超过 {maxLength} 个字符。"] }
            : null;

    private static string Normalize(string value) => value.Trim().ToUpperInvariant();

    private static string? NormalizeOptional(string? value, int maxLength) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim()[..Math.Min(value.Trim().Length, maxLength)];

    private static void AddAuditEvent(DbContext database, HttpContext httpContext, string action, string entityType, Guid entityId, object data)
    {
        var actor = httpContext.User.Identity?.Name;
        var correlationId = httpContext.Items["CorrelationId"]?.ToString() ?? httpContext.TraceIdentifier;
        database.Set<AuditEvent>().Add(new AuditEvent
        {
            Id = Guid.NewGuid(),
            Actor = string.IsNullOrWhiteSpace(actor) ? "本机操作员" : actor[..Math.Min(actor.Length, 160)],
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            CorrelationId = correlationId[..Math.Min(correlationId.Length, 128)],
            Data = JsonDocument.Parse(JsonSerializer.Serialize(data)),
            OccurredAt = DateTimeOffset.UtcNow
        });
    }
}

public sealed record CreateProjectRequest(string? Code, string? Name, string? Description, string? Reason);
public sealed record CreateComponentRequest(string? Code, string? Name, Guid? ParentComponentId);
public sealed record CreateComponentVersionRequest(string? VersionNumber);
public sealed record LifecycleRequest(string? State, string? Reason);
public sealed record CloneProjectRequest(string? Code, string? Name, string? Reason);
public sealed record MoveComponentRequest(Guid? ParentComponentId, string? Reason);
public sealed record CreateBaselineRequest(string? SeriesCode, string? BaselineCode, string? Description, string? Reason);
public sealed record AssignProjectStandardRequest(Guid ConfigurationBaselineId, string? Reason);
