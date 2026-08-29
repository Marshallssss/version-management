using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ComponentLineageAndSequenceSpacing : Migration
    {
        private static readonly string[] ComponentsProjectLineageColumns = ["project_id", "lineage_key"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "lineage_key",
                table: "configuration_components",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql("UPDATE configuration_components SET lineage_key = normalized_component_code WHERE lineage_key = '';" );

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION confighub_validate_component_parent()
                RETURNS trigger AS $$
                DECLARE
                    parent_project_id uuid;
                BEGIN
                    IF NEW.parent_component_id IS NULL THEN
                        RETURN NEW;
                    END IF;

                    SELECT project_id INTO parent_project_id
                    FROM configuration_components
                    WHERE id = NEW.parent_component_id;

                    IF parent_project_id IS NULL OR parent_project_id <> NEW.project_id THEN
                        RAISE EXCEPTION 'component parent must belong to the same project';
                    END IF;

                    IF NEW.parent_component_id = NEW.id OR EXISTS (
                        WITH RECURSIVE ancestors AS (
                            SELECT id, parent_component_id
                            FROM configuration_components
                            WHERE id = NEW.parent_component_id
                            UNION ALL
                            SELECT component.id, component.parent_component_id
                            FROM configuration_components component
                            INNER JOIN ancestors ON component.id = ancestors.parent_component_id
                        )
                        SELECT 1 FROM ancestors WHERE id = NEW.id
                    ) THEN
                        RAISE EXCEPTION 'component hierarchy cannot contain a cycle';
                    END IF;

                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER tr_configuration_components_validate_parent
                BEFORE INSERT OR UPDATE OF project_id, parent_component_id ON configuration_components
                FOR EACH ROW EXECUTE FUNCTION confighub_validate_component_parent();
                """);

            migrationBuilder.CreateIndex(
                name: "ux_components_project_lineage",
                table: "configuration_components",
                columns: ComponentsProjectLineageColumns,
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS tr_configuration_components_validate_parent ON configuration_components;");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS confighub_validate_component_parent();");
            migrationBuilder.DropIndex(
                name: "ux_components_project_lineage",
                table: "configuration_components");

            migrationBuilder.DropColumn(
                name: "lineage_key",
                table: "configuration_components");
        }
    }
}
