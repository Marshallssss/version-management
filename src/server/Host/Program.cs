using ConfigHub.Host.Health;
using ConfigHub.Infrastructure.Persistence;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;

var migrateRequested = args.Contains("--migrate", StringComparer.OrdinalIgnoreCase);
var hostArguments = args
    .Where(argument => !string.Equals(argument, "--migrate", StringComparison.OrdinalIgnoreCase))
    .ToArray();
var builder = WebApplication.CreateBuilder(hostArguments);

var connectionName = migrateRequested ? "ConfigHubMigration" : "ConfigHub";
var connectionString = builder.Configuration.GetConnectionString(connectionName);
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

builder.Services
    .AddHealthChecks()
    .AddCheck("application", () => Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckResult.Healthy(), tags: ["live"])
    .AddCheck<DatabaseHealthCheck>("postgresql", tags: ["ready"]);

var app = builder.Build();

if (migrateRequested)
{
    await using var scope = app.Services.CreateAsyncScope();
    var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<ConfigHubDbContext>>();
    await using var database = await factory.CreateDbContextAsync();
    await database.Database.MigrateAsync();
    return;
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler();
    app.UseHsts();
}

app.UseHttpsRedirection();
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

app.MapFallback("/api/{**path}", () => Results.Problem(
    statusCode: StatusCodes.Status404NotFound,
    title: "API endpoint not found"));

app.MapFallbackToFile("index.html");

await app.RunAsync();

public partial class Program;
