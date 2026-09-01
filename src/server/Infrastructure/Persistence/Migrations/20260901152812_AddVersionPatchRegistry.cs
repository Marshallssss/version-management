using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddVersionPatchRegistry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "version_patches",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    patch_code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    normalized_patch_code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    issue_description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    resolution_description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    recorded_by = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    recorded_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_version_patches", x => x.id);
                    table.ForeignKey(
                        name: "FK_version_patches_component_versions_component_version_id",
                        column: x => x.component_version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_version_patches_code",
                table: "version_patches",
                column: "normalized_patch_code");

            migrationBuilder.CreateIndex(
                name: "ix_version_patches_version_recorded_at",
                table: "version_patches",
                columns: new[] { "component_version_id", "recorded_at" });

            migrationBuilder.CreateIndex(
                name: "ux_version_patches_version_code",
                table: "version_patches",
                columns: new[] { "component_version_id", "normalized_patch_code" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "version_patches");
        }
    }
}
#pragma warning restore CA1861
