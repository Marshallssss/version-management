using System;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CatalogFoundation : Migration
    {
        private static readonly string[] AuditEventsEntityOccurredAtColumns = ["entity_type", "entity_id", "occurred_at"];
        private static readonly string[] ComponentVersionsNormalizedNumberColumns = ["component_id", "normalized_version_number"];
        private static readonly string[] ComponentVersionsSequenceNoColumns = ["component_id", "sequence_no"];
        private static readonly string[] ComponentsProjectParentSortColumns = ["project_id", "parent_component_id", "sort_order"];
        private static readonly string[] ComponentsProjectCodeColumns = ["project_id", "normalized_component_code"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "audit_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    action = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    entity_type = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    correlation_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    data = table.Column<JsonDocument>(type: "jsonb", nullable: true),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_events", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "projects",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    normalized_code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_projects", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "configuration_components",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    parent_component_id = table.Column<Guid>(type: "uuid", nullable: true),
                    component_code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    normalized_component_code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_configuration_components", x => x.id);
                    table.ForeignKey(
                        name: "FK_configuration_components_configuration_components_parent_co~",
                        column: x => x.parent_component_id,
                        principalTable: "configuration_components",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_configuration_components_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "component_versions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_number = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    normalized_version_number = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    sequence_no = table.Column<long>(type: "bigint", nullable: false),
                    maturity = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    safety = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_component_versions", x => x.id);
                    table.ForeignKey(
                        name: "FK_component_versions_configuration_components_component_id",
                        column: x => x.component_id,
                        principalTable: "configuration_components",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_correlation_id",
                table: "audit_events",
                column: "correlation_id");

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_entity_occurred_at",
                table: "audit_events",
                columns: AuditEventsEntityOccurredAtColumns);

            migrationBuilder.CreateIndex(
                name: "ux_component_versions_normalized_number",
                table: "component_versions",
                columns: ComponentVersionsNormalizedNumberColumns,
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_component_versions_sequence_no",
                table: "component_versions",
                columns: ComponentVersionsSequenceNoColumns,
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_components_project_parent_sort",
                table: "configuration_components",
                columns: ComponentsProjectParentSortColumns);

            migrationBuilder.CreateIndex(
                name: "IX_configuration_components_parent_component_id",
                table: "configuration_components",
                column: "parent_component_id");

            migrationBuilder.CreateIndex(
                name: "ux_components_project_code",
                table: "configuration_components",
                columns: ComponentsProjectCodeColumns,
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_projects_status",
                table: "projects",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ux_projects_normalized_code",
                table: "projects",
                column: "normalized_code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit_events");

            migrationBuilder.DropTable(
                name: "component_versions");

            migrationBuilder.DropTable(
                name: "configuration_components");

            migrationBuilder.DropTable(
                name: "projects");
        }
    }
}
