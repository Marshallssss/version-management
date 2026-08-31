using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1861 // EF generated composite index column list.

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBaselineReviewWorkflow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "baseline_reviews",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    configuration_baseline_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    requested_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    request_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    decided_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    decided_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    decision_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_baseline_reviews", x => x.id);
                    table.ForeignKey(
                        name: "FK_baseline_reviews_configuration_baselines_configuration_base~",
                        column: x => x.configuration_baseline_id,
                        principalTable: "configuration_baselines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_baseline_reviews_baseline_requested_at",
                table: "baseline_reviews",
                columns: new[] { "configuration_baseline_id", "requested_at" });

            migrationBuilder.CreateIndex(
                name: "ux_baseline_reviews_pending_baseline",
                table: "baseline_reviews",
                column: "configuration_baseline_id",
                unique: true,
                filter: "status = 'Pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "baseline_reviews");
        }
    }
}

#pragma warning restore CA1861
