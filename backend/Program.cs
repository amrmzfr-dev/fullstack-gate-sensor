using GateSensor.Api.Data;
using GateSensor.Api.Mqtt;
using GateSensor.Api.Services;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException(
        "Connection string 'DefaultConnection' is not configured. Set it via environment variable or user secrets.");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString));

var redisConnectionString = builder.Configuration["Redis:ConnectionString"]
    ?? "localhost:6379";

builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(redisConnectionString));

builder.Services.AddSingleton<IGateAlertState, RedisGateAlertState>();
builder.Services.AddSingleton<IFirmwarePublisher, MqttFirmwarePublisher>();
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
app.UseAuthorization();
app.MapControllers();

app.Run();
