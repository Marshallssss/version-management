using ConfigHub.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace ConfigHub.Host.Health;

public sealed class DatabaseHealthCheck(
    IDbContextFactory<ConfigHubDbContext> contextFactory,
    ILogger<DatabaseHealthCheck> logger) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
            return await database.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy("PostgreSQL is reachable.")
                : HealthCheckResult.Unhealthy("PostgreSQL did not accept a connection.");
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "PostgreSQL readiness check failed.");
            return HealthCheckResult.Unhealthy("PostgreSQL readiness check failed.");
        }
    }
}
