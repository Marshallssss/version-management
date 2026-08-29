using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Infrastructure.Persistence;

internal static class ConfigHubModel
{
    public static void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.HasPostgresExtension("btree_gist");

        modelBuilder.Entity<IdempotencyRecord>(entity =>
        {
            entity.ToTable("idempotency_records");
            entity.HasKey(record => record.Id);
            entity.Property(record => record.Id).HasColumnName("id");
            entity.Property(record => record.Scope).HasColumnName("scope").HasMaxLength(160);
            entity.Property(record => record.IdempotencyKey).HasColumnName("idempotency_key").HasMaxLength(200);
            entity.Property(record => record.RequestHash).HasColumnName("request_hash").HasMaxLength(128);
            entity.Property(record => record.Status)
                .HasColumnName("status")
                .HasMaxLength(32)
                .HasConversion<string>();
            entity.Property(record => record.Result).HasColumnName("result").HasColumnType("jsonb");
            entity.Property(record => record.Reference).HasColumnName("reference").HasMaxLength(500);
            entity.Property(record => record.CreatedAt).HasColumnName("created_at");
            entity.Property(record => record.ExpiresAt).HasColumnName("expires_at");
            entity.HasIndex(record => new { record.Scope, record.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName("ux_idempotency_records_scope_key");
            entity.HasIndex(record => record.ExpiresAt)
                .HasDatabaseName("ix_idempotency_records_expires_at");
        });

        modelBuilder.Entity<BackgroundJob>(entity =>
        {
            entity.ToTable("background_jobs");
            entity.HasKey(job => job.Id);
            entity.Property(job => job.Id).HasColumnName("id");
            entity.Property(job => job.JobType).HasColumnName("job_type").HasMaxLength(160);
            entity.Property(job => job.Payload).HasColumnName("payload").HasColumnType("jsonb");
            entity.Property(job => job.Status)
                .HasColumnName("status")
                .HasMaxLength(32)
                .HasConversion<string>();
            entity.Property(job => job.AvailableAt).HasColumnName("available_at");
            entity.Property(job => job.LockedAt).HasColumnName("locked_at");
            entity.Property(job => job.LockedBy).HasColumnName("locked_by").HasMaxLength(240);
            entity.Property(job => job.Attempts).HasColumnName("attempts");
            entity.Property(job => job.CreatedAt).HasColumnName("created_at");
            entity.Property(job => job.CompletedAt).HasColumnName("completed_at");
            entity.Property(job => job.LastError).HasColumnName("last_error").HasMaxLength(4000);
            entity.HasIndex(job => new { job.Status, job.AvailableAt })
                .HasDatabaseName("ix_background_jobs_claim");
            entity.HasIndex(job => job.CreatedAt)
                .HasDatabaseName("ix_background_jobs_created_at");
        });
    }
}
