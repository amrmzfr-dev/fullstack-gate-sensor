import { useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFirmware } from "@/hooks/useFirmware";
import { HttpError } from "@/lib/api";
import { GK_ACCENT, GK_CARD, GK_HAIR, GK_INK, GK_LIME, GK_MONO, GK_SANS } from "@/lib/gatekeepTheme";
import type { DeviceFirmwareStatus, FirmwareDevice } from "@/types";

const DEVICE_LABELS: Record<FirmwareDevice, string> = {
  transmitter: "Transmitter",
  receiver: "Receiver",
};

interface DeviceUploadCardProps {
  status: DeviceFirmwareStatus;
  uploading: boolean;
  onUpload: (device: FirmwareDevice, file: File, version: string) => Promise<void>;
  styled?: boolean;
}

function DeviceUploadCard({ status, uploading, onUpload, styled = false }: DeviceUploadCardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justUploaded, setJustUploaded] = useState(false);

  const handleSubmit = async () => {
    if (!file || !version.trim()) {
      return;
    }

    setError(null);
    try {
      await onUpload(status.device, file, version.trim());
      setFile(null);
      setVersion("");
      setJustUploaded(true);
      window.setTimeout(() => setJustUploaded(false), 4000);
    } catch (err) {
      setError(err instanceof HttpError ? err.message : "Upload failed");
    }
  };

  if (styled) {
    return (
      <div style={{ background: GK_CARD, border: `1px solid ${GK_HAIR}`, borderRadius: 20, padding: 15, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ font: `700 16px ${GK_SANS}`, color: "#fff" }}>{DEVICE_LABELS[status.device]}</span>
          <span
            style={{
              padding: "5px 9px", borderRadius: 99, background: "#1F1F1F", border: "1px solid rgba(255,255,255,.12)",
              font: `500 9px ${GK_MONO}`, color: "rgba(255,255,255,.7)",
            }}
          >
            {status.manifest ? `v${status.manifest.version}` : "No firmware yet"}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Input
            type="file"
            accept=".bin"
            disabled={uploading}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            style={{ background: "#1F1F1F", color: "#fff", border: "1px solid rgba(255,255,255,.14)" }}
          />
          <Input
            type="text"
            placeholder="Version (e.g. 1.4.0)"
            value={version}
            disabled={uploading}
            onChange={(event) => setVersion(event.target.value)}
            style={{ background: "#1F1F1F", color: "#fff", border: "1px solid rgba(255,255,255,.14)" }}
          />
          <Button
            variant="ghost"
            disabled={!file || !version.trim() || uploading}
            style={{ justifyContent: "center", background: "#fff", color: GK_INK }}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
            Upload
          </Button>
        </div>

        {error && <span style={{ font: `400 11px ${GK_SANS}`, color: GK_ACCENT }}>{error}</span>}
        {justUploaded && !error && (
          <span style={{ display: "flex", alignItems: "center", gap: 4, font: `500 10px ${GK_MONO}`, letterSpacing: ".08em", textTransform: "uppercase", color: GK_LIME }}>
            <CheckCircle2 className="size-3.5" />
            Uploaded — pushed over MQTT
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[20px] border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight uppercase">{DEVICE_LABELS[status.device]}</h3>
        <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[9px] text-secondary-foreground">
          {status.manifest ? `v${status.manifest.version}` : "No firmware yet"}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="file"
          accept=".bin"
          disabled={uploading}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="sm:flex-[2]"
        />
        <Input
          type="text"
          placeholder="Version (e.g. 1.4.0)"
          value={version}
          disabled={uploading}
          onChange={(event) => setVersion(event.target.value)}
          className="sm:flex-1"
        />
        <Button
          disabled={!file || !version.trim() || uploading}
          onClick={() => {
            void handleSubmit();
          }}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
          Upload
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {justUploaded && !error && (
        <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" />
          Uploaded — pushed to {DEVICE_LABELS[status.device]} over MQTT
        </p>
      )}
    </div>
  );
}

// Firmware OTA is the one action that can brick a device — restricted to
// the system admin account. Everyone else sees a warning, not the panel.
const ADMIN_USERNAME = "amir";

interface FirmwarePanelProps {
  username: string | null;
  styled?: boolean;
}

export function FirmwarePanel({ username, styled = false }: FirmwarePanelProps) {
  const { statuses, loading, error, uploadingDevice, upload } = useFirmware();
  const isAdmin = username?.toLowerCase() === ADMIN_USERNAME;

  if (styled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 8 }}>
        {isAdmin ? (
          <>
            {loading && statuses.length === 0 ? (
              <span style={{ font: `400 12px ${GK_SANS}`, color: "rgba(255,255,255,.4)" }}>Loading firmware status...</span>
            ) : (
              statuses.map((status) => (
                <DeviceUploadCard
                  key={status.device}
                  status={status}
                  uploading={uploadingDevice === status.device}
                  onUpload={upload}
                  styled
                />
              ))
            )}
            {error && <span style={{ font: `400 12px ${GK_SANS}`, color: GK_ACCENT }}>{error}</span>}
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: GK_CARD, border: `1px solid ${GK_HAIR}`, borderRadius: 20, padding: 16 }}>
            <ShieldAlert size={16} color="#F4C33F" style={{ marginTop: 2, flexShrink: 0 }} />
            <p style={{ margin: 0, font: `400 12px/1.4 ${GK_SANS}`, color: "rgba(255,255,255,.5)" }}>
              Firmware updates are locked to the system admin account.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isAdmin ? (
        <>
          {loading && statuses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading firmware status...</p>
          ) : (
            statuses.map((status) => (
              <DeviceUploadCard
                key={status.device}
                status={status}
                uploading={uploadingDevice === status.device}
                onUpload={upload}
              />
            ))
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      ) : (
        <div className="flex items-start gap-2.5 rounded-[20px] border border-border bg-card p-4 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p>Firmware updates are locked to the system admin account.</p>
        </div>
      )}
    </div>
  );
}
