using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MachineCurrentConfigurationProjection : Migration
    {
        private static readonly string[] VersionMachineColumns = ["component_version_id", "machine_id"];
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "machine_current_configurations",
                columns: table => new
                {
                    machine_id = table.Column<Guid>(type: "uuid", nullable: false),
                    configuration_component_id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    state = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    state_effective_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    known_installed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    source_deployment_item_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_machine_current_configurations", x => new { x.machine_id, x.configuration_component_id });
                    table.ForeignKey(
                        name: "FK_machine_current_configurations_component_versions_component~",
                        column: x => x.component_version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_machine_current_configurations_configuration_components_con~",
                        column: x => x.configuration_component_id,
                        principalTable: "configuration_components",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_machine_current_configurations_deployment_items_source_depl~",
                        column: x => x.source_deployment_item_id,
                        principalTable: "deployment_items",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_machine_current_configurations_machines_machine_id",
                        column: x => x.machine_id,
                        principalTable: "machines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_machine_current_configurations_configuration_component_id",
                table: "machine_current_configurations",
                column: "configuration_component_id");

            migrationBuilder.CreateIndex(
                name: "IX_machine_current_configurations_source_deployment_item_id",
                table: "machine_current_configurations",
                column: "source_deployment_item_id");

            migrationBuilder.CreateIndex(
                name: "ix_machine_current_configurations_version_machine",
                table: "machine_current_configurations",
                columns: VersionMachineColumns);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "machine_current_configurations");
        }
    }
}
