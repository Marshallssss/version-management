using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MachineTargetAssignment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "machine_target_assignments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    machine_id = table.Column<Guid>(type: "uuid", nullable: false),
                    configuration_baseline_id = table.Column<Guid>(type: "uuid", nullable: false),
                    valid_from = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    valid_to = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    assigned_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_machine_target_assignments", x => x.id);
                    table.ForeignKey(
                        name: "FK_machine_target_assignments_configuration_baselines_configur~",
                        column: x => x.configuration_baseline_id,
                        principalTable: "configuration_baselines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_machine_target_assignments_machines_machine_id",
                        column: x => x.machine_id,
                        principalTable: "machines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_machine_target_assignments_configuration_baseline_id",
                table: "machine_target_assignments",
                column: "configuration_baseline_id");

            migrationBuilder.CreateIndex(
                name: "ux_machine_target_assignments_current_machine",
                table: "machine_target_assignments",
                column: "machine_id",
                unique: true,
                filter: "valid_to IS NULL");
            migrationBuilder.Sql("""
                ALTER TABLE machine_target_assignments ADD CONSTRAINT ck_machine_target_assignments_valid_range CHECK (valid_to IS NULL OR valid_to > valid_from);
                ALTER TABLE machine_target_assignments ADD CONSTRAINT ex_machine_target_assignments_no_overlap EXCLUDE USING gist (machine_id WITH =, tstzrange(valid_from, valid_to, '[)') WITH &&);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE machine_target_assignments DROP CONSTRAINT IF EXISTS ex_machine_target_assignments_no_overlap; ALTER TABLE machine_target_assignments DROP CONSTRAINT IF EXISTS ck_machine_target_assignments_valid_range;");
            migrationBuilder.DropTable(
                name: "machine_target_assignments");
        }
    }
}
