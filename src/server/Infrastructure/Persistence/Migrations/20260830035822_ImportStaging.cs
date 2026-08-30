using System;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ImportStaging : Migration
    {
        private static readonly string[] ImportBatchesProjectCreatedAtColumns = ["project_id", "created_at"];
        private static readonly string[] ImportRowsBatchRowColumns = ["import_batch_id", "row_number"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "import_batches",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_file_name = table.Column<string>(type: "character varying(260)", maxLength: 260, nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_import_batches", x => x.id);
                    table.ForeignKey(
                        name: "FK_import_batches_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "import_rows",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    import_batch_id = table.Column<Guid>(type: "uuid", nullable: false),
                    row_number = table.Column<int>(type: "integer", nullable: false),
                    payload = table.Column<JsonDocument>(type: "jsonb", nullable: false),
                    validation_error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_import_rows", x => x.id);
                    table.ForeignKey(
                        name: "FK_import_rows_import_batches_import_batch_id",
                        column: x => x.import_batch_id,
                        principalTable: "import_batches",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_import_batches_project_created_at",
                table: "import_batches",
                columns: ImportBatchesProjectCreatedAtColumns);

            migrationBuilder.CreateIndex(
                name: "ux_import_rows_batch_row",
                table: "import_rows",
                columns: ImportRowsBatchRowColumns,
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "import_rows");

            migrationBuilder.DropTable(
                name: "import_batches");
        }
    }
}
