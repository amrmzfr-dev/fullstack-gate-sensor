using GateSensor.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace GateSensor.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Gate> Gates => Set<Gate>();
    public DbSet<Sensor> Sensors => Set<Sensor>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<GateEvent> GateEvents => Set<GateEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Gate>(entity =>
        {
            entity.HasKey(g => g.Id);
            entity.Property(g => g.Name).IsRequired().HasMaxLength(128);
            entity.Property(g => g.Status).IsRequired().HasMaxLength(32).HasDefaultValue("unknown");
        });

        modelBuilder.Entity<Sensor>(entity =>
        {
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Type).IsRequired().HasMaxLength(64);
            entity.HasOne(s => s.Gate)
                .WithMany()
                .HasForeignKey(s => s.GateId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Device>(entity =>
        {
            entity.HasKey(d => d.Id);
            entity.Property(d => d.Name).IsRequired().HasMaxLength(128);
            entity.Property(d => d.FirmwareVersion).IsRequired().HasMaxLength(32).HasDefaultValue("0.0.0");
            entity.Property(d => d.Online).HasDefaultValue(false);
        });

        modelBuilder.Entity<GateEvent>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Event).IsRequired().HasMaxLength(8);
            entity.HasIndex(e => e.Timestamp);
        });
    }
}
