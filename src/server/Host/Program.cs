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
builder.Services.AddAuthorizationBuilder().AddPolicy("Engineer", policy => policy.RequireRole("Engineer", "SeniorEngineer", "Admin"));
builder.Services.AddAuthorizationBuilder().AddPolicy("SeniorEngineer", policy => policy.RequireRole("SeniorEngineer", "Admin"));

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
});

app.MapPost("/api/v1/system/jobs/noop", async (
    EnqueueNoopJobRequest request,
    IDbContextFactory<ConfigHubDbContext> contextFactory,
    CancellationToken cancellationToken) =>
{
    var note = request.Note?.Trim();
    if (note?.Length > 500)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["note"] = ["任务说明不能超过 500 个字符。"]
        });
    }

    await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
    var job = new BackgroundJob
    {
        Id = Guid.NewGuid(),
        JobType = "system.noop",
        Payload = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            note = string.IsNullOrWhiteSpace(note) ? "来自运行控制台的连通性任务" : note,
            requestedAt = DateTimeOffset.UtcNow
        })),
        AvailableAt = DateTimeOffset.UtcNow,
        CreatedAt = DateTimeOffset.UtcNow
    };

    database.BackgroundJobs.Add(job);
    await database.SaveChangesAsync(cancellationToken);

    return TypedResults.Accepted($"/api/v1/system/jobs/{job.Id}", new { id = job.Id });
});

app.MapCatalogEndpoints();
app.MapAuthEndpoints();

app.MapFallback("/api/{**path}", () => Results.Problem(
    statusCode: StatusCodes.Status404NotFound,
    title: "API endpoint not found"));

app.MapFallbackToFile("index.html");

await app.RunAsync();

public partial class Program;
