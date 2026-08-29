using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class VersionLifecycleHistory : Migration
    {
        private static readonly string[] VersionLifecycleTransitionColumns = ["component_version_id", "occurred_at"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "version_lifecycle_transitions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    axis = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    from_state = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    to_state = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    actor = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_version_lifecycle_transitions", x => x.id);
                    table.ForeignKey(
                        name: "FK_version_lifecycle_transitions_component_versions_component_~",
                        column: x => x.component_version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "version_recommendations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    assigned_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    assigned_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoked_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    revoke_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_version_recommendations", x => x.id);
                    table.ForeignKey(
                        name: "FK_version_recommendations_component_versions_component_versio~",
                        column: x => x.component_version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_version_recommendations_configuration_components_component_~",
                        column: x => x.component_id,
                        principalTable: "configuration_components",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_version_lifecycle_transitions_version_occurred_at",
                table: "version_lifecycle_transitions",
                columns: VersionLifecycleTransitionColumns);

            migrationBuilder.CreateIndex(
                name: "IX_version_recommendations_component_version_id",
                table: "version_recommendations",
                column: "component_version_id");

            migrationBuilder.CreateIndex(
                name: "ux_version_recommendations_active_component",
                table: "version_recommendations",
                column: "component_id",
                unique: true,
                filter: "revoked_at IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "version_lifecycle_transitions");

            migrationBuilder.DropTable(
                name: "version_recommendations");
        }
    }
}
