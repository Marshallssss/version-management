using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeploymentBaselineReference : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "source_configuration_baseline_id",
                table: "deployment_batches",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_deployment_batches_source_baseline",
                table: "deployment_batches",
                column: "source_configuration_baseline_id");

            migrationBuilder.AddForeignKey(
                name: "FK_deployment_batches_configuration_baselines_source_configura~",
                table: "deployment_batches",
                column: "source_configuration_baseline_id",
                principalTable: "configuration_baselines",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_deployment_batches_configuration_baselines_source_configura~",
                table: "deployment_batches");

            migrationBuilder.DropIndex(
                name: "ix_deployment_batches_source_baseline",
                table: "deployment_batches");

            migrationBuilder.DropColumn(
                name: "source_configuration_baseline_id",
                table: "deployment_batches");
        }
    }
}
