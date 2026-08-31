using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddVersionExposureSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "version_exposure_snapshots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    blocked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    blocked_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_version_exposure_snapshots", x => x.id);
                    table.ForeignKey(
                        name: "FK_version_exposure_snapshots_component_versions_component_ver~",
                        column: x => x.component_version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "version_exposure_baselines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_exposure_snapshot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    configuration_baseline_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_version_exposure_baselines", x => x.id);
                    table.ForeignKey(
                        name: "FK_version_exposure_baselines_configuration_baselines_configur~",
                        column: x => x.configuration_baseline_id,
                        principalTable: "configuration_baselines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_version_exposure_baselines_version_exposure_snapshots_versi~",
                        column: x => x.version_exposure_snapshot_id,
                        principalTable: "version_exposure_snapshots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "version_exposure_machines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_exposure_snapshot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    machine_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_version_exposure_machines", x => x.id);
                    table.ForeignKey(
                        name: "FK_version_exposure_machines_machines_machine_id",
                        column: x => x.machine_id,
                        principalTable: "machines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_version_exposure_machines_version_exposure_snapshots_versio~",
                        column: x => x.version_exposure_snapshot_id,
                        principalTable: "version_exposure_snapshots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_version_exposure_baselines_configuration_baseline_id",
                table: "version_exposure_baselines",
                column: "configuration_baseline_id");

            migrationBuilder.CreateIndex(
                name: "ux_version_exposure_baselines_snapshot_baseline",
                table: "version_exposure_baselines",
                columns: new[] { "version_exposure_snapshot_id", "configuration_baseline_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_version_exposure_machines_machine_id",
                table: "version_exposure_machines",
                column: "machine_id");

            migrationBuilder.CreateIndex(
                name: "ux_version_exposure_machines_snapshot_machine_role",
                table: "version_exposure_machines",
                columns: new[] { "version_exposure_snapshot_id", "machine_id", "role" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_version_exposure_snapshots_version_blocked_at",
                table: "version_exposure_snapshots",
                columns: new[] { "component_version_id", "blocked_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "version_exposure_baselines");

            migrationBuilder.DropTable(
                name: "version_exposure_machines");

            migrationBuilder.DropTable(
                name: "version_exposure_snapshots");
        }
    }
}
#pragma warning restore CA1861
