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
    public DbSet<ProjectMembership> ProjectMemberships => Set<ProjectMembership>();

    public DbSet<ConfigurationComponent> ConfigurationComponents => Set<ConfigurationComponent>();

    public DbSet<ComponentVersion> ComponentVersions => Set<ComponentVersion>();

    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    public DbSet<VersionLifecycleTransition> VersionLifecycleTransitions => Set<VersionLifecycleTransition>();

    public DbSet<VersionRecommendation> VersionRecommendations => Set<VersionRecommendation>();

    public DbSet<BaselineSeries> BaselineSeries => Set<BaselineSeries>();

    public DbSet<ConfigurationBaseline> ConfigurationBaselines => Set<ConfigurationBaseline>();

    public DbSet<BaselineItem> BaselineItems => Set<BaselineItem>();

    public DbSet<BaselineLifecycleTransition> BaselineLifecycleTransitions => Set<BaselineLifecycleTransition>();

    public DbSet<BaselineReview> BaselineReviews => Set<BaselineReview>();

    public DbSet<ProjectStandardAssignment> ProjectStandardAssignments => Set<ProjectStandardAssignment>();
    public DbSet<Machine> Machines => Set<Machine>();
    public DbSet<MachineTargetAssignment> MachineTargetAssignments => Set<MachineTargetAssignment>();
    public DbSet<DeploymentBatch> DeploymentBatches => Set<DeploymentBatch>();
    public DbSet<DeploymentItem> DeploymentItems => Set<DeploymentItem>();
    public DbSet<MachineCurrentConfiguration> MachineCurrentConfigurations => Set<MachineCurrentConfiguration>();
    public DbSet<MachineDriftSummary> MachineDriftSummaries => Set<MachineDriftSummary>();
    public DbSet<BulkOperation> BulkOperations => Set<BulkOperation>();
    public DbSet<BulkOperationItem> BulkOperationItems => Set<BulkOperationItem>();
    public DbSet<ImportBatch> ImportBatches => Set<ImportBatch>();
    public DbSet<ImportRow> ImportRows => Set<ImportRow>();
    public DbSet<VersionExposureSnapshot> VersionExposureSnapshots => Set<VersionExposureSnapshot>();
    public DbSet<VersionExposureMachine> VersionExposureMachines => Set<VersionExposureMachine>();
    public DbSet<VersionExposureBaseline> VersionExposureBaselines => Set<VersionExposureBaseline>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        ConfigHubModel.Configure(builder);
    }
}
