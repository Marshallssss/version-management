using System.Text.Json;

namespace ConfigHub.Worker.Jobs;

public sealed partial class NoopBackgroundJobHandler(ILogger<NoopBackgroundJobHandler> logger)
    : IBackgroundJobHandler
{
    public string JobType => "system.noop";

    public Task HandleAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        LogProcessedNoopBackgroundJob(logger, payload);
        return Task.CompletedTask;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Processed system.noop background job with payload {Payload}.")]
    private static partial void LogProcessedNoopBackgroundJob(ILogger logger, JsonElement payload);
}
