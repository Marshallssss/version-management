using System;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // EF-generated migration uses one-shot index column arrays.

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ProjectMatrixImportAndLaboratoryValidation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "laboratory_validations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    machine_id = table.Column<Guid>(type: "uuid", nullable: false),
                    chamber_number = table.Column<int>(type: "integer", nullable: true),
                    result = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    recorded_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    actor = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    correlation_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    evidence_id = table.Column<Guid>(type: "uuid", nullable: false),
                    evidence_kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    machine_stage = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    chamber_stage = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_laboratory_validations", x => x.id);
                    table.CheckConstraint("ck_laboratory_validation_chamber", "chamber_number IS NULL OR chamber_number BETWEEN 1 AND 6");
                    table.ForeignKey(
                        name: "FK_laboratory_validations_component_versions_component_version~",
                        column: x => x.component_version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_laboratory_validations_machines_machine_id",
                        column: x => x.machine_id,
                        principalTable: "machines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "matrix_import_runs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    file_name = table.Column<string>(type: "character varying(260)", maxLength: 260, nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    actor = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    imported_count = table.Column<int>(type: "integer", nullable: false),
                    skipped_count = table.Column<int>(type: "integer", nullable: false),
                    messages = table.Column<JsonDocument>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_matrix_import_runs", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "matrix_import_templates",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    reference_baseline_code = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    components = table.Column<JsonDocument>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_matrix_import_templates", x => x.id);
                    table.ForeignKey(
                        name: "FK_matrix_import_templates_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "matrix_import_combinations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    run_id = table.Column<Guid>(type: "uuid", nullable: false),
                    row_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    source_row = table.Column<int>(type: "integer", nullable: false),
                    sequence_no = table.Column<long>(type: "bigint", nullable: false),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    record_date = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    items = table.Column<JsonDocument>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_matrix_import_combinations", x => x.id);
                    table.ForeignKey(
                        name: "FK_matrix_import_combinations_matrix_import_templates_template~",
                        column: x => x.template_id,
                        principalTable: "matrix_import_templates",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "matrix_import_sources",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    path = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    local_time = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: false),
                    time_zone_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    authorized_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    next_scan_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_scan_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_status = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_matrix_import_sources", x => x.id);
                    table.ForeignKey(
                        name: "FK_matrix_import_sources_matrix_import_templates_template_id",
                        column: x => x.template_id,
                        principalTable: "matrix_import_templates",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "matrix_import_references",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    combination_id = table.Column<Guid>(type: "uuid", nullable: true),
                    component_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_matrix_import_references", x => x.id);
                    table.ForeignKey(
                        name: "FK_matrix_import_references_component_versions_version_id",
                        column: x => x.version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_matrix_import_references_configuration_components_component~",
                        column: x => x.component_id,
                        principalTable: "configuration_components",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_matrix_import_references_matrix_import_combinations_combina~",
                        column: x => x.combination_id,
                        principalTable: "matrix_import_combinations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_matrix_import_references_matrix_import_templates_template_id",
                        column: x => x.template_id,
                        principalTable: "matrix_import_templates",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_laboratory_validations_component_version_id_recorded_at",
                table: "laboratory_validations",
                columns: new[] { "component_version_id", "recorded_at" });

            migrationBuilder.CreateIndex(
                name: "IX_laboratory_validations_machine_id",
                table: "laboratory_validations",
                column: "machine_id");

            migrationBuilder.CreateIndex(
                name: "IX_matrix_import_combinations_template_id_row_key",
                table: "matrix_import_combinations",
                columns: new[] { "template_id", "row_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_matrix_import_combinations_template_id_sequence_no",
                table: "matrix_import_combinations",
                columns: new[] { "template_id", "sequence_no" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_matrix_import_references_combination_id",
                table: "matrix_import_references",
                column: "combination_id");

            migrationBuilder.CreateIndex(
                name: "IX_matrix_import_references_component_id",
                table: "matrix_import_references",
                column: "component_id");

            migrationBuilder.CreateIndex(
                name: "IX_matrix_import_references_template_id",
                table: "matrix_import_references",
                column: "template_id");

            migrationBuilder.CreateIndex(
                name: "IX_matrix_import_references_version_id",
                table: "matrix_import_references",
                column: "version_id");

            migrationBuilder.CreateIndex(
                name: "IX_matrix_import_runs_project_id_created_at",
                table: "matrix_import_runs",
                columns: new[] { "project_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_matrix_import_sources_project_id",
                table: "matrix_import_sources",
                column: "project_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_matrix_import_sources_template_id",
                table: "matrix_import_sources",
                column: "template_id");

            migrationBuilder.CreateIndex(
                name: "IX_matrix_import_templates_project_id_created_at",
                table: "matrix_import_templates",
                columns: new[] { "project_id", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "laboratory_validations");

            migrationBuilder.DropTable(
                name: "matrix_import_references");

            migrationBuilder.DropTable(
                name: "matrix_import_runs");

            migrationBuilder.DropTable(
                name: "matrix_import_sources");

            migrationBuilder.DropTable(
                name: "matrix_import_combinations");

            migrationBuilder.DropTable(
                name: "matrix_import_templates");
        }
    }
}
