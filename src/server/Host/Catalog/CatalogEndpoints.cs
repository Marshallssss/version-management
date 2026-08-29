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
