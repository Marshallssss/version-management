using System.Text.Json;
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
        projects.MapPost("", CreateProjectAsync);
        projects.MapGet("/{projectId:guid}", GetProjectAsync);
        projects.MapPost("/{projectId:guid}/components", CreateComponentAsync);

        endpoints.MapPost("/api/v1/components/{componentId:guid}/versions", CreateVersionAsync);
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

    private static async Task<IResult> CreateProjectAsync(
        CreateProjectRequest request,
        HttpContext httpContext,
        IDbContextFactory<ConfigHubDbContext> contextFactory,
        CancellationToken cancellationToken)
    {
        var validationError = ValidateIdentifier(request.Code, "项目编码", 50) ?? ValidateRequired(request.Name, "项目名称", 200);
        if (validationError is not null)
        {
            return Results.ValidationProblem(validationError);
        }

        var code = request.Code!.Trim();
        var name = request.Name!.Trim();

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
        if (await database.Projects.AnyAsync(candidate => candidate.NormalizedCode == project.NormalizedCode, cancellationToken))
        {
            return Results.Conflict(new { message = "项目编码已存在。" });
        }

        database.Projects.Add(project);
        AddAuditEvent(database, httpContext, "ProjectCreated", "Project", project.Id, new { project.Code, project.Name });
        await database.SaveChangesAsync(cancellationToken);
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
        var actor = httpContext.Request.Headers["X-ConfigHub-Actor"].FirstOrDefault();
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

public sealed record CreateProjectRequest(string? Code, string? Name, string? Description);
public sealed record CreateComponentRequest(string? Code, string? Name, Guid? ParentComponentId);
public sealed record CreateComponentVersionRequest(string? VersionNumber);
