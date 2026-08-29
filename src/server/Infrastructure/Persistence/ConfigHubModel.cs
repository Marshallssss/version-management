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

        modelBuilder.Entity<Project>(entity =>
        {
            entity.ToTable("projects");
            entity.HasKey(project => project.Id);
            entity.Property(project => project.Id).HasColumnName("id");
            entity.Property(project => project.Code).HasColumnName("code").HasMaxLength(50);
            entity.Property(project => project.NormalizedCode).HasColumnName("normalized_code").HasMaxLength(50);
            entity.Property(project => project.Name).HasColumnName("name").HasMaxLength(200);
            entity.Property(project => project.Description).HasColumnName("description").HasMaxLength(2000);
            entity.Property(project => project.Status).HasColumnName("status").HasMaxLength(32).HasConversion<string>();
            entity.Property(project => project.CreatedAt).HasColumnName("created_at");
            entity.Property(project => project.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(project => project.NormalizedCode).IsUnique().HasDatabaseName("ux_projects_normalized_code");
            entity.HasIndex(project => project.Status).HasDatabaseName("ix_projects_status");
        });

        modelBuilder.Entity<ConfigurationComponent>(entity =>
        {
            entity.ToTable("configuration_components");
            entity.HasKey(component => component.Id);
            entity.Property(component => component.Id).HasColumnName("id");
            entity.Property(component => component.ProjectId).HasColumnName("project_id");
            entity.Property(component => component.ParentComponentId).HasColumnName("parent_component_id");
            entity.Property(component => component.ComponentCode).HasColumnName("component_code").HasMaxLength(80);
            entity.Property(component => component.NormalizedComponentCode).HasColumnName("normalized_component_code").HasMaxLength(80);
            entity.Property(component => component.Name).HasColumnName("name").HasMaxLength(200);
            entity.Property(component => component.SortOrder).HasColumnName("sort_order");
            entity.Property(component => component.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(component => new { component.ProjectId, component.NormalizedComponentCode })
                .IsUnique().HasDatabaseName("ux_components_project_code");
            entity.HasIndex(component => new { component.ProjectId, component.ParentComponentId, component.SortOrder })
                .HasDatabaseName("ix_components_project_parent_sort");
            entity.HasOne<Project>().WithMany().HasForeignKey(component => component.ProjectId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ConfigurationComponent>().WithMany().HasForeignKey(component => component.ParentComponentId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ComponentVersion>(entity =>
        {
            entity.ToTable("component_versions");
            entity.HasKey(version => version.Id);
            entity.Property(version => version.Id).HasColumnName("id");
            entity.Property(version => version.ComponentId).HasColumnName("component_id");
            entity.Property(version => version.VersionNumber).HasColumnName("version_number").HasMaxLength(160);
            entity.Property(version => version.NormalizedVersionNumber).HasColumnName("normalized_version_number").HasMaxLength(160);
            entity.Property(version => version.SequenceNo).HasColumnName("sequence_no");
            entity.Property(version => version.Maturity).HasColumnName("maturity").HasMaxLength(32).HasConversion<string>();
            entity.Property(version => version.Safety).HasColumnName("safety").HasMaxLength(32).HasConversion<string>();
            entity.Property(version => version.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(version => new { version.ComponentId, version.NormalizedVersionNumber })
                .IsUnique().HasDatabaseName("ux_component_versions_normalized_number");
            entity.HasIndex(version => new { version.ComponentId, version.SequenceNo })
                .IsUnique().HasDatabaseName("ux_component_versions_sequence_no");
            entity.HasOne<ConfigurationComponent>().WithMany().HasForeignKey(version => version.ComponentId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<AuditEvent>(entity =>
        {
            entity.ToTable("audit_events");
            entity.HasKey(auditEvent => auditEvent.Id);
            entity.Property(auditEvent => auditEvent.Id).HasColumnName("id");
            entity.Property(auditEvent => auditEvent.Actor).HasColumnName("actor").HasMaxLength(160);
            entity.Property(auditEvent => auditEvent.Action).HasColumnName("action").HasMaxLength(120);
            entity.Property(auditEvent => auditEvent.EntityType).HasColumnName("entity_type").HasMaxLength(120);
            entity.Property(auditEvent => auditEvent.EntityId).HasColumnName("entity_id");
            entity.Property(auditEvent => auditEvent.CorrelationId).HasColumnName("correlation_id").HasMaxLength(128);
            entity.Property(auditEvent => auditEvent.Data).HasColumnName("data").HasColumnType("jsonb");
            entity.Property(auditEvent => auditEvent.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(auditEvent => new { auditEvent.EntityType, auditEvent.EntityId, auditEvent.OccurredAt })
                .HasDatabaseName("ix_audit_events_entity_occurred_at");
            entity.HasIndex(auditEvent => auditEvent.CorrelationId).HasDatabaseName("ix_audit_events_correlation_id");
        });
    }
}
