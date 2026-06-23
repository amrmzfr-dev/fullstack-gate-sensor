import { useState } from "react";
import { CheckCircle2, Loader2, Upload } from "lucide-react";

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
}

function DeviceUploadCard({ status, uploading, onUpload }: DeviceUploadCardProps) {
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

export function FirmwarePanel() {
  const { statuses, loading, error, uploadingDevice, upload } = useFirmware();

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-sm font-medium">Firmware</h2>
        <p className="text-xs text-muted-foreground">
          Upload a .bin to OTA-update a device automatically over MQTT
        </p>
      </div>
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
    </section>
  );
}
