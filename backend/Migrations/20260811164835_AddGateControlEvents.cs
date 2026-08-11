using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GateSensor.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGateControlEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GateControlEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Username = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FirstPressedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastPressedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PressCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GateControlEvents", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GateControlEvents_Username_LastPressedAt",
                table: "GateControlEvents",
                columns: new[] { "Username", "LastPressedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GateControlEvents");
        }
    }
}
