using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ObservePmRevisionConfigurations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "effective_at",
                table: "machine_chamber_versions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_unknown",
                table: "machine_chamber_versions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "known_installed_at",
                table: "machine_chamber_versions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "revision_id",
                table: "machine_chamber_versions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_pm_root",
                table: "configuration_components",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_machine_chamber_versions_revision_id_version_id",
                table: "machine_chamber_versions",
                columns: ["revision_id", "version_id"]);

            migrationBuilder.AddCheckConstraint(
                name: "ck_chamber_revision_state",
                table: "machine_chamber_versions",
                sql: "(revision_id IS NULL OR version_id IS NOT NULL) AND (NOT is_unknown OR (version_id IS NULL AND revision_id IS NULL AND known_installed_at IS NULL))");

            migrationBuilder.CreateIndex(
                name: "ux_project_pm_root",
                table: "configuration_components",
                column: "project_id",
                unique: true,
                filter: "is_pm_root");

            migrationBuilder.AddCheckConstraint(
                name: "ck_pm_root",
                table: "configuration_components",
                sql: "NOT is_pm_root OR parent_component_id IS NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_machine_chamber_versions_component_version_revisions_revisi~",
                table: "machine_chamber_versions",
                columns: ["revision_id", "version_id"],
                principalTable: "component_version_revisions",
                principalColumns: ["id", "component_version_id"],
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_machine_chamber_versions_component_version_revisions_revisi~",
                table: "machine_chamber_versions");

            migrationBuilder.DropIndex(
                name: "IX_machine_chamber_versions_revision_id_version_id",
                table: "machine_chamber_versions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_chamber_revision_state",
                table: "machine_chamber_versions");

            migrationBuilder.DropIndex(
                name: "ux_project_pm_root",
                table: "configuration_components");

            migrationBuilder.DropCheckConstraint(
                name: "ck_pm_root",
                table: "configuration_components");

            migrationBuilder.DropColumn(
                name: "effective_at",
                table: "machine_chamber_versions");

            migrationBuilder.DropColumn(
                name: "is_unknown",
                table: "machine_chamber_versions");

            migrationBuilder.DropColumn(
                name: "known_installed_at",
                table: "machine_chamber_versions");

            migrationBuilder.DropColumn(
                name: "revision_id",
                table: "machine_chamber_versions");

            migrationBuilder.DropColumn(
                name: "is_pm_root",
                table: "configuration_components");
        }
    }
}
