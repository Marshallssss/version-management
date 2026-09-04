using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.AspNetCore.Identity;

namespace ConfigHub.Host.Auth;

public static class BootstrapIdentity
{
    private static readonly string[] Roles = ["SuperAdmin", "Admin", "SeniorEngineer", "Engineer", "Viewer"];

    public static async Task EnsureAsync(IServiceProvider services, IConfiguration configuration)
    {
        await EnsureAsync(services, configuration, writeStatus: false);
    }

    public static async Task EnsureAsync(IServiceProvider services, IConfiguration configuration, bool writeStatus)
    {
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

        if (!writeStatus && (await userManager.GetUsersInRoleAsync("Admin")).Count > 0)
        {
            return;
        }

        var userName = Environment.GetEnvironmentVariable("ConfigHub__BootstrapAdmin__UserName");
        if (string.IsNullOrWhiteSpace(userName))
        {
            userName = Environment.GetEnvironmentVariable("ConfigHub__BootstrapAdmin__Email");
        }
        if (string.IsNullOrWhiteSpace(userName))
        {
            userName = configuration["ConfigHub:BootstrapAdmin:UserName"];
        }
        if (string.IsNullOrWhiteSpace(userName))
        {
            userName = configuration["ConfigHub:BootstrapAdmin:Email"];
        }

        var password = Environment.GetEnvironmentVariable("ConfigHub__BootstrapAdmin__Password");
        if (string.IsNullOrWhiteSpace(password))
        {
            password = configuration["ConfigHub:BootstrapAdmin:Password"];
        }

        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(password))
        {
            if (writeStatus)
            {
                Console.WriteLine("Bootstrap admin is not configured.");
            }
            return;
        }

        var resetPassword = string.Equals(
            Environment.GetEnvironmentVariable("ConfigHub__BootstrapAdmin__ResetPassword"),
            "true",
            StringComparison.OrdinalIgnoreCase)
            || configuration.GetValue("ConfigHub:BootstrapAdmin:ResetPassword", false);

        var normalizedUserName = userName.Trim();
        var email = normalizedUserName.Contains('@', StringComparison.Ordinal)
            ? normalizedUserName
            : null;

        var user = await userManager.FindByNameAsync(normalizedUserName);
        if (user is null)
        {
            user = new ApplicationUser { Id = Guid.NewGuid(), UserName = normalizedUserName, Email = email, DisplayName = "本机管理员", EmailConfirmed = email is not null };
            var result = await userManager.CreateAsync(user, password);
            if (!result.Succeeded) throw new InvalidOperationException(string.Join("; ", result.Errors.Select(error => error.Description)));
            if (writeStatus)
            {
                Console.WriteLine($"Bootstrap admin created: {normalizedUserName}");
            }
        }
        else if (resetPassword)
        {
            var token = await userManager.GeneratePasswordResetTokenAsync(user);
            var result = await userManager.ResetPasswordAsync(user, token, password);
            if (!result.Succeeded) throw new InvalidOperationException(string.Join("; ", result.Errors.Select(error => error.Description)));
            await userManager.SetLockoutEndDateAsync(user, null);
            await userManager.ResetAccessFailedCountAsync(user);
            if (writeStatus)
            {
                Console.WriteLine($"Bootstrap admin password reset: {normalizedUserName}");
            }
        }
        else if (writeStatus)
        {
            Console.WriteLine($"Bootstrap admin already exists: {normalizedUserName}");
        }

        if (!await userManager.IsInRoleAsync(user, "Admin"))
        {
            var result = await userManager.AddToRoleAsync(user, "Admin");
            if (!result.Succeeded) throw new InvalidOperationException(string.Join("; ", result.Errors.Select(error => error.Description)));
        }

        if (!await userManager.IsInRoleAsync(user, "SuperAdmin"))
        {
            var result = await userManager.AddToRoleAsync(user, "SuperAdmin");
            if (!result.Succeeded) throw new InvalidOperationException(string.Join("; ", result.Errors.Select(error => error.Description)));
        }

        if (!await userManager.CheckPasswordAsync(user, password))
        {
            throw new InvalidOperationException("Bootstrap admin password verification failed.");
        }

        if (writeStatus)
        {
            Console.WriteLine($"Bootstrap admin verified: {normalizedUserName}");
        }
    }
}
