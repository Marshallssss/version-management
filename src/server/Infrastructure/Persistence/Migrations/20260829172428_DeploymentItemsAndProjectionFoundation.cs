using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DeploymentItemsAndProjectionFoundation : Migration
    {
        private static readonly string[] VersionResultColumns = ["new_component_version_id", "result"];
        private static readonly string[] BatchComponentColumns = ["deployment_batch_id", "configuration_component_id"];
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "deployment_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    deployment_batch_id = table.Column<Guid>(type: "uuid", nullable: false),
                    configuration_component_id = table.Column<Guid>(type: "uuid", nullable: false),
                    new_component_version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    result = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    known_installed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_deployment_items", x => x.id);
                    table.ForeignKey(
                        name: "FK_deployment_items_component_versions_new_component_version_id",
                        column: x => x.new_component_version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_deployment_items_configuration_components_configuration_com~",
                        column: x => x.configuration_component_id,
                        principalTable: "configuration_components",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_deployment_items_deployment_batches_deployment_batch_id",
                        column: x => x.deployment_batch_id,
                        principalTable: "deployment_batches",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_deployment_items_configuration_component_id",
                table: "deployment_items",
                column: "configuration_component_id");

            migrationBuilder.CreateIndex(
                name: "ix_deployment_items_version_result",
                table: "deployment_items",
                columns: VersionResultColumns);

            migrationBuilder.CreateIndex(
                name: "ux_deployment_items_batch_component",
                table: "deployment_items",
                columns: BatchComponentColumns,
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "deployment_items");
        }
    }
}
