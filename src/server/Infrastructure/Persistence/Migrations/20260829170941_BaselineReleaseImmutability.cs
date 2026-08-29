using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BaselineReleaseImmutability : Migration
    {
        private static readonly string[] BaselineOccurredAtColumns = ["configuration_baseline_id", "occurred_at"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "baseline_lifecycle_transitions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    configuration_baseline_id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_state = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    to_state = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    actor = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_baseline_lifecycle_transitions", x => x.id);
                    table.ForeignKey(
                        name: "FK_baseline_lifecycle_transitions_configuration_baselines_conf~",
                        column: x => x.configuration_baseline_id,
                        principalTable: "configuration_baselines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_baseline_lifecycle_transitions_baseline_occurred_at",
                table: "baseline_lifecycle_transitions",
                columns: BaselineOccurredAtColumns);

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION confighub_guard_baseline_immutability()
                RETURNS trigger AS $$
                BEGIN
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

                CREATE TRIGGER trg_configuration_baselines_immutable
                BEFORE UPDATE OR DELETE ON configuration_baselines
                FOR EACH ROW EXECUTE FUNCTION confighub_guard_baseline_immutability();

                CREATE OR REPLACE FUNCTION confighub_guard_baseline_item_immutability()
                RETURNS trigger AS $$
                DECLARE
                    baseline_state text;
                BEGIN
                    SELECT state INTO baseline_state
                    FROM configuration_baselines
                    WHERE id = COALESCE(NEW.configuration_baseline_id, OLD.configuration_baseline_id);
                    IF baseline_state <> 'Draft' THEN
                        RAISE EXCEPTION 'Items of released baseline cannot be modified.';
                    END IF;
                    RETURN COALESCE(NEW, OLD);
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_baseline_items_immutable
                BEFORE INSERT OR UPDATE OR DELETE ON baseline_items
                FOR EACH ROW EXECUTE FUNCTION confighub_guard_baseline_item_immutability();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS trg_baseline_items_immutable ON baseline_items;
                DROP FUNCTION IF EXISTS confighub_guard_baseline_item_immutability();
                DROP TRIGGER IF EXISTS trg_configuration_baselines_immutable ON configuration_baselines;
                DROP FUNCTION IF EXISTS confighub_guard_baseline_immutability();
                """);
            migrationBuilder.DropTable(
                name: "baseline_lifecycle_transitions");
        }
    }
}
