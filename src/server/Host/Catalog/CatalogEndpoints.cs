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
        var projects = endpoints.MapGroup("/api/v1/projects").RequireAuthorization();
        projects.MapGet("", ListProjectsAsync);
        projects.MapPost("", CreateProjectAsync).RequireAuthorization("Engineer");
        projects.MapGet("/{projectId:guid}", GetProjectAsync);
        projects.MapPost("/{projectId:guid}/components", CreateComponentAsync).RequireAuthorization("Engineer");
        endpoints.MapPost("/api/v1/components/{componentId:guid}/move", MoveComponentAsync).RequireAuthorization("Engineer");
        projects.MapPost("/{projectId:guid}/clone", CloneAsync).RequireAuthorization("Engineer");
        projects.MapGet("/{projectId:guid}/baselines", ListBaselinesAsync);
        projects.MapGet("/{projectId:guid}/members", ListProjectMembersAsync).RequireAuthorization();
        projects.MapPost("/{projectId:guid}/members", AssignProjectMemberAsync).RequireAuthorization(policy => policy.RequireRole("Admin"));
        projects.MapPost("/{projectId:guid}/baselines", CreateBaselineAsync).RequireAuthorization("SeniorEngineer");
        projects.MapGet("/{projectId:guid}/standard", GetProjectStandardAsync);
        projects.MapPost("/{projectId:guid}/standard", AssignProjectStandardAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapPost("/api/v1/baselines/{baselineId:guid}/release", ReleaseBaselineAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapGet("/api/v1/baselines/{baselineId:guid}", GetBaselineDetailAsync).RequireAuthorization();
        endpoints.MapPost("/api/v1/baselines/{baselineId:guid}/items/{itemId:guid}/requirement", SetBaselineItemRequirementAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapGet("/api/v1/machines", ListMachinesAsync).RequireAuthorization();
        endpoints.MapPost("/api/v1/machines", CreateMachineAsync).RequireAuthorization("Engineer");
        endpoints.MapPost("/api/v1/machines/{machineId:guid}/target", AssignMachineTargetAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapGet("/api/v1/machines/{machineId:guid}/target", GetMachineTargetAsync).RequireAuthorization();
        endpoints.MapPost("/api/v1/machines/{machineId:guid}/facts", RecordFactsAsync).RequireAuthorization("Engineer");
        endpoints.MapGet("/api/v1/machines/{machineId:guid}/configuration", GetMachineConfigurationAsync).RequireAuthorization();
        endpoints.MapGet("/api/v1/machines/{machineId:guid}/facts", ListMachineFactsAsync).RequireAuthorization();
        endpoints.MapGet("/api/v1/machines/{machineId:guid}/drift", GetMachineDriftAsync).RequireAuthorization();
        endpoints.MapGet("/api/v1/machines/{machineId:guid}/drift-summary", GetMachineDriftSummaryAsync).RequireAuthorization();
        endpoints.MapGet("/api/v1/baselines/{leftBaselineId:guid}/compare/{rightBaselineId:guid}", CompareBaselinesAsync).RequireAuthorization();
        endpoints.MapGet("/api/v1/component-versions/{versionId:guid}/impact", GetVersionImpactAsync).RequireAuthorization();
        endpoints.MapGet("/api/v1/component-versions/{versionId:guid}", GetVersionDetailAsync).RequireAuthorization();
        endpoints.MapGet("/api/v1/search", SearchAsync).RequireAuthorization();
        endpoints.MapGet("/api/v1/dashboard", GetDashboardAsync).RequireAuthorization();
        endpoints.MapPost("/api/v1/admin/drift-summaries/rebuild", RebuildMachineDriftSummariesAsync)
            .RequireAuthorization(policy => policy.RequireRole("Admin"));
        endpoints.MapPost("/api/v1/imports", StageImportAsync).RequireAuthorization("Engineer");
        endpoints.MapGet("/api/v1/imports/{batchId:guid}", GetImportPreviewAsync).RequireAuthorization("Engineer");
        endpoints.MapPost("/api/v1/imports/{batchId:guid}/commit", CommitImportAsync).RequireAuthorization("Engineer");

        endpoints.MapPost("/api/v1/components/{componentId:guid}/versions", CreateVersionAsync).RequireAuthorization("Engineer");
        endpoints.MapPost("/api/v1/component-versions/{versionId:guid}/maturity", ChangeMaturityAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapPost("/api/v1/component-versions/{versionId:guid}/safety", ChangeSafetyAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapPost("/api/v1/component-versions/{versionId:guid}/recommend", RecommendAsync).RequireAuthorization("SeniorEngineer");
        endpoints.MapGet("/api/v1/audit", ListAuditEventsAsync).RequireAuthorization();
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

    private static async Task<IResult> ListProjectMembersAsync(Guid projectId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        if (!await database.Projects.AnyAsync(project => project.Id == projectId, cancellationToken)) return Results.NotFound();
        var members = await database.ProjectMemberships.AsNoTracking().Where(member => member.ProjectId == projectId).Join(database.Users.AsNoTracking(), member => member.UserId, user => user.Id, (member, user) => new { id = member.Id, userId = user.Id, email = user.Email, displayName = user.DisplayName, role = member.Role.ToString(), assignedBy = member.AssignedBy, assignedAt = member.AssignedAt }).OrderBy(member => member.email).ToListAsync(cancellationToken);
        return TypedResults.Ok(members);
    }

    private static async Task<IResult> AssignProjectMemberAsync(Guid projectId, AssignProjectMemberRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (request.UserId == Guid.Empty || !Enum.TryParse<ProjectMembershipRole>(request.Role, true, out var role) || string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须提供用户、有效项目角色和原因。"] });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["分配项目成员必须提供不超过 200 个字符的 Idempotency-Key。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken); var scope = $"project-members:{projectId}:{request.UserId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        if (!await database.Projects.AnyAsync(project => project.Id == projectId, cancellationToken) || !await database.Users.AnyAsync(user => user.Id == request.UserId, cancellationToken)) return Results.NotFound();
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); var record = new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }; database.IdempotencyRecords.Add(record); var member = await database.ProjectMemberships.SingleOrDefaultAsync(item => item.ProjectId == projectId && item.UserId == request.UserId, cancellationToken); if (member is null) { member = new ProjectMembership { Id = Guid.NewGuid(), ProjectId = projectId, UserId = request.UserId, Role = role, AssignedBy = context.User.Identity?.Name ?? "", Reason = request.Reason.Trim(), AssignedAt = now }; database.ProjectMemberships.Add(member); } else { member.Role = role; member.AssignedBy = context.User.Identity?.Name ?? ""; member.Reason = request.Reason.Trim(); member.AssignedAt = now; }
        AddAuditEvent(database, context, "ProjectMemberAssigned", "ProjectMembership", member.Id, new { projectId, member.UserId, role = role.ToString(), reason = member.Reason }); await database.SaveChangesAsync(cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = member.Id, userId = member.UserId, role = role.ToString() })); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken); return TypedResults.Ok(new { id = member.Id, userId = member.UserId, role = role.ToString() });
    }

    private static async Task<IResult> ListMachinesAsync(IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        return TypedResults.Ok(await database.Machines.AsNoTracking().OrderBy(item => item.SerialNumber).Select(item => new { id = item.Id, projectId = item.ProjectId, serialNumber = item.SerialNumber, name = item.Name, machineType = item.MachineType, status = item.Status.ToString(), matchStatus = database.MachineDriftSummaries.Where(summary => summary.MachineId == item.Id).Select(summary => (string?)summary.MatchStatus.ToString()).SingleOrDefault(), riskSeverity = database.MachineDriftSummaries.Where(summary => summary.MachineId == item.Id).Select(summary => (string?)summary.RiskSeverity.ToString()).SingleOrDefault() }).ToListAsync(cancellationToken));
    }

    private static async Task<IResult> CreateMachineAsync(CreateMachineRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        var validation = request.ProjectId == Guid.Empty ? new Dictionary<string, string[]> { ["projectId"] = ["必须选择项目。"] } : ValidateRequired(request.SerialNumber, "序列号", 160) ?? ValidateRequired(request.Name, "机台名称", 200) ?? ValidateRequired(request.Reason, "创建原因", 500);
        if (validation is not null) return Results.ValidationProblem(validation);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["创建机台必须提供不超过 200 个字符的 Idempotency-Key。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var scope = $"machines.create:{request.ProjectId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var existing = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (existing is not null) { if (existing.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (existing.Result is not null) return TypedResults.Ok(existing.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        if (!await database.Projects.AnyAsync(item => item.Id == request.ProjectId, cancellationToken)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["projectId"] = ["项目不存在。"] });
        if (!await HasProjectWriteAccessAsync(database, context, request.ProjectId, cancellationToken)) return Results.Forbid();
        var normalized = Normalize(request.SerialNumber!);
        if (await database.Machines.AnyAsync(item => item.NormalizedSerialNumber == normalized, cancellationToken)) return Results.Conflict(new { message = "机台序列号已存在。" });
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }); var machine = new Machine { Id = Guid.NewGuid(), ProjectId = request.ProjectId, SerialNumber = request.SerialNumber!.Trim(), NormalizedSerialNumber = normalized, Name = request.Name!.Trim(), MachineType = NormalizeOptional(request.MachineType, 120), CreatedAt = now };
        database.Machines.Add(machine); AddAuditEvent(database, context, "MachineCreated", "Machine", machine.Id, new { machine.ProjectId, machine.SerialNumber, reason = request.Reason!.Trim() }); await database.SaveChangesAsync(cancellationToken); var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = machine.Id })); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
        return TypedResults.Created($"/api/v1/machines/{machine.Id}", new { id = machine.Id });
    }

    private static async Task<IResult> AssignMachineTargetAsync(Guid machineId, AssignMachineTargetRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (request.ConfigurationBaselineId == Guid.Empty || string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须选择基线并提供原因。"] });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["分配机台目标必须提供不超过 200 个字符的 Idempotency-Key。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var scope = $"machine-targets:{machineId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var existing = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (existing is not null) { if (existing.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (existing.Result is not null) return TypedResults.Ok(existing.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        var machine = await database.Machines.SingleOrDefaultAsync(item => item.Id == machineId, cancellationToken); var baseline = await database.ConfigurationBaselines.SingleOrDefaultAsync(item => item.Id == request.ConfigurationBaselineId, cancellationToken);
        if (machine is null || baseline is null || baseline.ProjectId != machine.ProjectId) return Results.ValidationProblem(new Dictionary<string, string[]> { ["configurationBaselineId"] = ["基线不存在或不属于机台项目。"] });
        if (!await HasProjectWriteAccessAsync(database, context, machine.ProjectId, cancellationToken, requireSeniorMembership: true)) return Results.Forbid();
        if (baseline.State != BaselineState.Released) return Results.Conflict(new { message = "仅可分配已发布基线。" });
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }); var old = await database.MachineTargetAssignments.SingleOrDefaultAsync(item => item.MachineId == machineId && item.ValidTo == null, cancellationToken); if (old is not null) old.ValidTo = now;
        var assignment = new MachineTargetAssignment { Id = Guid.NewGuid(), MachineId = machineId, ConfigurationBaselineId = baseline.Id, ValidFrom = now, AssignedBy = context.User.Identity?.Name ?? "", Reason = request.Reason.Trim() }; database.MachineTargetAssignments.Add(assignment); AddAuditEvent(database, context, "MachineTargetAssigned", "Machine", machineId, new { baselineId = baseline.Id, reason = assignment.Reason }); await database.SaveChangesAsync(cancellationToken); await RefreshMachineDriftSummaryAsync(database, machineId, cancellationToken); var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = assignment.Id, baselineId = baseline.Id })); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken); return TypedResults.Ok(new { id = assignment.Id, baselineId = baseline.Id });
    }

    private static async Task<IResult> GetMachineTargetAsync(Guid machineId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var target = await database.MachineTargetAssignments.AsNoTracking()
            .Where(item => item.MachineId == machineId && item.ValidTo == null)
            .Select(item => new { baselineId = item.ConfigurationBaselineId, validFrom = item.ValidFrom, baselineCode = database.ConfigurationBaselines.Where(baseline => baseline.Id == item.ConfigurationBaselineId).Select(baseline => baseline.BaselineCode).Single() })
            .SingleOrDefaultAsync(cancellationToken);
        return TypedResults.Ok(target);
    }

    private static async Task<IResult> RecordFactsAsync(Guid machineId, RecordFactsRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<DeploymentOperationType>(request.OperationType, true, out var operation) || !Enum.TryParse<ObservationCoverage>(request.Coverage, true, out var coverage) || string.IsNullOrWhiteSpace(request.SourceType) || string.IsNullOrWhiteSpace(request.Reason) || request.Items is null || request.Items.Count == 0) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须提供操作类型、覆盖范围、来源、原因和事实项。"] });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["记录事实必须提供不超过 200 个字符的 Idempotency-Key。"] });
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var scope = $"deployment-facts:{machineId}";
        await using var db = await factory.CreateDbContextAsync(cancellationToken); var existing = await db.IdempotencyRecords.SingleOrDefaultAsync(x => x.Scope == scope && x.IdempotencyKey == key, cancellationToken);
        if (existing is not null) { if (existing.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (existing.Result is not null) return TypedResults.Ok(existing.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        var machine = await db.Machines.SingleOrDefaultAsync(x => x.Id == machineId, cancellationToken); if (machine is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(db, context, machine.ProjectId, cancellationToken)) return Results.Forbid();
        var sourceType = request.SourceType.Trim(); var externalEventId = NormalizeOptional(request.ExternalEventId, 200);
        if (externalEventId is not null && await db.DeploymentBatches.AnyAsync(item => item.SourceType == sourceType && item.ExternalEventId == externalEventId, cancellationToken)) return Results.Conflict(new { message = "该来源的外部事件已记录。" });
        var now = DateTimeOffset.UtcNow; await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken); db.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }); var batch = new DeploymentBatch { Id = Guid.NewGuid(), MachineId = machineId, OperationType = operation, Coverage = coverage, SourceType = sourceType, ExternalEventId = externalEventId, RecordedAt = now, EffectiveAt = request.EffectiveAt ?? now }; db.DeploymentBatches.Add(batch);
        var componentIds = request.Items.Select(x => x.ComponentId).Distinct().ToArray(); var components = await db.ConfigurationComponents.Where(x => x.ProjectId == machine.ProjectId && componentIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, cancellationToken); if (components.Count != componentIds.Length) return Results.ValidationProblem(new Dictionary<string, string[]> { ["items"] = ["存在不属于机台项目的组件。"] });
        var versionIds = request.Items.Where(x => !x.Absent && x.VersionId is not null).Select(x => x.VersionId!.Value).Distinct().ToArray();
        var versions = await db.ComponentVersions.Where(x => versionIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, cancellationToken);
        if (versions.Count != versionIds.Length || request.Items.Any(x => !x.Absent && (x.VersionId is null || versions[x.VersionId.Value].ComponentId != x.ComponentId))) return Results.ValidationProblem(new Dictionary<string, string[]> { ["items"] = ["事实版本必须属于对应组件。"] });
        foreach (var input in request.Items) { var item = new DeploymentItem { Id = Guid.NewGuid(), DeploymentBatchId = batch.Id, ConfigurationComponentId = input.ComponentId, NewComponentVersionId = input.VersionId, Result = input.Absent ? DeploymentItemResult.Absent : DeploymentItemResult.Succeeded, KnownInstalledAt = input.KnownInstalledAt }; db.DeploymentItems.Add(item); await UpsertCurrentAsync(db, machineId, input.ComponentId, input.Absent ? null : input.VersionId, input.Absent, batch.EffectiveAt, input.KnownInstalledAt, item.Id, cancellationToken); }
        if (coverage == ObservationCoverage.Full)
        {
            var allComponentIds = await db.ConfigurationComponents.Where(x => x.ProjectId == machine.ProjectId).Select(x => x.Id).ToListAsync(cancellationToken);
            foreach (var componentId in allComponentIds.Except(componentIds)) { var item = new DeploymentItem { Id = Guid.NewGuid(), DeploymentBatchId = batch.Id, ConfigurationComponentId = componentId, Result = DeploymentItemResult.Absent }; db.DeploymentItems.Add(item); await UpsertCurrentAsync(db, machineId, componentId, null, true, batch.EffectiveAt, null, item.Id, cancellationToken); }
        }
        AddAuditEvent(db, context, "DeploymentFactsRecorded", "DeploymentBatch", batch.Id, new { machineId, batch.OperationType, batch.Coverage, reason = request.Reason.Trim() }); await db.SaveChangesAsync(cancellationToken); await RefreshMachineDriftSummaryAsync(db, machineId, cancellationToken); var record = await db.IdempotencyRecords.SingleAsync(x => x.Scope == scope && x.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = batch.Id })); await db.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken); return TypedResults.Created($"/api/v1/deployment-batches/{batch.Id}", new { id = batch.Id });
    }

    private static async Task<IResult> GetMachineConfigurationAsync(Guid machineId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        return TypedResults.Ok(await db.MachineCurrentConfigurations.AsNoTracking().Where(x => x.MachineId == machineId).OrderBy(x => x.ConfigurationComponentId).Select(x => new { componentId = x.ConfigurationComponentId, versionId = x.ComponentVersionId, state = x.State.ToString(), stateEffectiveAt = x.StateEffectiveAt, knownInstalledAt = x.KnownInstalledAt }).ToListAsync(cancellationToken));
    }

    private static async Task<IResult> ListMachineFactsAsync(Guid machineId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var facts = await db.DeploymentBatches.AsNoTracking().Where(item => item.MachineId == machineId).OrderByDescending(item => item.EffectiveAt).Select(item => new { id = item.Id, operationType = item.OperationType.ToString(), coverage = item.Coverage.ToString(), sourceType = item.SourceType, recordedAt = item.RecordedAt, effectiveAt = item.EffectiveAt, itemCount = db.DeploymentItems.Count(detail => detail.DeploymentBatchId == item.Id) }).ToListAsync(cancellationToken);
        return TypedResults.Ok(facts);
    }

    private static async Task<IResult> GetMachineDriftAsync(Guid machineId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var target = await db.MachineTargetAssignments.AsNoTracking().Where(x => x.MachineId == machineId && x.ValidTo == null).Select(x => x.ConfigurationBaselineId).SingleOrDefaultAsync(cancellationToken);
        if (target == Guid.Empty) return TypedResults.Ok(new { matchStatus = "Unknown", riskSeverity = "High", items = Array.Empty<object>() });
        var expected = await db.BaselineItems.AsNoTracking().Where(x => x.ConfigurationBaselineId == target).ToDictionaryAsync(x => x.ConfigurationComponentId, cancellationToken);
        var actual = await db.MachineCurrentConfigurations.AsNoTracking().Where(x => x.MachineId == machineId).ToDictionaryAsync(x => x.ConfigurationComponentId, cancellationToken);
        var ids = expected.Keys.Union(actual.Keys).ToArray(); var items = new List<object>(); var mismatch = false; var critical = false;
        foreach (var componentId in ids) { expected.TryGetValue(componentId, out var wanted); actual.TryGetValue(componentId, out var found); var status = wanted is null ? "Extra" : found is null || found.State == CurrentConfigurationState.Absent ? "Missing" : wanted.ComponentVersionId == found.ComponentVersionId ? "Matched" : "Mismatch"; if (status != "Matched") mismatch = true; var versionId = found?.ComponentVersionId ?? wanted?.ComponentVersionId; if (versionId is not null && await db.ComponentVersions.AnyAsync(x => x.Id == versionId && x.Safety == VersionSafety.Blocked, cancellationToken)) critical = true; items.Add(new { componentId, status, expectedVersionId = wanted?.ComponentVersionId, actualVersionId = found?.ComponentVersionId }); }
        return TypedResults.Ok(new { matchStatus = mismatch ? "Mismatch" : "Matched", riskSeverity = critical ? "Critical" : "None", items });
    }

    private static async Task<IResult> GetMachineDriftSummaryAsync(Guid machineId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var summary = await db.MachineDriftSummaries.AsNoTracking().SingleOrDefaultAsync(item => item.MachineId == machineId, cancellationToken);
        return summary is null ? Results.NotFound() : TypedResults.Ok(new { matchStatus = summary.MatchStatus.ToString(), riskSeverity = summary.RiskSeverity.ToString(), calculatedAt = summary.CalculatedAt });
    }

    private static async Task<IResult> CompareBaselinesAsync(Guid leftBaselineId, Guid rightBaselineId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        if (leftBaselineId == rightBaselineId) return Results.ValidationProblem(new Dictionary<string, string[]> { ["baseline"] = ["请选择两个不同的基线进行比对。"] });
        var baselines = await db.ConfigurationBaselines.AsNoTracking().Where(item => item.Id == leftBaselineId || item.Id == rightBaselineId).Select(item => new { item.Id, item.ProjectId }).ToListAsync(cancellationToken);
        if (baselines.Count != 2) return Results.NotFound();
        if (baselines[0].ProjectId != baselines[1].ProjectId) return Results.ValidationProblem(new Dictionary<string, string[]> { ["baseline"] = ["仅支持同一项目内的基线比对。"] });
        var left = await db.BaselineItems.AsNoTracking()
            .Where(item => item.ConfigurationBaselineId == leftBaselineId)
            .ToDictionaryAsync(item => item.ConfigurationComponentId, cancellationToken);
        var right = await db.BaselineItems.AsNoTracking()
            .Where(item => item.ConfigurationBaselineId == rightBaselineId)
            .ToDictionaryAsync(item => item.ConfigurationComponentId, cancellationToken);

        if (left.Count == 0 || right.Count == 0)
        {
            return Results.NotFound();
        }

        var items = left.Keys.Union(right.Keys).Select(componentId =>
        {
            left.TryGetValue(componentId, out var before);
            right.TryGetValue(componentId, out var after);
            var status = before is null
                ? "Added"
                : after is null
                    ? "Removed"
                    : before.ComponentVersionId == after.ComponentVersionId
                        ? "Same"
                        : "Changed";
            return new
            {
                componentId,
                status,
                componentCode = before?.ComponentCodeSnapshot ?? after?.ComponentCodeSnapshot,
                componentName = before?.ComponentNameSnapshot ?? after?.ComponentNameSnapshot,
                leftVersionId = before?.ComponentVersionId,
                leftVersionNumber = before?.VersionNumberSnapshot,
                rightVersionId = after?.ComponentVersionId,
                rightVersionNumber = after?.VersionNumberSnapshot
            };
        });

        return TypedResults.Ok(new { leftBaselineId, rightBaselineId, items });
    }

    private static async Task<IResult> GetVersionImpactAsync(Guid versionId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        if (!await db.ComponentVersions.AnyAsync(item => item.Id == versionId, cancellationToken)) return Results.NotFound();
        var baselineIds = await db.BaselineItems.Where(item => item.ComponentVersionId == versionId).Select(item => item.ConfigurationBaselineId).Distinct().ToArrayAsync(cancellationToken);
        var currentMachineIds = await db.MachineCurrentConfigurations.Where(item => item.ComponentVersionId == versionId && item.State == CurrentConfigurationState.Present).Select(item => item.MachineId).Distinct().ToArrayAsync(cancellationToken);
        var targetMachineIds = await db.MachineTargetAssignments.Where(item => item.ValidTo == null && baselineIds.Contains(item.ConfigurationBaselineId)).Select(item => item.MachineId).Distinct().ToArrayAsync(cancellationToken);
        var historicalMachineIds = await db.DeploymentItems.Where(item => item.NewComponentVersionId == versionId).Join(db.DeploymentBatches, item => item.DeploymentBatchId, batch => batch.Id, (item, batch) => batch.MachineId).Distinct().ToArrayAsync(cancellationToken);
        var recentFacts = await db.DeploymentItems.Where(item => item.NewComponentVersionId == versionId).Join(db.DeploymentBatches, item => item.DeploymentBatchId, batch => batch.Id, (item, batch) => new { machineId = batch.MachineId, operationType = batch.OperationType.ToString(), effectiveAt = batch.EffectiveAt }).OrderByDescending(item => item.effectiveAt).Take(20).ToListAsync(cancellationToken);
        return TypedResults.Ok(new { versionId, usedBaselineIds = baselineIds, currentMachineIds, targetMachineIds, historicalMachineIds, recentFacts });
    }

    private static async Task<IResult> GetVersionDetailAsync(Guid versionId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var version = await db.ComponentVersions.AsNoTracking().Where(item => item.Id == versionId).Join(db.ConfigurationComponents.AsNoTracking(), item => item.ComponentId, component => component.Id, (item, component) => new { item, component }).Select(value => new { id = value.item.Id, componentId = value.item.ComponentId, componentCode = value.component.ComponentCode, componentName = value.component.Name, versionNumber = value.item.VersionNumber, sequenceNo = value.item.SequenceNo, maturity = value.item.Maturity.ToString(), safety = value.item.Safety.ToString(), createdAt = value.item.CreatedAt }).SingleOrDefaultAsync(cancellationToken);
        if (version is null) return Results.NotFound();
        var transitions = await db.VersionLifecycleTransitions.AsNoTracking().Where(item => item.ComponentVersionId == versionId).OrderByDescending(item => item.OccurredAt).Select(item => new { axis = item.Axis.ToString(), fromState = item.FromState, toState = item.ToState, reason = item.Reason, actor = item.Actor, occurredAt = item.OccurredAt }).ToListAsync(cancellationToken);
        var recommended = await db.VersionRecommendations.AsNoTracking().AnyAsync(item => item.ComponentVersionId == versionId && item.RevokedAt == null, cancellationToken);
        return TypedResults.Ok(new { version, recommended, transitions });
    }

    private static async Task<IResult> SearchAsync(string? query, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        var term = query?.Trim();
        if (string.IsNullOrWhiteSpace(term) || term.Length < 2) return Results.ValidationProblem(new Dictionary<string, string[]> { ["query"] = ["搜索词至少需要两个字符。"] });
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var pattern = $"%{term}%";
        var projects = await db.Projects.AsNoTracking().Where(item => EF.Functions.ILike(item.Code, pattern) || EF.Functions.ILike(item.Name, pattern)).Select(item => new { type = "Project", id = item.Id, label = item.Code + " · " + item.Name }).Take(20).ToListAsync(cancellationToken);
        var components = await db.ConfigurationComponents.AsNoTracking().Where(item => EF.Functions.ILike(item.ComponentCode, pattern) || EF.Functions.ILike(item.Name, pattern)).Select(item => new { type = "Component", id = item.Id, label = item.ComponentCode + " · " + item.Name }).Take(20).ToListAsync(cancellationToken);
        var versions = await db.ComponentVersions.AsNoTracking().Where(item => EF.Functions.ILike(item.VersionNumber, pattern)).Select(item => new { type = "Version", id = item.Id, label = item.VersionNumber }).Take(20).ToListAsync(cancellationToken);
        var baselines = await db.ConfigurationBaselines.AsNoTracking().Where(item => EF.Functions.ILike(item.BaselineCode, pattern)).Select(item => new { type = "Baseline", id = item.Id, label = item.BaselineCode }).Take(20).ToListAsync(cancellationToken);
        var machines = await db.Machines.AsNoTracking().Where(item => EF.Functions.ILike(item.SerialNumber, pattern) || EF.Functions.ILike(item.Name, pattern)).Select(item => new { type = "Machine", id = item.Id, label = item.SerialNumber + " · " + item.Name }).Take(20).ToListAsync(cancellationToken);
        return TypedResults.Ok(projects.Cast<object>().Concat(components).Concat(versions).Concat(baselines).Concat(machines));
    }

    private static async Task<IResult> GetDashboardAsync(IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var summaries = db.MachineDriftSummaries.AsNoTracking();
        return TypedResults.Ok(new
        {
            machineCount = await db.Machines.CountAsync(cancellationToken),
            matchedCount = await summaries.CountAsync(item => item.MatchStatus == DriftMatchStatus.Matched, cancellationToken),
            mismatchCount = await summaries.CountAsync(item => item.MatchStatus == DriftMatchStatus.Mismatch, cancellationToken),
            unknownCount = await db.Machines.CountAsync(machine => !summaries.Any(summary => summary.MachineId == machine.Id) || summaries.Any(summary => summary.MachineId == machine.Id && summary.MatchStatus == DriftMatchStatus.Unknown), cancellationToken),
            criticalRiskCount = await summaries.CountAsync(item => item.RiskSeverity == DriftRiskSeverity.Critical, cancellationToken)
        });
    }

    private static async Task<IResult> RebuildMachineDriftSummariesAsync(RebuildDriftSummariesRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        var validation = ValidateRequired(request.Reason, "重建原因", 500);
        if (validation is not null) return Results.ValidationProblem(validation);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["重建 Drift Summary 必须提供不超过 200 个字符的 Idempotency-Key。"] });

        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        const string scope = "machine-drift-summaries.rebuild";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null)
        {
            if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" });
            if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone());
            return Results.Conflict(new { message = "该请求仍在处理。" });
        }

        var now = DateTimeOffset.UtcNow;
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var record = new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) };
        database.IdempotencyRecords.Add(record);
        var machineIds = await database.Machines.Select(machine => machine.Id).ToListAsync(cancellationToken);
        foreach (var machineId in machineIds) await RefreshMachineDriftSummaryAsync(database, machineId, cancellationToken);
        AddAuditEvent(database, context, "MachineDriftSummariesRebuilt", "MachineDriftSummaryRebuild", record.Id, new { machineCount = machineIds.Count, reason = request.Reason!.Trim() });
        await database.SaveChangesAsync(cancellationToken);
        record.Status = IdempotencyRecordStatus.Completed;
        record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = record.Id, machineCount = machineIds.Count }));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return TypedResults.Ok(new { id = record.Id, machineCount = machineIds.Count });
    }

    private static async Task<IResult> StageImportAsync(StageImportRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (request.ProjectId == Guid.Empty || string.IsNullOrWhiteSpace(request.SourceFileName) || string.IsNullOrWhiteSpace(request.Reason) || request.Rows is null || request.Rows.Count == 0) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须提供项目、来源文件、原因和至少一行数据。"] });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["生成导入预览必须提供不超过 200 个字符的 Idempotency-Key。"] });
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var scope = $"imports.stage:{request.ProjectId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        if (!await db.Projects.AnyAsync(item => item.Id == request.ProjectId, cancellationToken)) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(db, context, request.ProjectId, cancellationToken)) return Results.Forbid();
        var now = DateTimeOffset.UtcNow; await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken); db.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }); var batch = new ImportBatch { Id = Guid.NewGuid(), ProjectId = request.ProjectId, SourceFileName = request.SourceFileName.Trim(), CreatedBy = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required."), Reason = request.Reason.Trim(), CreatedAt = now };
        var componentCodes = request.Rows.Where(row => !string.IsNullOrWhiteSpace(row.ComponentCode)).Select(row => Normalize(row.ComponentCode!)).Distinct().ToArray();
        var components = await db.ConfigurationComponents.Where(item => item.ProjectId == request.ProjectId && componentCodes.Contains(item.NormalizedComponentCode)).ToDictionaryAsync(item => item.NormalizedComponentCode, cancellationToken);
        var existingVersions = await db.ComponentVersions.Where(item => components.Values.Select(component => component.Id).Contains(item.ComponentId)).Select(item => new { item.ComponentId, item.NormalizedVersionNumber }).ToListAsync(cancellationToken);
        var seen = new HashSet<string>();
        var errors = 0;
        foreach (var row in request.Rows.Select((value, index) => new { value, index }))
        {
            string? error = null;
            if (string.IsNullOrWhiteSpace(row.value.ComponentCode) || string.IsNullOrWhiteSpace(row.value.VersionNumber)) error = "componentCode 和 versionNumber 为必填项。";
            else if (!components.TryGetValue(Normalize(row.value.ComponentCode), out var component)) error = "组件不存在或不属于该项目。";
            else if (existingVersions.Any(version => version.ComponentId == component.Id && version.NormalizedVersionNumber == Normalize(row.value.VersionNumber))) error = "版本已存在。";
            else if (!seen.Add($"{component.Id}:{Normalize(row.value.VersionNumber)}")) error = "同一导入批次中存在重复版本。";
            if (error is not null) errors++;
            db.ImportRows.Add(new ImportRow { Id = Guid.NewGuid(), ImportBatchId = batch.Id, RowNumber = row.index + 1, Payload = JsonDocument.Parse(JsonSerializer.Serialize(row.value)), ValidationError = error });
        }
        batch.Status = errors == 0 ? ImportBatchStatus.Validated : ImportBatchStatus.Staged;
        db.ImportBatches.Add(batch);
        AddAuditEvent(db, context, "ImportStaged", "ImportBatch", batch.Id, new { batch.ProjectId, rowCount = request.Rows.Count, errors, reason = batch.Reason });
        await db.SaveChangesAsync(cancellationToken); var record = await db.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = batch.Id, status = batch.Status.ToString(), rowCount = request.Rows.Count, errorCount = errors })); await db.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
        return TypedResults.Created($"/api/v1/imports/{batch.Id}", new { id = batch.Id, status = batch.Status.ToString(), rowCount = request.Rows.Count, errorCount = errors });
    }

    private static async Task<IResult> GetImportPreviewAsync(Guid batchId, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var batch = await db.ImportBatches.AsNoTracking().SingleOrDefaultAsync(item => item.Id == batchId, cancellationToken);
        if (batch is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(db, context, batch.ProjectId, cancellationToken)) return Results.Forbid();
        var stagedRows = await db.ImportRows.AsNoTracking().Where(item => item.ImportBatchId == batchId).OrderBy(item => item.RowNumber).ToListAsync(cancellationToken);
        var rows = stagedRows.Select(item => new { item.RowNumber, payload = item.Payload.RootElement.Clone(), item.ValidationError });
        return TypedResults.Ok(new { id = batch.Id, status = batch.Status.ToString(), sourceFileName = batch.SourceFileName, rows });
    }

    private static async Task<IResult> CommitImportAsync(Guid batchId, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["提交导入必须提供不超过 200 个字符的 Idempotency-Key。"] });
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var scope = $"imports.commit:{batchId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(batchId.ToString())));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        var batch = await db.ImportBatches.SingleOrDefaultAsync(item => item.Id == batchId, cancellationToken); if (batch is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(db, context, batch.ProjectId, cancellationToken)) return Results.Forbid();
        var rows = await db.ImportRows.Where(item => item.ImportBatchId == batchId).OrderBy(item => item.RowNumber).ToListAsync(cancellationToken);
        if (batch.Status != ImportBatchStatus.Validated || rows.Any(item => item.ValidationError is not null)) return Results.Conflict(new { message = "只有完全通过校验的导入批次可以提交。" });
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        db.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(7) });
        var components = await db.ConfigurationComponents.Where(item => item.ProjectId == batch.ProjectId).ToDictionaryAsync(item => item.NormalizedComponentCode, cancellationToken);
        foreach (var row in rows)
        {
            var value = JsonSerializer.Deserialize<StageImportRow>(row.Payload.RootElement.GetRawText())!;
            var command = await CreateComponentVersionCommandAsync(db, components[Normalize(value.ComponentCode!)].Id, value.VersionNumber!, batch.Reason, context, cancellationToken);
            if (command.Version is null) throw new InvalidOperationException("已验证的导入行在提交时无法创建版本。");
        }
        batch.Status = ImportBatchStatus.Committed;
        AddAuditEvent(db, context, "ImportCommitted", "ImportBatch", batch.Id, new { batch.ProjectId, rowCount = rows.Count });
        await db.SaveChangesAsync(cancellationToken);
        var record = await db.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = batch.Id, committed = rows.Count })); await db.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
        return TypedResults.Ok(new { id = batch.Id, committed = rows.Count });
    }

    private static async Task RefreshMachineDriftSummaryAsync(ConfigHubDbContext db, Guid machineId, CancellationToken cancellationToken)
    {
        var target = await db.MachineTargetAssignments.Where(item => item.MachineId == machineId && item.ValidTo == null).Select(item => item.ConfigurationBaselineId).SingleOrDefaultAsync(cancellationToken);
        var summary = await db.MachineDriftSummaries.FindAsync([machineId], cancellationToken) ?? new MachineDriftSummary { MachineId = machineId };
        if (target == Guid.Empty) { summary.MatchStatus = DriftMatchStatus.Unknown; summary.RiskSeverity = DriftRiskSeverity.High; }
        else
        {
            var expected = await db.BaselineItems.Where(item => item.ConfigurationBaselineId == target).ToDictionaryAsync(item => item.ConfigurationComponentId, cancellationToken);
            var actual = await db.MachineCurrentConfigurations.Where(item => item.MachineId == machineId).ToDictionaryAsync(item => item.ConfigurationComponentId, cancellationToken);
            var versionIds = expected.Values.Select(item => item.ComponentVersionId).Concat(actual.Values.Where(item => item.State != CurrentConfigurationState.Absent && item.ComponentVersionId is not null).Select(item => item.ComponentVersionId!.Value)).ToArray();
            summary.MatchStatus = expected.Keys.Union(actual.Keys).All(componentId => expected.TryGetValue(componentId, out var wanted) && actual.TryGetValue(componentId, out var found) && found.State != CurrentConfigurationState.Absent && wanted.ComponentVersionId == found.ComponentVersionId) ? DriftMatchStatus.Matched : DriftMatchStatus.Mismatch;
            summary.RiskSeverity = await db.ComponentVersions.AnyAsync(item => versionIds.Contains(item.Id) && item.Safety == VersionSafety.Blocked, cancellationToken) ? DriftRiskSeverity.Critical : DriftRiskSeverity.None;
        }
        summary.CalculatedAt = DateTimeOffset.UtcNow;
        if (db.Entry(summary).State == EntityState.Detached) db.MachineDriftSummaries.Add(summary);
    }

    private static async Task UpsertCurrentAsync(ConfigHubDbContext db, Guid machineId, Guid componentId, Guid? versionId, bool absent, DateTimeOffset effectiveAt, DateTimeOffset? knownInstalledAt, Guid sourceItemId, CancellationToken cancellationToken)
    {
        var current = await db.MachineCurrentConfigurations.FindAsync([machineId, componentId], cancellationToken);
        if (current is null) db.MachineCurrentConfigurations.Add(new MachineCurrentConfiguration { MachineId = machineId, ConfigurationComponentId = componentId, ComponentVersionId = versionId, State = absent ? CurrentConfigurationState.Absent : CurrentConfigurationState.Present, StateEffectiveAt = effectiveAt, KnownInstalledAt = knownInstalledAt, SourceDeploymentItemId = sourceItemId });
        else if (effectiveAt >= current.StateEffectiveAt) { current.ComponentVersionId = versionId; current.State = absent ? CurrentConfigurationState.Absent : CurrentConfigurationState.Present; current.StateEffectiveAt = effectiveAt; current.KnownInstalledAt = knownInstalledAt ?? current.KnownInstalledAt; current.SourceDeploymentItemId = sourceItemId; }
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

    private static async Task<IResult> CloneAsync(Guid projectId, CloneProjectRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        var validation = ValidateIdentifier(request.Code, "项目编码", 50) ?? ValidateRequired(request.Name, "项目名称", 200) ?? ValidateRequired(request.Reason, "克隆原因", 500);
        if (validation is not null) return Results.ValidationProblem(validation);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["克隆项目必须提供不超过 200 个字符的 Idempotency-Key。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var scope = $"projects.clone:{projectId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        var source = await database.Projects.SingleOrDefaultAsync(item => item.Id == projectId, cancellationToken);
        if (source is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(database, context, projectId, cancellationToken)) return Results.Forbid();
        var normalizedCode = Normalize(request.Code!);
        if (await database.Projects.AnyAsync(item => item.NormalizedCode == normalizedCode, cancellationToken)) return Results.Conflict(new { message = "项目编码已存在。" });
        var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) });
        var target = new Project { Id = Guid.NewGuid(), Code = request.Code!.Trim(), NormalizedCode = normalizedCode, Name = request.Name!.Trim(), Description = source.Description, CreatedAt = now, UpdatedAt = now };
        var sourceComponents = await database.ConfigurationComponents.AsNoTracking().Where(item => item.ProjectId == projectId).OrderBy(item => item.LineageKey).ToListAsync(cancellationToken);
        var ids = sourceComponents.ToDictionary(item => item.Id, _ => Guid.NewGuid());
        foreach (var sourceComponent in sourceComponents)
        {
            database.ConfigurationComponents.Add(new ConfigurationComponent { Id = ids[sourceComponent.Id], ProjectId = target.Id, ParentComponentId = sourceComponent.ParentComponentId is null ? null : ids[sourceComponent.ParentComponentId.Value], ComponentCode = sourceComponent.ComponentCode, NormalizedComponentCode = sourceComponent.NormalizedComponentCode, LineageKey = sourceComponent.LineageKey, Name = sourceComponent.Name, SortOrder = sourceComponent.SortOrder, CreatedAt = now });
        }
        database.Projects.Add(target);
        AddAuditEvent(database, context, "ProjectCloned", "Project", target.Id, new { sourceProjectId = source.Id, reason = request.Reason!.Trim(), actor });
        await database.SaveChangesAsync(cancellationToken); var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = target.Id })); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
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

    private static async Task<IResult> GetBaselineDetailAsync(Guid baselineId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var baseline = await database.ConfigurationBaselines.AsNoTracking().Where(item => item.Id == baselineId).Select(item => new { id = item.Id, projectId = item.ProjectId, code = item.BaselineCode, seriesCode = database.BaselineSeries.Where(series => series.Id == item.BaselineSeriesId).Select(series => series.SeriesCode).Single(), revisionNo = item.RevisionNo, state = item.State.ToString(), item.Description, item.CreatedBy, item.CreatedAt, item.ReleasedBy, item.ReleasedAt }).SingleOrDefaultAsync(cancellationToken);
        if (baseline is null) return Results.NotFound();
        var items = await database.BaselineItems.AsNoTracking().Where(item => item.ConfigurationBaselineId == baselineId).OrderBy(item => item.LineageKeySnapshot).Select(item => new { id = item.Id, parentItemId = item.ParentBaselineItemId, componentId = item.ConfigurationComponentId, versionId = item.ComponentVersionId, versionNumber = item.VersionNumberSnapshot, componentCode = item.ComponentCodeSnapshot, componentName = item.ComponentNameSnapshot, lineageKey = item.LineageKeySnapshot, requirement = item.Requirement.ToString(), item.SortOrder }).ToListAsync(cancellationToken);
        return TypedResults.Ok(new { baseline, items });
    }

    private static async Task<IResult> SetBaselineItemRequirementAsync(Guid baselineId, Guid itemId, SetBaselineItemRequirementRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<BaselineItemRequirement>(request.Requirement, true, out var requirement) || !Enum.IsDefined(requirement) || string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须提供 Required 或 Optional 和修改原因。"] });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["修改基线项要求必须提供不超过 200 个字符的 Idempotency-Key。"] });
        var scope = $"baselines.items.requirement:{baselineId}:{itemId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null)
        {
            if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" });
            if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone());
            return Results.Conflict(new { message = "该请求仍在处理。" });
        }
        var baseline = await database.ConfigurationBaselines.SingleOrDefaultAsync(item => item.Id == baselineId, cancellationToken);
        if (baseline is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(database, context, baseline.ProjectId, cancellationToken, requireSeniorMembership: true)) return Results.Forbid();
        if (baseline.State != BaselineState.Draft) return Results.Conflict(new { message = "仅可修改草稿基线的必需性。发布后请创建新的 Revision。" });
        var item = await database.BaselineItems.SingleOrDefaultAsync(candidate => candidate.Id == itemId && candidate.ConfigurationBaselineId == baselineId, cancellationToken);
        if (item is null) return Results.NotFound();

        var now = DateTimeOffset.UtcNow;
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var record = new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) };
        database.IdempotencyRecords.Add(record);
        var previous = item.Requirement;
        item.Requirement = requirement;
        AddAuditEvent(database, context, "BaselineItemRequirementChanged", "BaselineItem", item.Id, new { baselineId, item.ConfigurationComponentId, from = previous.ToString(), to = requirement.ToString(), reason = request.Reason.Trim() });
        await database.SaveChangesAsync(cancellationToken);
        record.Status = IdempotencyRecordStatus.Completed;
        record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = item.Id, requirement = item.Requirement.ToString() }));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return TypedResults.Ok(new { id = item.Id, requirement = item.Requirement.ToString() });
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
        if (!await HasProjectWriteAccessAsync(database, context, projectId, cancellationToken, requireSeniorMembership: true)) return Results.Forbid();
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
                VersionNumberSnapshot = versionsByComponent[component.Id].VersionNumber,
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
        if (!await HasProjectWriteAccessAsync(database, context, baseline.ProjectId, cancellationToken, requireSeniorMembership: true)) return Results.Forbid();
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
        if (!await HasProjectWriteAccessAsync(database, context, projectId, cancellationToken, requireSeniorMembership: true)) return Results.Forbid();
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
        var validationError = ValidateIdentifier(request.Code, "组件编码", 80) ?? ValidateRequired(request.Name, "组件名称", 200) ?? ValidateRequired(request.Reason, "创建原因", 500);
        if (validationError is not null)
        {
            return Results.ValidationProblem(validationError);
        }

        var code = request.Code!.Trim();
        var name = request.Name!.Trim();
        var key = httpContext.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["创建组件必须提供不超过 200 个字符的 Idempotency-Key。"] });

        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        var scope = $"components.create:{projectId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var existing = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (existing is not null) { if (existing.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (existing.Result is not null) return TypedResults.Ok(existing.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        if (!await database.Projects.AnyAsync(project => project.Id == projectId, cancellationToken))
        {
            return Results.NotFound();
        }
        if (!await HasProjectWriteAccessAsync(database, httpContext, projectId, cancellationToken)) return Results.Forbid();
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
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }); var component = new ConfigurationComponent
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            ParentComponentId = request.ParentComponentId,
            ComponentCode = code,
            NormalizedComponentCode = normalizedCode,
            LineageKey = parent is null ? normalizedCode : $"{parent.LineageKey}/{normalizedCode}",
            Name = name,
            SortOrder = maxSortOrder + 1,
            CreatedAt = now
        };
        database.ConfigurationComponents.Add(component);
        AddAuditEvent(database, httpContext, "ComponentCreated", "ConfigurationComponent", component.Id, new { component.ProjectId, component.ComponentCode, component.Name, reason = request.Reason!.Trim() });
        await database.SaveChangesAsync(cancellationToken); var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = component.Id })); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
        return TypedResults.Created($"/api/v1/projects/{projectId}", new { id = component.Id });
    }

    private static async Task<IResult> CreateVersionAsync(
        Guid componentId,
        CreateComponentVersionRequest request,
        HttpContext httpContext,
        IDbContextFactory<ConfigHubDbContext> contextFactory,
        CancellationToken cancellationToken)
    {
        var validationError = ValidateRequired(request.VersionNumber, "版本号", 160) ?? ValidateRequired(request.Reason, "创建原因", 500);
        if (validationError is not null)
        {
            return Results.ValidationProblem(validationError);
        }

        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        var key = httpContext.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["创建版本必须提供不超过 200 个字符的 Idempotency-Key。"] });
        var scope = $"versions.create:{componentId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        var component = await database.ConfigurationComponents.SingleOrDefaultAsync(item => item.Id == componentId, cancellationToken);
        if (component is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(database, httpContext, component.ProjectId, cancellationToken)) return Results.Forbid();
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }); var result = await CreateComponentVersionCommandAsync(database, componentId, request.VersionNumber!.Trim(), request.Reason!.Trim(), httpContext, cancellationToken);
        if (result.ComponentMissing) return Results.NotFound();
        if (result.Duplicate) return Results.Conflict(new { message = "该组件版本号已存在。" });
        var version = result.Version!;
        await database.SaveChangesAsync(cancellationToken); var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = version.Id, sequenceNo = version.SequenceNo })); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
        return TypedResults.Created($"/api/v1/components/{componentId}/versions/{version.Id}", new { id = version.Id, sequenceNo = version.SequenceNo });
    }

    private static async Task<VersionCommandResult> CreateComponentVersionCommandAsync(ConfigHubDbContext database, Guid componentId, string versionNumber, string reason, HttpContext context, CancellationToken cancellationToken)
    {
        var component = await database.ConfigurationComponents.SingleOrDefaultAsync(candidate => candidate.Id == componentId, cancellationToken);
        if (component is null) return new VersionCommandResult(null, true, false);
        var normalizedVersion = Normalize(versionNumber);
        if (await database.ComponentVersions.AnyAsync(version => version.ComponentId == componentId && version.NormalizedVersionNumber == normalizedVersion, cancellationToken)) return new VersionCommandResult(null, false, true);
        var sequenceNo = (await database.ComponentVersions.Where(version => version.ComponentId == componentId).Select(version => (long?)version.SequenceNo).MaxAsync(cancellationToken) ?? 0) + 10;
        var version = new ComponentVersion { Id = Guid.NewGuid(), ComponentId = componentId, VersionNumber = versionNumber, NormalizedVersionNumber = normalizedVersion, SequenceNo = sequenceNo, CreatedAt = DateTimeOffset.UtcNow };
        database.ComponentVersions.Add(version);
        AddAuditEvent(database, context, "ComponentVersionCreated", "ComponentVersion", version.Id, new { version.ComponentId, version.VersionNumber, version.SequenceNo, reason });
        return new VersionCommandResult(version, false, false);
    }

    private static async Task<IResult> MoveComponentAsync(Guid componentId, MoveComponentRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["必须提供移动原因。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["移动组件必须提供不超过 200 个字符的 Idempotency-Key。"] });
        var scope = $"components.move:{componentId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        var component = await database.ConfigurationComponents.SingleOrDefaultAsync(item => item.Id == componentId, cancellationToken);
        if (component is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(database, context, component.ProjectId, cancellationToken)) return Results.Forbid();
        var parent = request.ParentComponentId is null ? null : await database.ConfigurationComponents.SingleOrDefaultAsync(item => item.Id == request.ParentComponentId, cancellationToken);
        if (request.ParentComponentId is not null && (parent is null || parent.ProjectId != component.ProjectId)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["parentComponentId"] = ["父组件不存在或不属于同一项目。"] });
        if (parent?.Id == component.Id || parent?.LineageKey.StartsWith(component.LineageKey + "/", StringComparison.Ordinal) == true) return Results.Conflict(new { message = "不能将组件移动到自身或其后代。" });
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }); var oldLineage = component.LineageKey;
        var newLineage = parent is null ? component.NormalizedComponentCode : $"{parent.LineageKey}/{component.NormalizedComponentCode}";
        var descendants = await database.ConfigurationComponents.Where(item => item.ProjectId == component.ProjectId && (item.LineageKey == oldLineage || item.LineageKey.StartsWith(oldLineage + "/"))).ToListAsync(cancellationToken);
        component.ParentComponentId = parent?.Id;
        foreach (var descendant in descendants) descendant.LineageKey = newLineage + descendant.LineageKey[oldLineage.Length..];
        AddAuditEvent(database, context, "ComponentMoved", "ConfigurationComponent", component.Id, new { from = oldLineage, to = newLineage, reason = request.Reason.Trim() });
        await database.SaveChangesAsync(cancellationToken); var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = component.Id, lineageKey = component.LineageKey })); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
        return TypedResults.Ok(new { id = component.Id, lineageKey = component.LineageKey });
    }

    private static async Task<IResult> ChangeMaturityAsync(Guid versionId, LifecycleRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<VersionMaturity>(request.State, true, out var next) || string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须提供有效状态和原因。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["修改版本成熟度必须提供不超过 200 个字符的 Idempotency-Key。"] });
        var scope = $"versions.maturity:{versionId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        var version = await database.ComponentVersions.SingleOrDefaultAsync(item => item.Id == versionId, cancellationToken);
        if (version is null) return Results.NotFound();
        var component = await database.ConfigurationComponents.SingleAsync(item => item.Id == version.ComponentId, cancellationToken);
        if (!await HasProjectWriteAccessAsync(database, context, component.ProjectId, cancellationToken, requireSeniorMembership: true)) return Results.Forbid();
        if (!IsAllowedMaturityTransition(version.Maturity, next)) return Results.Conflict(new { message = "不允许的成熟度转换。" });
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }); var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
        var previous = version.Maturity;
        version.Maturity = next;
        database.VersionLifecycleTransitions.Add(new VersionLifecycleTransition { Id = Guid.NewGuid(), ComponentVersionId = version.Id, Axis = LifecycleAxis.Maturity, FromState = previous.ToString(), ToState = next.ToString(), Reason = request.Reason.Trim(), Actor = actor, OccurredAt = DateTimeOffset.UtcNow });
        AddAuditEvent(database, context, "VersionMaturityChanged", "ComponentVersion", version.Id, new { from = previous.ToString(), to = next.ToString(), reason = request.Reason.Trim() });
        await database.SaveChangesAsync(cancellationToken); var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { maturity = version.Maturity.ToString(), safety = version.Safety.ToString() })); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
        return TypedResults.Ok(new { maturity = version.Maturity.ToString(), safety = version.Safety.ToString() });
    }

    private static async Task<IResult> ChangeSafetyAsync(Guid versionId, LifecycleRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<VersionSafety>(request.State, true, out var next) || string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须提供有效状态和原因。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["修改版本安全状态必须提供不超过 200 个字符的 Idempotency-Key。"] });
        var scope = $"versions.safety:{versionId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        var version = await database.ComponentVersions.SingleOrDefaultAsync(item => item.Id == versionId, cancellationToken);
        if (version is null) return Results.NotFound();
        var component = await database.ConfigurationComponents.SingleAsync(item => item.Id == version.ComponentId, cancellationToken);
        if (!await HasProjectWriteAccessAsync(database, context, component.ProjectId, cancellationToken, requireSeniorMembership: true)) return Results.Forbid();
        if (version.Safety == next) return Results.Conflict(new { message = "状态没有变化。" });
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }); var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
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
        var machineIds = await database.MachineCurrentConfigurations.Where(item => item.ComponentVersionId == version.Id).Select(item => item.MachineId).Union(database.BaselineItems.Where(item => item.ComponentVersionId == version.Id).Join(database.MachineTargetAssignments.Where(item => item.ValidTo == null), item => item.ConfigurationBaselineId, assignment => assignment.ConfigurationBaselineId, (_, assignment) => assignment.MachineId)).Distinct().ToListAsync(cancellationToken);
        foreach (var machineId in machineIds) await RefreshMachineDriftSummaryAsync(database, machineId, cancellationToken);
        var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { maturity = version.Maturity.ToString(), safety = version.Safety.ToString() })); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
        return TypedResults.Ok(new { maturity = version.Maturity.ToString(), safety = version.Safety.ToString() });
    }

    private static async Task<IResult> RecommendAsync(Guid versionId, LifecycleRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["必须提供推荐原因。"] });
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["设置版本推荐必须提供不超过 200 个字符的 Idempotency-Key。"] });
        var scope = $"versions.recommend:{versionId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        var version = await database.ComponentVersions.SingleOrDefaultAsync(item => item.Id == versionId, cancellationToken);
        if (version is null) return Results.NotFound();
        var component = await database.ConfigurationComponents.SingleAsync(item => item.Id == version.ComponentId, cancellationToken);
        if (!await HasProjectWriteAccessAsync(database, context, component.ProjectId, cancellationToken, requireSeniorMembership: true)) return Results.Forbid();
        if (version.Maturity is not VersionMaturity.Released and not VersionMaturity.Maintenance || version.Safety == VersionSafety.Blocked) return Results.Conflict(new { message = "只有未阻断的已发布或维护版本可以推荐。" });
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); database.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }); var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
        var active = await database.VersionRecommendations.SingleOrDefaultAsync(item => item.ComponentId == component.Id && item.RevokedAt == null, cancellationToken);
        if (active is not null) { active.RevokedAt = DateTimeOffset.UtcNow; active.RevokedBy = actor; active.RevokeReason = "被新的推荐替代。"; }
        database.VersionRecommendations.Add(new VersionRecommendation { Id = Guid.NewGuid(), ComponentId = component.Id, ComponentVersionId = version.Id, AssignedBy = actor, Reason = request.Reason.Trim(), AssignedAt = now });
        AddAuditEvent(database, context, "VersionRecommended", "ComponentVersion", version.Id, new { reason = request.Reason.Trim() });
        await database.SaveChangesAsync(cancellationToken); var record = await database.IdempotencyRecords.SingleAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse("{\"recommended\":true}"); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
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

    private static async Task<bool> HasProjectWriteAccessAsync(ConfigHubDbContext database, HttpContext context, Guid projectId, CancellationToken cancellationToken, bool requireSeniorMembership = false)
    {
        if (context.User.IsInRole("Admin")) return true;
        var userId = context.User.FindFirst(global::System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (!Guid.TryParse(userId, out var parsedUserId)) return false;
        return await database.ProjectMemberships.AnyAsync(member => member.ProjectId == projectId && member.UserId == parsedUserId && (requireSeniorMembership ? member.Role == ProjectMembershipRole.SeniorEngineer : member.Role == ProjectMembershipRole.Engineer || member.Role == ProjectMembershipRole.SeniorEngineer), cancellationToken);
    }

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
public sealed record CreateComponentRequest(string? Code, string? Name, Guid? ParentComponentId, string? Reason);
public sealed record CreateComponentVersionRequest(string? VersionNumber, string? Reason);
public sealed record LifecycleRequest(string? State, string? Reason);
public sealed record CloneProjectRequest(string? Code, string? Name, string? Reason);
public sealed record MoveComponentRequest(Guid? ParentComponentId, string? Reason);
public sealed record CreateBaselineRequest(string? SeriesCode, string? BaselineCode, string? Description, string? Reason);
public sealed record SetBaselineItemRequirementRequest(string? Requirement, string? Reason);
public sealed record AssignProjectStandardRequest(Guid ConfigurationBaselineId, string? Reason);
public sealed record AssignProjectMemberRequest(Guid UserId, string? Role, string? Reason);
public sealed record CreateMachineRequest(Guid ProjectId, string? SerialNumber, string? Name, string? MachineType, string? Reason);
public sealed record AssignMachineTargetRequest(Guid ConfigurationBaselineId, string? Reason);
public sealed record RecordFactsRequest(string? OperationType, string? Coverage, string? SourceType, string? ExternalEventId, DateTimeOffset? EffectiveAt, string? Reason, List<RecordFactItem>? Items);
public sealed record RebuildDriftSummariesRequest(string? Reason);
public sealed record RecordFactItem(Guid ComponentId, Guid? VersionId, bool Absent, DateTimeOffset? KnownInstalledAt);
public sealed record StageImportRequest(Guid ProjectId, string? SourceFileName, string? Reason, List<StageImportRow>? Rows);
public sealed record StageImportRow(string? ComponentCode, string? VersionNumber);
public sealed record VersionCommandResult(ComponentVersion? Version, bool ComponentMissing, bool Duplicate);
