using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class HistoricalBaselineExcelImport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "supports_history",
                table: "matrix_import_templates",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "is_historical",
                table: "configuration_baselines",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "historical_version_state",
                table: "baseline_items",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "not_configured",
                table: "baseline_items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "matrix_historical_records",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    row_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    baseline_id = table.Column<Guid>(type: "uuid", nullable: false),
                    recorded_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_matrix_historical_records", x => x.id);
                    table.ForeignKey(
                        name: "FK_matrix_historical_records_configuration_baselines_baseline_~",
                        column: x => x.baseline_id,
                        principalTable: "configuration_baselines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_matrix_historical_records_matrix_import_templates_template_~",
                        column: x => x.template_id,
                        principalTable: "matrix_import_templates",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_baseline_item_not_configured",
                table: "baseline_items",
                sql: "NOT not_configured OR (component_version_id IS NULL AND historical_version_state IS NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_matrix_historical_records_baseline_id",
                table: "matrix_historical_records",
                column: "baseline_id");

            migrationBuilder.CreateIndex(
                name: "IX_matrix_historical_records_template_id_row_key",
                table: "matrix_historical_records",
                columns: ["template_id", "row_key"],
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "matrix_historical_records");

            migrationBuilder.DropCheckConstraint(
                name: "ck_baseline_item_not_configured",
                table: "baseline_items");

            migrationBuilder.DropColumn(
                name: "supports_history",
                table: "matrix_import_templates");

            migrationBuilder.DropColumn(
                name: "is_historical",
                table: "configuration_baselines");

            migrationBuilder.DropColumn(
                name: "historical_version_state",
                table: "baseline_items");

            migrationBuilder.DropColumn(
                name: "not_configured",
                table: "baseline_items");
        }
    }
}
