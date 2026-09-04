using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConfigHub.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class EnforceSingleTestingVersionPerComponent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                WITH ranked AS (
                    SELECT id,
                           row_number() OVER (PARTITION BY component_id ORDER BY created_at DESC, id DESC) AS position
                    FROM component_versions
                    WHERE maturity = 'Testing'
                ), deprecated AS (
                    UPDATE component_versions AS version
                    SET maturity = 'Deprecated'
                    FROM ranked
                    WHERE version.id = ranked.id AND ranked.position > 1
                    RETURNING version.id
                )
                INSERT INTO version_lifecycle_transitions
                    (id, component_version_id, axis, from_state, to_state, reason, actor, occurred_at)
                SELECT md5(id::text || ':testing-dedup-transition')::uuid,
                       id,
                       'Maturity',
                       'Testing',
                       'Deprecated',
                       '迁移修复：同一组件仅保留最新测试版本',
                       'system:migration',
                       CURRENT_TIMESTAMP
                FROM deprecated;

                WITH transitions AS (
                    SELECT component_version_id
                    FROM version_lifecycle_transitions
                    WHERE reason = '迁移修复：同一组件仅保留最新测试版本'
                      AND actor = 'system:migration'
                )
                INSERT INTO audit_events
                    (id, actor, action, entity_type, entity_id, correlation_id, data, occurred_at)
                SELECT md5(component_version_id::text || ':testing-dedup-audit')::uuid,
                       'system:migration',
                       'VersionMaturityChanged',
                       'ComponentVersion',
                       component_version_id,
                       'migration:single-testing-version',
                       jsonb_build_object('from', 'Testing', 'to', 'Deprecated', 'source', 'Migration'),
                       CURRENT_TIMESTAMP
                FROM transitions
                ON CONFLICT (id) DO NOTHING;
                """);
            migrationBuilder.CreateIndex(
                name: "ux_component_versions_one_testing_per_component",
                table: "component_versions",
                column: "component_id",
                unique: true,
                filter: "maturity = 'Testing'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ux_component_versions_one_testing_per_component",
                table: "component_versions");
        }
    }
}
