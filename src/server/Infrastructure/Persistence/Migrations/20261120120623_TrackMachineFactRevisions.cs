using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TrackMachineFactRevisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "revision_id",
                table: "machine_current_configurations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "revision_id",
                table: "deployment_items",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_component_version_revisions_id_component_version_id",
                table: "component_version_revisions",
                columns: ["id", "component_version_id"]);

            migrationBuilder.CreateIndex(
                name: "IX_machine_current_configurations_revision_id_component_versio~",
                table: "machine_current_configurations",
                columns: ["revision_id", "component_version_id"]);

            migrationBuilder.AddCheckConstraint(
                name: "ck_current_revision_version",
                table: "machine_current_configurations",
                sql: "revision_id IS NULL OR (component_version_id IS NOT NULL AND state = 'Present')");

            migrationBuilder.CreateIndex(
                name: "IX_deployment_items_revision_id_new_component_version_id",
                table: "deployment_items",
                columns: ["revision_id", "new_component_version_id"]);

            migrationBuilder.AddCheckConstraint(
                name: "ck_deployment_revision_version",
                table: "deployment_items",
                sql: "revision_id IS NULL OR (new_component_version_id IS NOT NULL AND result = 'Succeeded')");

            migrationBuilder.AddForeignKey(
                name: "FK_deployment_items_component_version_revisions_revision_id_ne~",
                table: "deployment_items",
                columns: ["revision_id", "new_component_version_id"],
                principalTable: "component_version_revisions",
                principalColumns: ["id", "component_version_id"],
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_machine_current_configurations_component_version_revisions_~",
                table: "machine_current_configurations",
                columns: ["revision_id", "component_version_id"],
                principalTable: "component_version_revisions",
                principalColumns: ["id", "component_version_id"],
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_deployment_items_component_version_revisions_revision_id_ne~",
                table: "deployment_items");

            migrationBuilder.DropForeignKey(
                name: "FK_machine_current_configurations_component_version_revisions_~",
                table: "machine_current_configurations");

            migrationBuilder.DropIndex(
                name: "IX_machine_current_configurations_revision_id_component_versio~",
                table: "machine_current_configurations");

            migrationBuilder.DropCheckConstraint(
                name: "ck_current_revision_version",
                table: "machine_current_configurations");

            migrationBuilder.DropIndex(
                name: "IX_deployment_items_revision_id_new_component_version_id",
                table: "deployment_items");

            migrationBuilder.DropCheckConstraint(
                name: "ck_deployment_revision_version",
                table: "deployment_items");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_component_version_revisions_id_component_version_id",
                table: "component_version_revisions");

            migrationBuilder.DropColumn(
                name: "revision_id",
                table: "machine_current_configurations");

            migrationBuilder.DropColumn(
                name: "revision_id",
                table: "deployment_items");
        }
    }
}
