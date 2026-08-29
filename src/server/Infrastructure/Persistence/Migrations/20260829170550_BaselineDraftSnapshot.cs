using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BaselineDraftSnapshot : Migration
    {
        private static readonly string[] BaselineParentSortColumns = ["configuration_baseline_id", "parent_baseline_item_id", "sort_order"];
        private static readonly string[] BaselineComponentColumns = ["configuration_baseline_id", "configuration_component_id"];
        private static readonly string[] SeriesProjectCodeColumns = ["project_id", "normalized_series_code"];
        private static readonly string[] ProjectCodeColumns = ["project_id", "normalized_baseline_code"];
        private static readonly string[] SeriesRevisionColumns = ["baseline_series_id", "revision_no"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "baseline_series",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    series_code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    normalized_series_code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_baseline_series", x => x.id);
                    table.ForeignKey(
                        name: "FK_baseline_series_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "configuration_baselines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    baseline_series_id = table.Column<Guid>(type: "uuid", nullable: false),
                    supersedes_baseline_id = table.Column<Guid>(type: "uuid", nullable: true),
                    top_component_version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    baseline_code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    normalized_baseline_code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    revision_no = table.Column<int>(type: "integer", nullable: false),
                    description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    state = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    released_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    released_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    release_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    approved_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_configuration_baselines", x => x.id);
                    table.ForeignKey(
                        name: "FK_configuration_baselines_baseline_series_baseline_series_id",
                        column: x => x.baseline_series_id,
                        principalTable: "baseline_series",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_configuration_baselines_component_versions_top_component_ve~",
                        column: x => x.top_component_version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_configuration_baselines_configuration_baselines_supersedes_~",
                        column: x => x.supersedes_baseline_id,
                        principalTable: "configuration_baselines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_configuration_baselines_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "baseline_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    configuration_baseline_id = table.Column<Guid>(type: "uuid", nullable: false),
                    configuration_component_id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    parent_baseline_item_id = table.Column<Guid>(type: "uuid", nullable: true),
                    component_code_snapshot = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    component_name_snapshot = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    lineage_key_snapshot = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    requirement = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_baseline_items", x => x.id);
                    table.ForeignKey(
                        name: "FK_baseline_items_baseline_items_parent_baseline_item_id",
                        column: x => x.parent_baseline_item_id,
                        principalTable: "baseline_items",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_baseline_items_component_versions_component_version_id",
                        column: x => x.component_version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_baseline_items_configuration_baselines_configuration_baseli~",
                        column: x => x.configuration_baseline_id,
                        principalTable: "configuration_baselines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_baseline_items_configuration_components_configuration_compo~",
                        column: x => x.configuration_component_id,
                        principalTable: "configuration_components",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_baseline_items_baseline_parent_sort",
                table: "baseline_items",
                columns: BaselineParentSortColumns);

            migrationBuilder.CreateIndex(
                name: "IX_baseline_items_configuration_component_id",
                table: "baseline_items",
                column: "configuration_component_id");

            migrationBuilder.CreateIndex(
                name: "IX_baseline_items_parent_baseline_item_id",
                table: "baseline_items",
                column: "parent_baseline_item_id");

            migrationBuilder.CreateIndex(
                name: "ix_baseline_items_version",
                table: "baseline_items",
                column: "component_version_id");

            migrationBuilder.CreateIndex(
                name: "ux_baseline_items_baseline_component",
                table: "baseline_items",
                columns: BaselineComponentColumns,
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_baseline_series_project_code",
                table: "baseline_series",
                columns: SeriesProjectCodeColumns,
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_configuration_baselines_supersedes_baseline_id",
                table: "configuration_baselines",
                column: "supersedes_baseline_id");

            migrationBuilder.CreateIndex(
                name: "ix_configuration_baselines_top_version",
                table: "configuration_baselines",
                column: "top_component_version_id");

            migrationBuilder.CreateIndex(
                name: "ux_configuration_baselines_project_code",
                table: "configuration_baselines",
                columns: ProjectCodeColumns,
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_configuration_baselines_series_revision",
                table: "configuration_baselines",
                columns: SeriesRevisionColumns,
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "baseline_items");

            migrationBuilder.DropTable(
                name: "configuration_baselines");

            migrationBuilder.DropTable(
                name: "baseline_series");
        }
    }
}
