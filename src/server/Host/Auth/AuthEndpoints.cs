using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.AspNetCore.Identity;

namespace ConfigHub.Host.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var auth = endpoints.MapGroup("/api/v1/auth");
        auth.MapPost("/login", LoginAsync);
        auth.MapPost("/logout", LogoutAsync).RequireAuthorization();
        auth.MapGet("/me", Me).RequireAuthorization();
        return endpoints;
    }

    private static async Task<IResult> LoginAsync(LoginRequest request, SignInManager<ApplicationUser> signInManager)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["credentials"] = ["请输入邮箱和密码。"] });
        }

        var result = await signInManager.PasswordSignInAsync(request.Email.Trim(), request.Password, false, lockoutOnFailure: true);
        return result.Succeeded ? TypedResults.NoContent() : Results.Unauthorized();
    }

    private static async Task<IResult> LogoutAsync(SignInManager<ApplicationUser> signInManager)
    {
        await signInManager.SignOutAsync();
        return TypedResults.NoContent();
    }

    private static Microsoft.AspNetCore.Http.HttpResults.Ok<CurrentUserResponse> Me(HttpContext context) => TypedResults.Ok(new CurrentUserResponse(
        context.User.Identity?.Name,
        context.User.Claims.Where(claim => claim.Type.EndsWith("role", StringComparison.OrdinalIgnoreCase)).Select(claim => claim.Value).ToArray()));
}

public sealed record LoginRequest(string? Email, string? Password);
public sealed record CurrentUserResponse(string? Name, string[] Roles);
