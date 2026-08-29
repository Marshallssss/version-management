using System.Text.Json;

namespace ConfigHub.Worker.Jobs;

public interface IBackgroundJobHandler
{
    string JobType { get; }

    Task HandleAsync(JsonElement payload, CancellationToken cancellationToken);
}
