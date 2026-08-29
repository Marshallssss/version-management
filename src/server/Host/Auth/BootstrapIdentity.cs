using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.AspNetCore.Identity;

namespace ConfigHub.Host.Auth;

public static class BootstrapIdentity
{
    private static readonly string[] Roles = ["Admin", "SeniorEngineer", "Engineer", "Viewer"];

    public static async Task EnsureAsync(IServiceProvider services, IConfiguration configuration)
    {
        var email = configuration["ConfigHub:BootstrapAdmin:Email"];
        var password = configuration["ConfigHub:BootstrapAdmin:Password"];
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            return;
        }

        using var scope = services.CreateScope();
        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        foreach (var role in Roles)
        {
            if (!await roleManager.RoleExistsAsync(role))
            {
                var result = await roleManager.CreateAsync(new IdentityRole<Guid>(role));
                if (!result.Succeeded) throw new InvalidOperationException(string.Join("; ", result.Errors.Select(error => error.Description)));
            }
        }

        var user = await userManager.FindByEmailAsync(email.Trim());
        if (user is null)
        {
            user = new ApplicationUser { Id = Guid.NewGuid(), UserName = email.Trim(), Email = email.Trim(), DisplayName = "本机管理员", EmailConfirmed = true };
            var result = await userManager.CreateAsync(user, password);
            if (!result.Succeeded) throw new InvalidOperationException(string.Join("; ", result.Errors.Select(error => error.Description)));
        }
        if (!await userManager.IsInRoleAsync(user, "Admin"))
        {
            var result = await userManager.AddToRoleAsync(user, "Admin");
            if (!result.Succeeded) throw new InvalidOperationException(string.Join("; ", result.Errors.Select(error => error.Description)));
        }
    }
}
