using System.Text.Json;
using ConfigHub.Infrastructure.ExcelImport;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Worker.Jobs;

public sealed partial class MatrixImportScheduler(IDbContextFactory<ConfigHubDbContext> factory, ILogger<MatrixImportScheduler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var db = await factory.CreateDbContextAsync(stoppingToken);
                await using var tx = await db.Database.BeginTransactionAsync(stoppingToken);
                var now = DateTimeOffset.UtcNow;
                var sources = await db.MatrixImportSources.FromSqlInterpolated($"SELECT * FROM matrix_import_sources WHERE enabled AND next_scan_at <= {now} ORDER BY next_scan_at FOR UPDATE SKIP LOCKED LIMIT 10").ToListAsync(stoppingToken);
                foreach (var source in sources)
                {
                    if (!await db.Projects.AnyAsync(x => x.Id == source.ProjectId && x.Status == ProjectStatus.Active, stoppingToken)) { source.Enabled = false; continue; }
                    db.BackgroundJobs.Add(new() { Id = Guid.NewGuid(), JobType = "MatrixImport.File", Payload = MatrixImportService.Document(new { sourceId = source.Id, key = $"schedule:{source.Id}:{source.NextScanAt:O}" }), Status = BackgroundJobStatus.Pending, CreatedAt = now, AvailableAt = now });
                    source.NextScanAt = MatrixImportService.NextScan(source.LocalTime, source.TimeZoneId, now);
                    source.LastStatus = "Pending";
                }
                await db.SaveChangesAsync(stoppingToken);
                await tx.CommitAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { LogPollingFailed(logger, error); }
            await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Excel schedule polling failed.")]
    private static partial void LogPollingFailed(ILogger logger, Exception exception);
}

public sealed class MatrixImportJobHandler(IDbContextFactory<ConfigHubDbContext> factory) : IBackgroundJobHandler
{
    public string JobType => "MatrixImport.File";
    public async Task HandleAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var id = payload.GetProperty("sourceId").GetGuid();
        var source = await db.MatrixImportSources.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (source is null || !source.Enabled) return;
        if (!await MatrixImportService.CanImportAsync(db, source.AuthorizedByUserId, source.ProjectId, cancellationToken, true))
        {
            source.Enabled = false; source.LastStatus = "Failed";
            MatrixImportService.Audit(db, new($"自动扫描:{source.Id}", payload.GetProperty("key").GetString()!), "MatrixSourceAuthorizationExpired", source.Id, new { reason = "扫描源授权已失效，自动扫描已暂停。" });
            await db.SaveChangesAsync(cancellationToken);
            return;
        }
        var key = payload.GetProperty("key").GetString()!;
        await MatrixImportService.ScanAsync(factory, source.ProjectId, source.TemplateId, source.AuthorizedByUserId,
            $"自动扫描:{source.Id}", key, key, "每日项目版本台账扫描", source.Path, null, source.Id, cancellationToken);
    }
}
