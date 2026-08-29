using Microsoft.AspNetCore.Identity;

namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public required string DisplayName { get; set; }
}
