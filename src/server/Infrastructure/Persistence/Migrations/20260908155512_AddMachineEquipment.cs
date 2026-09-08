using System;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // EF-generated migration uses one-shot index column arrays.

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMachineEquipment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "deleted_at",
                table: "machines",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "owner",
                table: "machines",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "stage",
                table: "machines",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "machine_chambers",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    machine_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false),
                    installed = table.Column<bool>(type: "boolean", nullable: false),
                    stage = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_machine_chambers", x => x.id);
                    table.CheckConstraint("ck_chamber_number", "number BETWEEN 1 AND 6");
                    table.CheckConstraint("ck_chamber_stage", "stage IN ('Lab','MoveIn','T0','T1','T2','T3','STR','HVM')");
                    table.ForeignKey(
                        name: "FK_machine_chambers_machines_machine_id",
                        column: x => x.machine_id,
                        principalTable: "machines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "machine_equipment_history",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    machine_id = table.Column<Guid>(type: "uuid", nullable: false),
                    chamber_number = table.Column<int>(type: "integer", nullable: true),
                    kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    actor = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    correlation_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    recorded_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    details = table.Column<JsonDocument>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_machine_equipment_history", x => x.id);
                    table.ForeignKey(
                        name: "FK_machine_equipment_history_machines_machine_id",
                        column: x => x.machine_id,
                        principalTable: "machines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "machine_chamber_versions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    chamber_id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    sequence = table.Column<long>(type: "bigint", nullable: false),
                    history_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_machine_chamber_versions", x => x.id);
                    table.ForeignKey(
                        name: "FK_machine_chamber_versions_component_versions_version_id",
                        column: x => x.version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_machine_chamber_versions_configuration_components_component~",
                        column: x => x.component_id,
                        principalTable: "configuration_components",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_machine_chamber_versions_machine_chambers_chamber_id",
                        column: x => x.chamber_id,
                        principalTable: "machine_chambers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_machine_chamber_versions_machine_equipment_history_history_~",
                        column: x => x.history_id,
                        principalTable: "machine_equipment_history",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_machine_stage",
                table: "machines",
                sql: "stage IS NULL OR stage IN ('Lab','MoveIn','T0','T1','T2','T3','STR','HVM')");

            migrationBuilder.CreateIndex(
                name: "IX_machine_chamber_versions_chamber_id_component_id_sequence",
                table: "machine_chamber_versions",
                columns: new[] { "chamber_id", "component_id", "sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_machine_chamber_versions_component_id",
                table: "machine_chamber_versions",
                column: "component_id");

            migrationBuilder.CreateIndex(
                name: "IX_machine_chamber_versions_history_id",
                table: "machine_chamber_versions",
                column: "history_id");

            migrationBuilder.CreateIndex(
                name: "IX_machine_chamber_versions_version_id",
                table: "machine_chamber_versions",
                column: "version_id");

            migrationBuilder.CreateIndex(
                name: "IX_machine_chambers_machine_id_number",
                table: "machine_chambers",
                columns: new[] { "machine_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_machine_equipment_history_machine_id_recorded_at",
                table: "machine_equipment_history",
                columns: new[] { "machine_id", "recorded_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "machine_chamber_versions");

            migrationBuilder.DropTable(
                name: "machine_chambers");

            migrationBuilder.DropTable(
                name: "machine_equipment_history");

            migrationBuilder.DropCheckConstraint(
                name: "ck_machine_stage",
                table: "machines");

            migrationBuilder.DropColumn(
                name: "deleted_at",
                table: "machines");

            migrationBuilder.DropColumn(
                name: "owner",
                table: "machines");

            migrationBuilder.DropColumn(
                name: "stage",
                table: "machines");
        }
    }
}
