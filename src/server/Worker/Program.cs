using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Worker.Jobs;
using Microsoft.EntityFrameworkCore;

var builder = Host.CreateApplicationBuilder(args);
var localConfigurationPath = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    "ConfigHub",
    "appsettings.local.json");
builder.Configuration.AddJsonFile(localConfigurationPath, optional: true, reloadOnChange: true);

builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "ConfigHub Worker";
});

var connectionString = builder.Configuration.GetConnectionString("ConfigHub");
if (string.IsNullOrWhiteSpace(connectionString))
{
    connectionString = Environment.GetEnvironmentVariable(
        "ConnectionStrings__ConfigHub",
        EnvironmentVariableTarget.User);
}
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        "ConnectionStrings:ConfigHub is required. Set it with the ConnectionStrings__ConfigHub environment variable.");
}

builder.Services.AddPooledDbContextFactory<ConfigHubDbContext>(options =>
    options.UseNpgsql(connectionString));
builder.Services.AddSingleton<BackgroundJobLeaseService>();
builder.Services.AddSingleton<IBackgroundJobHandler, NoopBackgroundJobHandler>();
builder.Services.AddHostedService<BackgroundJobWorker>();

await builder.Build().RunAsync();
