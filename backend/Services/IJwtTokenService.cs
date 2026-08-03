namespace GateSensor.Api.Services;

public interface IJwtTokenService
{
    string GenerateToken(Guid userId, string username);
}
