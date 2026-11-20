using System;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddImmutableVersionRevisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "component_version_revisions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision_no = table.Column<int>(type: "integer", nullable: false),
                    patches = table.Column<JsonDocument>(type: "jsonb", nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    actor = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    correlation_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_component_version_revisions", x => x.id);
                    table.CheckConstraint("ck_revision_number", "revision_no >= 0");
                    table.ForeignKey(
                        name: "FK_component_version_revisions_component_versions_component_ve~",
                        column: x => x.component_version_id,
                        principalTable: "component_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_component_version_revisions_component_version_id_revision_no",
                table: "component_version_revisions",
                columns: ["component_version_id", "revision_no"],
                unique: true);
            migrationBuilder.Sql("""
                CREATE FUNCTION guard_immutable_version_revision() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  RAISE EXCEPTION 'Published version revision is immutable' USING ERRCODE='23514', CONSTRAINT='ck_immutable_version_revision';
                END $$;
                CREATE TRIGGER immutable_version_revision BEFORE UPDATE OR DELETE ON component_version_revisions FOR EACH ROW EXECUTE FUNCTION guard_immutable_version_revision();
                CREATE TRIGGER retained_revision_version BEFORE INSERT ON component_version_revisions FOR EACH ROW EXECUTE FUNCTION guard_retained_version_reference('component_version_id');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "component_version_revisions");
            migrationBuilder.Sql("DROP FUNCTION guard_immutable_version_revision();");
        }
    }
}
