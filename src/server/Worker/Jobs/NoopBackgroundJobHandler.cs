using System.Text.Json;

namespace ConfigHub.Worker.Jobs;

public sealed class NoopBackgroundJobHandler(ILogger<NoopBackgroundJobHandler> logger)
    : IBackgroundJobHandler
{
    public string JobType => "system.noop";

    public Task HandleAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        logger.LogInformation("Processed system.noop background job with payload {Payload}.", payload);
        return Task.CompletedTask;
    }
}
