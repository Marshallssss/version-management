using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    public partial class AllowSuperAdminHistoricalBaselineMaintenance : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION confighub_guard_baseline_immutability()
                RETURNS trigger AS $$
                BEGIN
                    IF current_setting('confighub.baseline_maintenance', true) = 'on' THEN
                        RETURN COALESCE(NEW, OLD);
                    END IF;
                    IF TG_OP = 'DELETE' AND OLD.state <> 'Draft' THEN
                        RAISE EXCEPTION 'Released baseline % cannot be deleted.', OLD.id;
                    END IF;
                    IF TG_OP = 'UPDATE' AND OLD.state <> 'Draft' THEN
                        RAISE EXCEPTION 'Released baseline % cannot be modified.', OLD.id;
                    END IF;
                    IF TG_OP = 'UPDATE' AND OLD.state = 'Draft' AND NEW.state = 'Released'
                       AND (NEW.released_by IS NULL OR NEW.released_at IS NULL OR NEW.release_reason IS NULL) THEN
                        RAISE EXCEPTION 'Released baseline metadata is required.';
                    END IF;
                    RETURN COALESCE(NEW, OLD);
                END;
                $$ LANGUAGE plpgsql;

                CREATE OR REPLACE FUNCTION confighub_guard_baseline_item_immutability()
                RETURNS trigger AS $$
                DECLARE
                    baseline_state text;
                BEGIN
                    IF current_setting('confighub.baseline_maintenance', true) = 'on' THEN
                        RETURN COALESCE(NEW, OLD);
                    END IF;
                    SELECT state INTO baseline_state
                    FROM configuration_baselines
                    WHERE id = COALESCE(NEW.configuration_baseline_id, OLD.configuration_baseline_id);
                    IF baseline_state <> 'Draft' THEN
                        RAISE EXCEPTION 'Items of released baseline cannot be modified.';
                    END IF;
                    RETURN COALESCE(NEW, OLD);
                END;
                $$ LANGUAGE plpgsql;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION confighub_guard_baseline_immutability()
                RETURNS trigger AS $$
                BEGIN
                    IF TG_OP = 'DELETE' AND OLD.state <> 'Draft' THEN RAISE EXCEPTION 'Released baseline % cannot be deleted.', OLD.id; END IF;
                    IF TG_OP = 'UPDATE' AND OLD.state <> 'Draft' THEN RAISE EXCEPTION 'Released baseline % cannot be modified.', OLD.id; END IF;
                    IF TG_OP = 'UPDATE' AND OLD.state = 'Draft' AND NEW.state = 'Released' AND (NEW.released_by IS NULL OR NEW.released_at IS NULL OR NEW.release_reason IS NULL) THEN RAISE EXCEPTION 'Released baseline metadata is required.'; END IF;
                    RETURN COALESCE(NEW, OLD);
                END;
                $$ LANGUAGE plpgsql;
                CREATE OR REPLACE FUNCTION confighub_guard_baseline_item_immutability()
                RETURNS trigger AS $$
                DECLARE baseline_state text;
                BEGIN
                    SELECT state INTO baseline_state FROM configuration_baselines WHERE id = COALESCE(NEW.configuration_baseline_id, OLD.configuration_baseline_id);
                    IF baseline_state <> 'Draft' THEN RAISE EXCEPTION 'Items of released baseline cannot be modified.'; END IF;
                    RETURN COALESCE(NEW, OLD);
                END;
                $$ LANGUAGE plpgsql;
                """);
        }
    }
}
