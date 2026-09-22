using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BaselineWithdrawalUsesReleaseActionTime : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION confighub_guard_baseline_immutability()
                RETURNS trigger AS $$
                BEGIN
                IF TG_OP = 'UPDATE' AND current_setting('confighub.baseline_rename', true) = 'on'
                AND (to_jsonb(NEW) - 'baseline_code' - 'normalized_baseline_code') = (to_jsonb(OLD) - 'baseline_code' - 'normalized_baseline_code')
                THEN RETURN NEW; END IF;
                IF current_setting('confighub.baseline_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
                IF TG_OP = 'UPDATE' AND OLD.state = 'Released' AND NEW.state = 'Deprecated'
                AND (SELECT max(occurred_at) FROM baseline_lifecycle_transitions
                     WHERE configuration_baseline_id = OLD.id AND from_state = 'Draft' AND to_state = 'Released')
                    BETWEEN clock_timestamp() - interval '3 minutes' AND clock_timestamp()
                AND (to_jsonb(NEW) - 'state') = (to_jsonb(OLD) - 'state')
                AND NOT EXISTS (SELECT 1 FROM project_standard_assignments WHERE configuration_baseline_id = OLD.id)
                AND NOT EXISTS (SELECT 1 FROM machine_target_assignments WHERE configuration_baseline_id = OLD.id)
                AND NOT EXISTS (SELECT 1 FROM deployment_batches WHERE source_configuration_baseline_id = OLD.id)
                AND NOT EXISTS (SELECT 1 FROM configuration_baselines WHERE supersedes_baseline_id = OLD.id)
                THEN RETURN NEW; END IF;
                IF TG_OP = 'DELETE' AND OLD.state <> 'Draft' THEN RAISE EXCEPTION 'Released baseline % cannot be deleted.', OLD.id; END IF;
                IF TG_OP = 'UPDATE' AND OLD.state <> 'Draft' THEN RAISE EXCEPTION 'Released baseline % cannot be modified.', OLD.id; END IF;
                IF TG_OP = 'UPDATE' AND OLD.state = 'Draft' AND NEW.state = 'Released'
                AND (NEW.released_by IS NULL OR NEW.released_at IS NULL OR NEW.release_reason IS NULL)
                THEN RAISE EXCEPTION 'Released baseline metadata is required.'; END IF;
                RETURN COALESCE(NEW, OLD);
                END;
                $$ LANGUAGE plpgsql;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION confighub_guard_baseline_immutability()
                RETURNS trigger AS $$
                BEGIN
                IF TG_OP = 'UPDATE' AND current_setting('confighub.baseline_rename', true) = 'on'
                AND (to_jsonb(NEW) - 'baseline_code' - 'normalized_baseline_code') = (to_jsonb(OLD) - 'baseline_code' - 'normalized_baseline_code')
                THEN RETURN NEW; END IF;
                IF current_setting('confighub.baseline_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
                IF TG_OP = 'UPDATE' AND OLD.state = 'Released' AND NEW.state = 'Deprecated'
                AND OLD.released_at >= clock_timestamp() - interval '3 minutes'
                AND (to_jsonb(NEW) - 'state') = (to_jsonb(OLD) - 'state')
                AND NOT EXISTS (SELECT 1 FROM project_standard_assignments WHERE configuration_baseline_id = OLD.id)
                AND NOT EXISTS (SELECT 1 FROM machine_target_assignments WHERE configuration_baseline_id = OLD.id)
                AND NOT EXISTS (SELECT 1 FROM deployment_batches WHERE source_configuration_baseline_id = OLD.id)
                AND NOT EXISTS (SELECT 1 FROM configuration_baselines WHERE supersedes_baseline_id = OLD.id)
                THEN RETURN NEW; END IF;
                IF TG_OP = 'DELETE' AND OLD.state <> 'Draft' THEN RAISE EXCEPTION 'Released baseline % cannot be deleted.', OLD.id; END IF;
                IF TG_OP = 'UPDATE' AND OLD.state <> 'Draft' THEN RAISE EXCEPTION 'Released baseline % cannot be modified.', OLD.id; END IF;
                IF TG_OP = 'UPDATE' AND OLD.state = 'Draft' AND NEW.state = 'Released'
                AND (NEW.released_by IS NULL OR NEW.released_at IS NULL OR NEW.release_reason IS NULL)
                THEN RAISE EXCEPTION 'Released baseline metadata is required.'; END IF;
                RETURN COALESCE(NEW, OLD);
                END;
                $$ LANGUAGE plpgsql;
                """);
        }
    }
}
