using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Infrastructure.Persistence;

public static class LaboratoryModel
{
    public static void Configure(ModelBuilder builder)
    {
        builder.Entity<LaboratoryValidation>(e =>
        {
            e.ToTable("laboratory_validations", table => table.HasCheckConstraint("ck_laboratory_validation_chamber", "chamber_number IS NULL OR chamber_number BETWEEN 1 AND 6"));
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id"); e.Property(x => x.ComponentVersionId).HasColumnName("component_version_id"); e.Property(x => x.MachineId).HasColumnName("machine_id");
            e.Property(x => x.ChamberNumber).HasColumnName("chamber_number"); e.Property(x => x.Result).HasColumnName("result").HasMaxLength(20);
            e.Property(x => x.OccurredAt).HasColumnName("occurred_at"); e.Property(x => x.RecordedAt).HasColumnName("recorded_at");
            e.Property(x => x.Actor).HasColumnName("actor").HasMaxLength(256); e.Property(x => x.Reason).HasColumnName("reason").HasMaxLength(500); e.Property(x => x.CorrelationId).HasColumnName("correlation_id").HasMaxLength(200);
            e.Property(x => x.EvidenceId).HasColumnName("evidence_id"); e.Property(x => x.EvidenceKind).HasColumnName("evidence_kind").HasMaxLength(32);
            e.Property(x => x.MachineStage).HasColumnName("machine_stage").HasMaxLength(16); e.Property(x => x.ChamberStage).HasColumnName("chamber_stage").HasMaxLength(16);
            e.HasIndex(x => new { x.ComponentVersionId, x.RecordedAt });
            e.HasOne<ComponentVersion>().WithMany().HasForeignKey(x => x.ComponentVersionId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Machine>().WithMany().HasForeignKey(x => x.MachineId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
