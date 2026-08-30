using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var auth = endpoints.MapGroup("/api/v1/auth");
        auth.MapPost("/login", LoginAsync);
        auth.MapPost("/logout", LogoutAsync).RequireAuthorization();
        auth.MapGet("/me", Me).RequireAuthorization();
        var admin = endpoints.MapGroup("/api/v1/admin").RequireAuthorization(policy => policy.RequireRole("Admin"));
        admin.MapGet("/users", ListUsersAsync);
        admin.MapPost("/users", CreateUserAsync);
        admin.MapPost("/users/{userId:guid}/role", ChangeUserRoleAsync);
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

    private static async Task<IResult> ListUsersAsync(UserManager<ApplicationUser> userManager, CancellationToken cancellationToken)
    {
        var users = await userManager.Users.OrderBy(user => user.Email).ToListAsync(cancellationToken);
        var result = new List<object>(users.Count);
        foreach (var user in users)
        {
            var roles = await userManager.GetRolesAsync(user);
            result.Add(new { id = user.Id, email = user.Email, displayName = user.DisplayName, roles });
        }
        return TypedResults.Ok(result);
    }

    private static async Task<IResult> CreateUserAsync(CreateUserRequest request, HttpContext context, UserManager<ApplicationUser> userManager, RoleManager<IdentityRole<Guid>> roleManager, ConfigHubDbContext database, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.DisplayName) || string.IsNullOrWhiteSpace(request.Password) || string.IsNullOrWhiteSpace(request.Role) || string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须提供邮箱、显示名、密码、角色和创建原因。"] });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["创建用户必须提供不超过 200 个字符的 Idempotency-Key。"] });
        var role = request.Role.Trim();
        if (!await roleManager.RoleExistsAsync(role)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["role"] = ["角色不存在。"] });
        var scope = "admin.users.create";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        if (await userManager.FindByEmailAsync(request.Email.Trim()) is not null) return Results.Conflict(new { message = "邮箱已存在。" });
        var now = DateTimeOffset.UtcNow;
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var record = new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) };
        database.IdempotencyRecords.Add(record);
        var user = new ApplicationUser { Id = Guid.NewGuid(), UserName = request.Email.Trim(), Email = request.Email.Trim(), DisplayName = request.DisplayName.Trim(), EmailConfirmed = true };
        var create = await userManager.CreateAsync(user, request.Password);
        if (!create.Succeeded) return Results.ValidationProblem(new Dictionary<string, string[]> { ["password"] = [.. create.Errors.Select(error => error.Description)] });
        var assign = await userManager.AddToRoleAsync(user, role);
        if (!assign.Succeeded) return Results.Problem(statusCode: StatusCodes.Status500InternalServerError, detail: string.Join(" ", assign.Errors.Select(error => error.Description)));
        database.AuditEvents.Add(new AuditEvent { Id = Guid.NewGuid(), Actor = context.User.Identity?.Name ?? "系统", Action = "UserCreated", EntityType = "ApplicationUser", EntityId = user.Id, CorrelationId = (context.Items["CorrelationId"]?.ToString() ?? context.TraceIdentifier)[..Math.Min((context.Items["CorrelationId"]?.ToString() ?? context.TraceIdentifier).Length, 128)], Data = JsonDocument.Parse(JsonSerializer.Serialize(new { user.Email, user.DisplayName, role, reason = request.Reason.Trim() })), OccurredAt = now });
        await database.SaveChangesAsync(cancellationToken);
        record.Status = IdempotencyRecordStatus.Completed;
        record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = user.Id, email = user.Email, role }));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return TypedResults.Created($"/api/v1/admin/users/{user.Id}", new { id = user.Id, email = user.Email, role });
    }

    private static async Task<IResult> ChangeUserRoleAsync(Guid userId, ChangeUserRoleRequest request, HttpContext context, UserManager<ApplicationUser> userManager, RoleManager<IdentityRole<Guid>> roleManager, ConfigHubDbContext database, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Role) || string.IsNullOrWhiteSpace(request.Reason)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["必须提供角色和变更原因。"] });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault(); if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["变更角色必须提供不超过 200 个字符的 Idempotency-Key。"] });
        var role = request.Role.Trim(); if (!await roleManager.RoleExistsAsync(role)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["role"] = ["角色不存在。"] });
        var scope = $"admin.users.role:{userId}"; var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request)))); var replay = await database.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) { if (replay.RequestHash != hash) return Results.Conflict(new { message = "同一 Idempotency-Key 不能用于不同请求。" }); if (replay.Result is not null) return TypedResults.Ok(replay.Result.RootElement.Clone()); return Results.Conflict(new { message = "该请求仍在处理。" }); }
        var user = await userManager.FindByIdAsync(userId.ToString()); if (user is null) return Results.NotFound();
        var currentRoles = await userManager.GetRolesAsync(user);
        if (currentRoles.Contains("Admin") && role != "Admin" && await userManager.GetUsersInRoleAsync("Admin") is { Count: 1 }) return Results.Conflict(new { message = "不能移除最后一个管理员。" });
        var now = DateTimeOffset.UtcNow; await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken); var record = new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7) }; database.IdempotencyRecords.Add(record);
        var remove = await userManager.RemoveFromRolesAsync(user, currentRoles); if (!remove.Succeeded) return Results.Problem(statusCode: 500, detail: string.Join(" ", remove.Errors.Select(error => error.Description)));
        var add = await userManager.AddToRoleAsync(user, role); if (!add.Succeeded) return Results.Problem(statusCode: 500, detail: string.Join(" ", add.Errors.Select(error => error.Description)));
        database.AuditEvents.Add(new AuditEvent { Id = Guid.NewGuid(), Actor = context.User.Identity?.Name ?? "系统", Action = "UserRoleChanged", EntityType = "ApplicationUser", EntityId = user.Id, CorrelationId = (context.Items["CorrelationId"]?.ToString() ?? context.TraceIdentifier)[..Math.Min((context.Items["CorrelationId"]?.ToString() ?? context.TraceIdentifier).Length, 128)], Data = JsonDocument.Parse(JsonSerializer.Serialize(new { from = currentRoles, to = role, reason = request.Reason.Trim() })), OccurredAt = now }); await database.SaveChangesAsync(cancellationToken); record.Status = IdempotencyRecordStatus.Completed; record.Result = JsonDocument.Parse(JsonSerializer.Serialize(new { id = user.Id, role })); await database.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken); return TypedResults.Ok(new { id = user.Id, role });
    }
}

public sealed record LoginRequest(string? Email, string? Password);
public sealed record CurrentUserResponse(string? Name, string[] Roles);
public sealed record CreateUserRequest(string? Email, string? DisplayName, string? Password, string? Role, string? Reason);
public sealed record ChangeUserRoleRequest(string? Role, string? Reason);
