using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Infrastructure.Persistence;

public sealed class ConfigHubDbContext(DbContextOptions<ConfigHubDbContext> options)
    : DbContext(options)
{
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();

    public DbSet<BackgroundJob> BackgroundJobs => Set<BackgroundJob>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigHubModel.Configure(modelBuilder);
    }
}
