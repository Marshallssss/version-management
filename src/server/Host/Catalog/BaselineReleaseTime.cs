using ConfigHub.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    // Business release dates can be corrected; the withdrawal window follows the real release action.
    private static Task<DateTimeOffset?> GetBaselineReleaseRecordedAtAsync(
        ConfigHubDbContext database, Guid baselineId, CancellationToken cancellationToken) =>
        database.BaselineLifecycleTransitions.AsNoTracking()
            .Where(item => item.ConfigurationBaselineId == baselineId && item.FromState == "Draft" && item.ToState == "Released")
            .MaxAsync(item => (DateTimeOffset?)item.OccurredAt, cancellationToken);
}
