using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FreezeBaselineRevisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "revision_id",
                table: "baseline_items",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_baseline_items_revision_id_component_version_id",
                table: "baseline_items",
                columns: ["revision_id", "component_version_id"]);

            migrationBuilder.AddCheckConstraint(
                name: "ck_baseline_revision_version",
                table: "baseline_items",
                sql: "revision_id IS NULL OR (component_version_id IS NOT NULL AND NOT not_configured)");

            migrationBuilder.AddForeignKey(
                name: "FK_baseline_items_component_version_revisions_revision_id_comp~",
                table: "baseline_items",
                columns: ["revision_id", "component_version_id"],
                principalTable: "component_version_revisions",
                principalColumns: ["id", "component_version_id"],
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_baseline_items_component_version_revisions_revision_id_comp~",
                table: "baseline_items");

            migrationBuilder.DropIndex(
                name: "IX_baseline_items_revision_id_component_version_id",
                table: "baseline_items");

            migrationBuilder.DropCheckConstraint(
                name: "ck_baseline_revision_version",
                table: "baseline_items");

            migrationBuilder.DropColumn(
                name: "revision_id",
                table: "baseline_items");
        }
    }
}
