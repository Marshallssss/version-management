using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ProjectStandardAssignment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "project_standard_assignments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    configuration_baseline_id = table.Column<Guid>(type: "uuid", nullable: false),
                    valid_from = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    valid_to = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    assigned_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_standard_assignments", x => x.id);
                    table.ForeignKey(
                        name: "FK_project_standard_assignments_configuration_baselines_config~",
                        column: x => x.configuration_baseline_id,
                        principalTable: "configuration_baselines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_project_standard_assignments_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_project_standard_assignments_configuration_baseline_id",
                table: "project_standard_assignments",
                column: "configuration_baseline_id");

            migrationBuilder.CreateIndex(
                name: "ux_project_standard_assignments_current_project",
                table: "project_standard_assignments",
                column: "project_id",
                unique: true,
                filter: "valid_to IS NULL");

            migrationBuilder.Sql("""
                ALTER TABLE project_standard_assignments
                ADD CONSTRAINT ck_project_standard_assignments_valid_range
                CHECK (valid_to IS NULL OR valid_to > valid_from);

                ALTER TABLE project_standard_assignments
                ADD CONSTRAINT ex_project_standard_assignments_no_overlap
                EXCLUDE USING gist (
                    project_id WITH =,
                    tstzrange(valid_from, valid_to, '[)') WITH &&
                );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE project_standard_assignments
                DROP CONSTRAINT IF EXISTS ex_project_standard_assignments_no_overlap;
                ALTER TABLE project_standard_assignments
                DROP CONSTRAINT IF EXISTS ck_project_standard_assignments_valid_range;
                """);
            migrationBuilder.DropTable(
                name: "project_standard_assignments");
        }
    }
}
