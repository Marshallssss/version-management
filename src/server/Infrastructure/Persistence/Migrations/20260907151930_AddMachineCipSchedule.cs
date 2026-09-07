using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMachineCipSchedule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "expected_resume_at",
                table: "machines",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_machines_cip_expected_resume",
                table: "machines",
                sql: "(status IN ('ShortTermCip', 'LongTermCip') AND expected_resume_at IS NOT NULL) OR (status NOT IN ('ShortTermCip', 'LongTermCip') AND expected_resume_at IS NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_machines_cip_expected_resume",
                table: "machines");

            migrationBuilder.DropColumn(
                name: "expected_resume_at",
                table: "machines");
        }
    }
}
