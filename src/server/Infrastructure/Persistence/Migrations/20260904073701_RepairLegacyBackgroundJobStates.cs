using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RepairLegacyBackgroundJobStates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE background_jobs
                SET status = CASE status
                    WHEN 'Processing' THEN 'Running'
                    WHEN 'Completed' THEN 'Succeeded'
                    ELSE status
                END
                WHERE status IN ('Processing', 'Completed');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
