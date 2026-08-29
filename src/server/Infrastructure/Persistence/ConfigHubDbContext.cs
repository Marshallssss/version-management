using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Infrastructure.Persistence;

public sealed class ConfigHubDbContext(DbContextOptions<ConfigHubDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();

    public DbSet<BackgroundJob> BackgroundJobs => Set<BackgroundJob>();

    public DbSet<Project> Projects => Set<Project>();

    public DbSet<ConfigurationComponent> ConfigurationComponents => Set<ConfigurationComponent>();

    public DbSet<ComponentVersion> ComponentVersions => Set<ComponentVersion>();

    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    public DbSet<VersionLifecycleTransition> VersionLifecycleTransitions => Set<VersionLifecycleTransition>();

    public DbSet<VersionRecommendation> VersionRecommendations => Set<VersionRecommendation>();

    public DbSet<BaselineSeries> BaselineSeries => Set<BaselineSeries>();

    public DbSet<ConfigurationBaseline> ConfigurationBaselines => Set<ConfigurationBaseline>();

    public DbSet<BaselineItem> BaselineItems => Set<BaselineItem>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        ConfigHubModel.Configure(builder);
    }
}
