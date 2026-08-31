using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeploymentFactCorrectionLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "corrects_deployment_batch_id",
                table: "deployment_batches",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_deployment_batches_corrects_batch",
                table: "deployment_batches",
                column: "corrects_deployment_batch_id");

            migrationBuilder.AddForeignKey(
                name: "FK_deployment_batches_deployment_batches_corrects_deployment_b~",
                table: "deployment_batches",
                column: "corrects_deployment_batch_id",
                principalTable: "deployment_batches",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_deployment_batches_deployment_batches_corrects_deployment_b~",
                table: "deployment_batches");

            migrationBuilder.DropIndex(
                name: "ix_deployment_batches_corrects_batch",
                table: "deployment_batches");

            migrationBuilder.DropColumn(
                name: "corrects_deployment_batch_id",
                table: "deployment_batches");
        }
    }
}
