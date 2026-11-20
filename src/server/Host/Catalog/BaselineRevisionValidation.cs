using ConfigHub.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private static string RevisionMatch(Guid? leftVersion, Guid? leftRevision, Guid? rightVersion, Guid? rightRevision)
        => leftVersion is null || rightVersion is null ? "NotApplicable"
            : leftRevision is null || rightRevision is null ? "Unknown"
            : leftRevision == rightRevision ? "Matched" : "Mismatch";

    private static async Task<bool> ValidBaselineRevisionsAsync(ConfigHubDbContext db, IReadOnlyList<BaselineVersionSelectionRequest> selections, CancellationToken ct)
    {
        var ids = selections.Where(s => s.RevisionId != null).Select(s => s.RevisionId!.Value).Distinct().ToArray();
        var revisions = await db.ComponentVersionRevisions.AsNoTracking().Where(r => ids.Contains(r.Id)).ToDictionaryAsync(r => r.Id, ct);
        return selections.All(s => s.RevisionId is null || revisions.TryGetValue(s.RevisionId.Value, out var revision) && revision.ComponentVersionId == s.VersionId);
    }
}
