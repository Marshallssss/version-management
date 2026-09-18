using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Infrastructure.Persistence;

public static class MatrixImportModel
{
    public static void Configure(ModelBuilder builder)
    {
        builder.Entity<MatrixImportReference>(e =>
        {
            e.ToTable("matrix_import_references"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id"); e.Property(x => x.TemplateId).HasColumnName("template_id"); e.Property(x => x.CombinationId).HasColumnName("combination_id"); e.Property(x => x.ComponentId).HasColumnName("component_id"); e.Property(x => x.VersionId).HasColumnName("version_id");
            e.HasOne<MatrixImportTemplate>().WithMany().HasForeignKey(x => x.TemplateId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<MatrixImportCombination>().WithMany().HasForeignKey(x => x.CombinationId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ConfigurationComponent>().WithMany().HasForeignKey(x => x.ComponentId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ComponentVersion>().WithMany().HasForeignKey(x => x.VersionId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<MatrixImportTemplate>(e =>
        {
            e.ToTable("matrix_import_templates"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id"); e.Property(x => x.ProjectId).HasColumnName("project_id");
            e.Property(x => x.CreatedAt).HasColumnName("created_at"); e.Property(x => x.CreatedBy).HasColumnName("created_by").HasMaxLength(160);
            e.Property(x => x.ReferenceBaselineCode).HasColumnName("reference_baseline_code").HasMaxLength(160);
            e.Property(x => x.Components).HasColumnName("components").HasColumnType("jsonb");
            e.HasIndex(x => new { x.ProjectId, x.CreatedAt });
            e.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<MatrixImportSource>(e =>
        {
            e.ToTable("matrix_import_sources"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id"); e.Property(x => x.ProjectId).HasColumnName("project_id"); e.Property(x => x.TemplateId).HasColumnName("template_id");
            e.Property(x => x.Path).HasColumnName("path").HasMaxLength(2000); e.Property(x => x.LocalTime).HasColumnName("local_time").HasMaxLength(5); e.Property(x => x.TimeZoneId).HasColumnName("time_zone_id").HasMaxLength(100);
            e.Property(x => x.Enabled).HasColumnName("enabled"); e.Property(x => x.AuthorizedByUserId).HasColumnName("authorized_by_user_id");
            e.Property(x => x.NextScanAt).HasColumnName("next_scan_at"); e.Property(x => x.LastScanAt).HasColumnName("last_scan_at"); e.Property(x => x.LastStatus).HasColumnName("last_status").HasMaxLength(2000);
            e.HasIndex(x => x.ProjectId).IsUnique(); e.HasOne<MatrixImportTemplate>().WithMany().HasForeignKey(x => x.TemplateId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<MatrixImportRun>(e =>
        {
            e.ToTable("matrix_import_runs"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id"); e.Property(x => x.ProjectId).HasColumnName("project_id"); e.Property(x => x.TemplateId).HasColumnName("template_id"); e.Property(x => x.SourceId).HasColumnName("source_id");
            e.Property(x => x.CreatedAt).HasColumnName("created_at"); e.Property(x => x.FileName).HasColumnName("file_name").HasMaxLength(260); e.Property(x => x.Status).HasColumnName("status").HasMaxLength(40); e.Property(x => x.Actor).HasColumnName("actor").HasMaxLength(160);
            e.Property(x => x.ImportedCount).HasColumnName("imported_count"); e.Property(x => x.SkippedCount).HasColumnName("skipped_count"); e.Property(x => x.Messages).HasColumnName("messages").HasColumnType("jsonb");
            e.HasIndex(x => new { x.ProjectId, x.CreatedAt });
        });
        builder.Entity<MatrixImportCombination>(e =>
        {
            e.ToTable("matrix_import_combinations"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id"); e.Property(x => x.ProjectId).HasColumnName("project_id"); e.Property(x => x.TemplateId).HasColumnName("template_id"); e.Property(x => x.RunId).HasColumnName("run_id");
            e.Property(x => x.RowKey).HasColumnName("row_key").HasMaxLength(100); e.Property(x => x.SourceRow).HasColumnName("source_row"); e.Property(x => x.SequenceNo).HasColumnName("sequence_no"); e.Property(x => x.ContentHash).HasColumnName("content_hash").HasMaxLength(64);
            e.Property(x => x.RecordDate).HasColumnName("record_date").HasMaxLength(10); e.Property(x => x.Reason).HasColumnName("reason").HasMaxLength(500); e.Property(x => x.CreatedAt).HasColumnName("created_at"); e.Property(x => x.Items).HasColumnName("items").HasColumnType("jsonb");
            e.HasIndex(x => new { x.TemplateId, x.RowKey }).IsUnique(); e.HasIndex(x => new { x.TemplateId, x.SequenceNo }).IsUnique();
            e.HasOne<MatrixImportTemplate>().WithMany().HasForeignKey(x => x.TemplateId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
