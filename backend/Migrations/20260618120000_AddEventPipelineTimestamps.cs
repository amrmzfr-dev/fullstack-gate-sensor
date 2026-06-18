using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GateSensor.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddEventPipelineTimestamps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "RelayedAt",
                table: "GateEvents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReceiverConfirmedAt",
                table: "GateEvents",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RelayedAt",
                table: "GateEvents");

            migrationBuilder.DropColumn(
                name: "ReceiverConfirmedAt",
                table: "GateEvents");
        }
    }
}
