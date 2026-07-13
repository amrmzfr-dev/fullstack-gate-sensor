import { Clock, Wifi, WifiOff } from "lucide-react";

import { formatDeviceName, formatTimestamp } from "@/lib/format";
import type { DeviceLiveStatus } from "@/types";

export function DeviceStatusCard({ device }: { device: DeviceLiveStatus }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {device.online ? (
            <Wifi className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <WifiOff className="size-4 text-muted-foreground" />
          )}
          <h3 className="text-sm font-medium">{formatDeviceName(device.device)}</h3>
          <span
            className={
              device.online
                ? "text-xs font-medium text-emerald-600 dark:text-emerald-400"
                : "text-xs font-medium text-muted-foreground"
            }
          >
            {device.online ? "Online" : "Offline"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {device.firmwareVersion ? `v${device.firmwareVersion}` : "Version unknown"}
          {device.ipAddress ? ` · ${device.ipAddress}` : ""}
        </p>
        {device.lastSeenAt && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            Last seen: {formatTimestamp(device.lastSeenAt)}
          </p>
        )}
      </div>
    </div>
  );
}
