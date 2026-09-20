using ConfigHub.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private static async Task<IResult> GetBaselineHistoryIndexAsync(
        Guid projectId,
        IDbContextFactory<ConfigHubDbContext> factory,
        CancellationToken cancellationToken)
    {
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        if (!await database.Projects.AnyAsync(project => project.Id == projectId, cancellationToken))
            return Results.NotFound(new { message = "项目不存在。" });

        var projectBaselines = database.ConfigurationBaselines.AsNoTracking().Where(item => item.ProjectId == projectId);
        var baselines = await projectBaselines.OrderByDescending(item => item.CreatedAt).ThenBy(item => item.Id)
            .Select(item => new
            {
                id = item.Id,
                code = item.BaselineCode,
                revisionNo = item.RevisionNo,
                seriesCode = database.BaselineSeries.Where(series => series.Id == item.BaselineSeriesId).Select(series => series.SeriesCode).Single(),
                state = item.State.ToString(),
                createdAt = item.CreatedAt,
                releasedAt = item.ReleasedAt
            }).ToListAsync(cancellationToken);

        // Read frozen labels directly, so renames and soft deletion cannot rewrite historical filters.
        var snapshots = await database.BaselineItems.AsNoTracking()
            .Where(item => projectBaselines.Any(baseline => baseline.Id == item.ConfigurationBaselineId))
            .Select(item => new
            {
                baselineId = item.ConfigurationBaselineId,
                componentId = item.ConfigurationComponentId,
                componentName = item.ComponentNameSnapshot,
                versionId = item.ComponentVersionId,
                versionNumber = item.VersionNumberSnapshot
            }).ToListAsync(cancellationToken);
        var itemsByBaseline = snapshots.ToLookup(item => item.baselineId);
        return TypedResults.Ok(baselines.Select(baseline => new
        {
            baseline.id,
            baseline.code,
            baseline.revisionNo,
            baseline.seriesCode,
            baseline.state,
            baseline.createdAt,
            baseline.releasedAt,
            itemCount = itemsByBaseline[baseline.id].Count(),
            items = itemsByBaseline[baseline.id].Select(item => new { item.componentId, item.componentName, item.versionId, item.versionNumber })
        }));
    }
}
