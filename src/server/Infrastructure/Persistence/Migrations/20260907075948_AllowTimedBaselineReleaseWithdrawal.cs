using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AllowTimedBaselineReleaseWithdrawal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION confighub_guard_baseline_immutability()
                RETURNS trigger AS $$
                BEGIN
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

                CREATE FUNCTION confighub_require_released_baseline_reference()
                RETURNS trigger AS $$
                DECLARE baseline_id uuid; baseline_state text;
                BEGIN
                    baseline_id := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
                    IF baseline_id IS NULL THEN RETURN NEW; END IF;
                    SELECT state INTO baseline_state FROM configuration_baselines WHERE id = baseline_id FOR SHARE;
                    IF baseline_state IS DISTINCT FROM 'Released' THEN RAISE EXCEPTION 'Only a released baseline can be assigned or deployed.'; END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
                CREATE TRIGGER trg_standard_released_baseline BEFORE INSERT OR UPDATE OF configuration_baseline_id ON project_standard_assignments FOR EACH ROW EXECUTE FUNCTION confighub_require_released_baseline_reference('configuration_baseline_id');
                CREATE TRIGGER trg_target_released_baseline BEFORE INSERT OR UPDATE OF configuration_baseline_id ON machine_target_assignments FOR EACH ROW EXECUTE FUNCTION confighub_require_released_baseline_reference('configuration_baseline_id');
                CREATE TRIGGER trg_deployment_released_baseline BEFORE INSERT OR UPDATE OF source_configuration_baseline_id ON deployment_batches FOR EACH ROW EXECUTE FUNCTION confighub_require_released_baseline_reference('source_configuration_baseline_id');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Use a forward migration to change baseline withdrawal rules.");
        }
    }
}
