using GateSensor.Api.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace GateSensor.Api.Data;

// Reads accounts to provision from the "SeedUsers" config section (env vars
// SeedUsers__0__Username / SeedUsers__0__Password, ...) so real credentials
// never live in source control. Idempotent — skips usernames that already exist.
public static class UserSeeder
{
    public sealed record SeedAccount(string Username, string Password);

    public static async Task SeedAsync(
        AppDbContext dbContext,
        IConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        var accounts = configuration.GetSection("SeedUsers").Get<SeedAccount[]>() ?? [];
        if (accounts.Length == 0)
        {
            return;
        }

        var hasher = new PasswordHasher<User>();

        foreach (var account in accounts)
        {
            if (string.IsNullOrWhiteSpace(account.Username) || string.IsNullOrWhiteSpace(account.Password))
            {
                continue;
            }

            var username = account.Username.Trim().ToLowerInvariant();
            var exists = await dbContext.Users
                .AnyAsync(u => u.Username == username, cancellationToken);
            if (exists)
            {
                continue;
            }

            var user = new User { Id = Guid.NewGuid(), Username = username, PasswordHash = string.Empty };
            user.PasswordHash = hasher.HashPassword(user, account.Password);
            dbContext.Users.Add(user);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
