using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Infrastructure.Persistence;

internal static class MachineEquipmentModel
{
    internal static void Configure(ModelBuilder builder)
    {
        const string stages = "'Lab','MoveIn','T0','T1','T2','T3','STR','HVM'";
        builder.Entity<Machine>(entity =>
        {
            entity.Property(x => x.Owner).HasColumnName("owner").HasMaxLength(160);
            entity.Property(x => x.Stage).HasColumnName("stage").HasMaxLength(16);
            entity.Property(x => x.DeletedAt).HasColumnName("deleted_at");
            entity.ToTable("machines", table => table.HasCheckConstraint("ck_machine_stage", $"stage IS NULL OR stage IN ({stages})"));
            entity.HasQueryFilter(x => x.DeletedAt == null);
        });
        builder.Entity<MachineChamber>(entity =>
        {
            entity.ToTable("machine_chambers", table =>
            {
                table.HasCheckConstraint("ck_chamber_number", "number BETWEEN 1 AND 6");
                table.HasCheckConstraint("ck_chamber_stage", $"stage IN ({stages})");
            });
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Id).HasColumnName("id");
            entity.Property(x => x.MachineId).HasColumnName("machine_id");
            entity.Property(x => x.Number).HasColumnName("number");
            entity.Property(x => x.Installed).HasColumnName("installed");
            entity.Property(x => x.Stage).HasColumnName("stage").HasMaxLength(16);
            entity.HasIndex(x => new { x.MachineId, x.Number }).IsUnique();
            entity.HasOne<Machine>().WithMany().HasForeignKey(x => x.MachineId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<MachineEquipmentHistory>(entity =>
        {
            entity.ToTable("machine_equipment_history");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Id).HasColumnName("id");
            entity.Property(x => x.MachineId).HasColumnName("machine_id");
            entity.Property(x => x.ChamberNumber).HasColumnName("chamber_number");
            entity.Property(x => x.Kind).HasColumnName("kind").HasMaxLength(40);
            entity.Property(x => x.Actor).HasColumnName("actor").HasMaxLength(160);
            entity.Property(x => x.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.Property(x => x.CorrelationId).HasColumnName("correlation_id").HasMaxLength(128);
            entity.Property(x => x.RecordedAt).HasColumnName("recorded_at");
            entity.Property(x => x.Details).HasColumnName("details").HasColumnType("jsonb");
            entity.HasIndex(x => new { x.MachineId, x.RecordedAt });
            entity.HasOne<Machine>().WithMany().HasForeignKey(x => x.MachineId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<MachineChamberVersion>(entity =>
        {
            entity.ToTable("machine_chamber_versions");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Id).HasColumnName("id");
            entity.Property(x => x.ChamberId).HasColumnName("chamber_id");
            entity.Property(x => x.ComponentId).HasColumnName("component_id");
            entity.Property(x => x.VersionId).HasColumnName("version_id");
            entity.Property(x => x.Sequence).HasColumnName("sequence");
            entity.Property(x => x.HistoryId).HasColumnName("history_id");
            entity.HasIndex(x => new { x.ChamberId, x.ComponentId, x.Sequence }).IsUnique();
            entity.HasOne<MachineChamber>().WithMany().HasForeignKey(x => x.ChamberId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ConfigurationComponent>().WithMany().HasForeignKey(x => x.ComponentId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ComponentVersion>().WithMany().HasForeignKey(x => x.VersionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<MachineEquipmentHistory>().WithMany().HasForeignKey(x => x.HistoryId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
