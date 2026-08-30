using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BaselineVersionNumberSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "version_number_snapshot",
                table: "baseline_items",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql("ALTER TABLE baseline_items DISABLE TRIGGER USER; UPDATE baseline_items AS item SET version_number_snapshot = version.version_number FROM component_versions AS version WHERE version.id = item.component_version_id; ALTER TABLE baseline_items ENABLE TRIGGER USER;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "version_number_snapshot",
                table: "baseline_items");
        }
    }
}
