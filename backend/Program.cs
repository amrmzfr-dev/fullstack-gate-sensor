using System.Text;
using GateSensor.Api.Data;
using GateSensor.Api.Mqtt;
using GateSensor.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException(
        "Connection string 'DefaultConnection' is not configured. Set it via environment variable or user secrets.");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString));

var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException(
        "Jwt:Key is not configured. Set it via environment variable or user secrets.");
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "gate-sensor";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "gate-sensor";

builder.Services.AddSingleton<IJwtTokenService, JwtTokenService>();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Without this, the handler remaps short claim types (e.g. "unique_name")
        // to legacy long-form URIs on validation, so User.FindFirst(UniqueName)
        // in the controllers silently returns null and never matches.
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});

var redisConnectionString = builder.Configuration["Redis:ConnectionString"]
    ?? "localhost:6379";

builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(redisConnectionString));

builder.Services.AddSingleton<IGateAlertState, RedisGateAlertState>();
builder.Services.AddSingleton<IDeviceStatusStore, RedisDeviceStatusStore>();
builder.Services.AddSingleton<IDeviceConfigStore, RedisDeviceConfigStore>();
builder.Services.AddSingleton<IGatePositionStore, RedisGatePositionStore>();
builder.Services.AddSingleton<IFirmwarePublisher, MqttFirmwarePublisher>();
builder.Services.AddSingleton<IMqttPublisher, MqttPublisher>();
builder.Services.AddHostedService<MqttRelayHostedService>();

var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? ["http://localhost:5173"];

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy.WithOrigins(allowedOrigins)
            .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
            .WithHeaders("Content-Type", "Authorization", "Accept");
    });
});

builder.Services.AddControllers();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await dbContext.Database.MigrateAsync();
    await UserSeeder.SeedAsync(dbContext, app.Configuration);
}

if (app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

var firmwareContentTypeProvider = new FileExtensionContentTypeProvider();
firmwareContentTypeProvider.Mappings[".bin"] = "application/octet-stream";

// Serves /firmware/{device}/firmware.bin and /firmware/{device}/manifest.json
// for OTA — devices pull the binary over HTTP after getting notified via the
// retained firmware/{device}/latest MQTT topic (see MqttRelayHostedService).
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = firmwareContentTypeProvider,
});

app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
