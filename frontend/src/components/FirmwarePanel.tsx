import { useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFirmware } from "@/hooks/useFirmware";
import { HttpError } from "@/lib/api";
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
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="font-display text-base font-extrabold uppercase leading-none tracking-tight">
            {DEVICE_LABELS[status.device]}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 font-label text-[9px] uppercase tracking-widest text-muted-foreground">
            {status.manifest ? `v${status.manifest.version}` : "No firmware yet"}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <Input
            type="file"
            accept=".bin"
            disabled={uploading}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Input
            type="text"
            placeholder="Version (e.g. 1.4.0)"
            value={version}
            disabled={uploading}
            onChange={(event) => setVersion(event.target.value)}
          />
          <Button
            disabled={!file || !version.trim() || uploading}
            className="justify-center bg-foreground text-background hover:bg-foreground/90"
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
          <p className="flex items-center gap-1 font-label text-[10px] uppercase tracking-widest text-primary">
            <CheckCircle2 className="size-3.5" />
            Uploaded — pushed over MQTT
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{DEVICE_LABELS[status.device]}</h3>
        <span className="text-xs text-muted-foreground">
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
                  styled
                />
              ))
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        ) : (
          <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <p>Firmware updates are locked to the system admin account.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-sm font-medium">Firmware</h2>
        <p className="text-xs text-muted-foreground">
          Upload a .bin to OTA-update a device automatically over MQTT
        </p>
      </div>
      {isAdmin ? (
        <div className="space-y-3 px-6 py-4">
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
        </div>
      ) : (
        <div className="flex items-start gap-2.5 px-6 py-6 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p>Firmware updates are locked to the system admin account.</p>
        </div>
      )}
    </section>
  );
}
