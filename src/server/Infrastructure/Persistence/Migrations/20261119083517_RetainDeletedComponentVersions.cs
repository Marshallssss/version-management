using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RetainDeletedComponentVersions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ux_component_versions_one_testing_per_component",
                table: "component_versions");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "deleted_at",
                table: "component_versions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ux_component_versions_one_testing_per_component",
                table: "component_versions",
                column: "component_id",
                unique: true,
                filter: "maturity = 'Testing' AND deleted_at IS NULL");

            // Retained history is readable, but cannot be reused as a new configuration.
            migrationBuilder.Sql("""
                CREATE FUNCTION guard_retained_version_reference() RETURNS trigger LANGUAGE plpgsql AS $$
                DECLARE target uuid; removed timestamptz;
                BEGIN
                  target := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
                  IF target IS NULL THEN RETURN NEW; END IF;
                  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD)->>TG_ARGV[0])::uuid IS NOT DISTINCT FROM target THEN RETURN NEW; END IF;
                  SELECT deleted_at INTO removed FROM component_versions WHERE id = target FOR SHARE;
                  IF removed IS NOT NULL THEN
                    RAISE EXCEPTION 'Deleted version cannot be reused' USING ERRCODE='23514', CONSTRAINT='ck_retained_version_reference';
                  END IF;
                  RETURN NEW;
                END $$;
                DO $$
                DECLARE ref record;
                BEGIN
                  FOR ref IN SELECT c.conrelid::regclass AS tab, a.attname AS col, c.oid AS key
                    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
                    WHERE c.contype='f' AND c.confrelid='component_versions'::regclass AND cardinality(c.conkey)=1
                  LOOP
                    EXECUTE format('CREATE TRIGGER retained_version_%s BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION guard_retained_version_reference(%L)', ref.key, ref.tab, ref.col);
                  END LOOP;
                END $$;
                CREATE FUNCTION guard_retained_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF OLD.deleted_at IS NOT NULL THEN
                    RAISE EXCEPTION 'Deleted version history is immutable' USING ERRCODE='23514', CONSTRAINT='ck_retained_version_reference';
                  END IF;
                  IF NEW.deleted_at IS NOT NULL AND (
                    EXISTS (SELECT 1 FROM baseline_items WHERE component_version_id=NEW.id)
                    OR EXISTS (SELECT 1 FROM configuration_baselines WHERE top_component_version_id=NEW.id)
                    OR EXISTS (SELECT 1 FROM machine_current_configurations WHERE component_version_id=NEW.id)
                    OR EXISTS (SELECT 1 FROM machine_chamber_versions f JOIN machine_chambers c ON c.id=f.chamber_id
                      WHERE f.version_id=NEW.id AND c.installed AND NOT EXISTS
                      (SELECT 1 FROM machine_chamber_versions n WHERE n.chamber_id=f.chamber_id AND n.component_id=f.component_id AND n.sequence>f.sequence))
                  ) THEN
                    RAISE EXCEPTION 'Version is in use' USING ERRCODE='23514', CONSTRAINT='ck_retained_version_reference';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER retained_version_mutation BEFORE UPDATE ON component_versions FOR EACH ROW EXECUTE FUNCTION guard_retained_version_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP FUNCTION guard_retained_version_reference() CASCADE; DROP FUNCTION guard_retained_version_mutation() CASCADE;");
            migrationBuilder.DropIndex(
                name: "ux_component_versions_one_testing_per_component",
                table: "component_versions");

            migrationBuilder.DropColumn(
                name: "deleted_at",
                table: "component_versions");

            migrationBuilder.CreateIndex(
                name: "ux_component_versions_one_testing_per_component",
                table: "component_versions",
                column: "component_id",
                unique: true,
                filter: "maturity = 'Testing'");
        }
    }
}
