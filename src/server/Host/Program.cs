using ConfigHub.Host.Health;
using ConfigHub.Host.Catalog;
using ConfigHub.Host.Auth;
using ConfigHub.Host.System;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using System.Text.Json;
using System.Security.Cryptography;
using System.Text;

var migrateRequested = args.Contains("--migrate", StringComparer.OrdinalIgnoreCase);
var bootstrapOnlyRequested = args.Contains("--bootstrap-admin-only", StringComparer.OrdinalIgnoreCase);
var hostArguments = args
    .Where(argument =>
        !string.Equals(argument, "--migrate", StringComparison.OrdinalIgnoreCase)
        && !string.Equals(argument, "--bootstrap-admin-only", StringComparison.OrdinalIgnoreCase))
    .ToArray();
var builder = WebApplication.CreateBuilder(hostArguments);
var localConfigurationPath = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    "ConfigHub",
    "appsettings.local.json");
builder.Configuration.AddJsonFile(localConfigurationPath, optional: true, reloadOnChange: true);

var connectionName = migrateRequested ? "ConfigHubMigration" : "ConfigHub";
var connectionString = builder.Configuration.GetConnectionString(connectionName);
if (string.IsNullOrWhiteSpace(connectionString))
{
    connectionString = Environment.GetEnvironmentVariable(
        $"ConnectionStrings__{connectionName}",
        EnvironmentVariableTarget.User);
}
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        $"ConnectionStrings:{connectionName} is required. Set it with the ConnectionStrings__{connectionName} environment variable.");
}

builder.Services.AddProblemDetails();
builder.Services.AddPooledDbContextFactory<ConfigHubDbContext>(options =>
    options.UseNpgsql(connectionString, npgsql =>
        npgsql.MigrationsAssembly(
            typeof(ConfigHubDbContext).Assembly.GetName().Name
            ?? throw new InvalidOperationException("Infrastructure assembly name is unavailable."))));
builder.Services.AddIdentityCore<ApplicationUser>(options =>
    {
        options.Password.RequiredLength = 6;
        options.Password.RequireDigit = false;
        options.Password.RequireLowercase = false;
        options.Password.RequireUppercase = false;
        options.Password.RequireNonAlphanumeric = false;
        options.Password.RequiredUniqueChars = 1;
    })
    .AddRoles<IdentityRole<Guid>>()
    .AddEntityFrameworkStores<ConfigHubDbContext>()
    .AddDefaultTokenProviders()
    .AddSignInManager();
builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();
builder.Services.ConfigureApplicationCookie(options =>
{
    options.Events.OnRedirectToLogin = context =>
    {
        if (context.Request.Path.StartsWithSegments("/api"))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        }
        context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = context =>
    {
        if (context.Request.Path.StartsWithSegments("/api"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        }
        context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    };
});
builder.Services.AddAuthorizationBuilder().AddPolicy("Engineer", policy => policy.RequireRole("Engineer", "SeniorEngineer", "Admin", "SuperAdmin"));
builder.Services.AddAuthorizationBuilder().AddPolicy("SeniorEngineer", policy => policy.RequireRole("SeniorEngineer", "Admin", "SuperAdmin"));
builder.Services.AddAuthorizationBuilder().AddPolicy("Admin", policy => policy.RequireRole("Admin", "SuperAdmin"));
builder.Services.AddAuthorizationBuilder().AddPolicy("SuperAdmin", policy => policy.RequireRole("SuperAdmin"));

builder.Services
    .AddHealthChecks()
    .AddCheck("application", () => Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckResult.Healthy(), tags: ["live"])
    .AddCheck<DatabaseHealthCheck>("postgresql", tags: ["ready"]);

var app = builder.Build();

app.Use(async (context, next) =>
{
    var correlationId = context.Request.Headers["X-Correlation-ID"].FirstOrDefault();
    if (string.IsNullOrWhiteSpace(correlationId) || correlationId.Length > 128)
    {
        correlationId = Guid.NewGuid().ToString("N");
    }

    context.Items["CorrelationId"] = correlationId;
    context.Response.Headers["X-Correlation-ID"] = correlationId;
    await next(context);
});

if (migrateRequested)
{
    await using var scope = app.Services.CreateAsyncScope();
    var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<ConfigHubDbContext>>();
    await using var database = await factory.CreateDbContextAsync();
    await database.Database.MigrateAsync();
    return;
}

await using (var scope = app.Services.CreateAsyncScope())
{
    var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<ConfigHubDbContext>>();
    await using var database = await factory.CreateDbContextAsync();
    var pendingMigrations = (await database.Database.GetPendingMigrationsAsync()).ToArray();
    if (pendingMigrations.Length > 0)
    {
        throw new InvalidOperationException(
            $"数据库结构尚未升级，不能启动 ConfigHub。请使用 Migration 连接串执行 ConfigHub.Host.exe --migrate。待应用 Migration：{string.Join(", ", pendingMigrations)}。");
    }
}

if (bootstrapOnlyRequested)
{
    await BootstrapIdentity.EnsureAsync(app.Services, app.Configuration, writeStatus: true);
    return;
}

await BootstrapIdentity.EnsureAsync(app.Services, app.Configuration);

if (!app.Environment.IsDevelopment())
{
app.UseExceptionHandler();
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains("live")
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains("ready")
});

app.MapGet("/api/v1/system/version", () =>
{
    var assembly = typeof(Program).Assembly.GetName();
    return TypedResults.Ok(new
    {
        product = "ConfigHub",
        version = assembly.Version?.ToString(3) ?? "0.1.0",
        apiVersion = "v1",
        architecture = "windows-single-iis",
        serverTime = DateTimeOffset.UtcNow
    });
});

app.MapGet("/api/v1/system/status", async (
    IDbContextFactory<ConfigHubDbContext> contextFactory,
    CancellationToken cancellationToken) =>
{
    await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
    var jobs = await database.BackgroundJobs
        .AsNoTracking()
        .OrderByDescending(job => job.CreatedAt)
        .Take(8)
        .Select(job => new
        {
            id = job.Id,
            jobType = job.JobType,
            status = job.Status.ToString(),
            attempts = job.Attempts,
            createdAt = job.CreatedAt,
            lastAttemptAt = job.LastAttemptAt,
            completedAt = job.CompletedAt,
            lastError = job.LastError
        })
        .ToListAsync(cancellationToken);

    var queue = await database.BackgroundJobs
        .AsNoTracking()
        .GroupBy(job => job.Status)
        .Select(group => new { status = group.Key.ToString(), count = group.Count() })
        .ToListAsync(cancellationToken);

    return TypedResults.Ok(new { queue, jobs, serverTime = DateTimeOffset.UtcNow });
}).RequireAuthorization("Admin");

app.MapPost("/api/v1/system/jobs/noop", async (
    EnqueueNoopJobRequest request,
    HttpContext context,
    IDbContextFactory<ConfigHubDbContext> contextFactory,
    CancellationToken cancellationToken) =>
{
    var reason = request.Reason?.Trim();
    if (string.IsNullOrWhiteSpace(reason) || reason.Length > 500)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["reason"] = ["任务原因不能为空且不能超过 500 个字符。"]
        });
    }

    var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
    if (string.IsNullOrWhiteSpace(key) || key.Length > 200)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["Idempotency-Key"] = ["提交任务必须提供不超过 200 个字符的 Idempotency-Key。"]
        });
    }

    await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
    const string scope = "system.jobs.noop";
    var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
    var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(record => record.Scope == scope && record.IdempotencyKey == key, cancellationToken);
    if (replay is not null)
    {
        if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" });
        if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone());
        return Results.Conflict(new { message = "该请求仍在处理。" });
    }

    var now = DateTimeOffset.UtcNow;
    var actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor is required.");
    await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
    var record = new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) };
    database.IdempotencyRecords.Add(record);
    var job = new BackgroundJob
    {
        Id = Guid.NewGuid(),
        JobType = "system.noop",
        Payload = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            reason,
            requestedAt = now
        })),
        AvailableAt = now,
        CreatedAt = now
    };

    database.BackgroundJobs.Add(job);
    database.AuditEvents.Add(new AuditEvent
    {
        Id = Guid.NewGuid(),
        Actor = actor[..Math.Min(actor.Length, 160)],
        Action = "SystemNoopJobEnqueued",
        EntityType = "BackgroundJob",
        EntityId = job.Id,
        CorrelationId = (context.Items["CorrelationId"]?.ToString() ?? context.TraceIdentifier)[..Math.Min((context.Items["CorrelationId"]?.ToString() ?? context.TraceIdentifier).Length, 128)],
        Data = JsonDocument.Parse(JsonSerializer.Serialize(new { reason })),
        OccurredAt = now
    });
    await database.SaveChangesAsync(cancellationToken);
    record.Status = IdempotencyRecordStatus.Completed;
    record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = job.Id }));
    await database.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);

    return TypedResults.Accepted($"/api/v1/system/jobs/{job.Id}", new { id = job.Id });
}).RequireAuthorization("Admin");

app.MapCatalogEndpoints();
app.MapAuthEndpoints();

app.MapFallback("/api/{**path}", () => Results.Problem(
    statusCode: StatusCodes.Status404NotFound,
    title: "API endpoint not found"));

app.MapFallbackToFile("index.html");

await app.RunAsync();

public partial class Program;
