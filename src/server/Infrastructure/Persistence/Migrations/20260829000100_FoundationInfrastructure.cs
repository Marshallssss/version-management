using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace ConfigHub.Infrastructure.Persistence.Migrations;

[DbContext(typeof(ConfigHubDbContext))]
[Migration("20260829000100_FoundationInfrastructure")]
public sealed class FoundationInfrastructure : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS btree_gist;");

        migrationBuilder.CreateTable(
            name: "background_jobs",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                job_type = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                payload = table.Column<string>(type: "jsonb", nullable: false),
                status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                available_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                locked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                locked_by = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: true),
                attempts = table.Column<int>(type: "integer", nullable: false),
                created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                last_error = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true)
            },
            constraints: table => table.PrimaryKey("pk_background_jobs", column => column.id));

        migrationBuilder.CreateTable(
            name: "idempotency_records",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                scope = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                idempotency_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                request_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                result = table.Column<string>(type: "jsonb", nullable: true),
                reference = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table => table.PrimaryKey("pk_idempotency_records", column => column.id));

        migrationBuilder.CreateIndex(
            name: "ix_background_jobs_claim",
            table: "background_jobs",
            columns: new[] { "status", "available_at" });

        migrationBuilder.CreateIndex(
            name: "ix_background_jobs_created_at",
            table: "background_jobs",
            column: "created_at");

        migrationBuilder.CreateIndex(
            name: "ix_idempotency_records_expires_at",
            table: "idempotency_records",
            column: "expires_at");

        migrationBuilder.CreateIndex(
            name: "ux_idempotency_records_scope_key",
            table: "idempotency_records",
            columns: new[] { "scope", "idempotency_key" },
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "background_jobs");
        migrationBuilder.DropTable(name: "idempotency_records");
    }
}
