using ConfigHub.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace ConfigHub.Host;

public sealed class DesignTimeConfigHubDbContextFactory : IDesignTimeDbContextFactory<ConfigHubDbContext>
{
    public ConfigHubDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<ConfigHubDbContext>();
        options.UseNpgsql(
            "Host=127.0.0.1;Port=5432;Database=confighub_design_time;Username=design_time;Password=not-used",
            npgsql => npgsql.MigrationsAssembly(typeof(ConfigHubDbContext).Assembly.GetName().Name));

        return new ConfigHubDbContext(options.Options);
    }
}
