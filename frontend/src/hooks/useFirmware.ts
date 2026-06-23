import { useCallback, useEffect, useState } from "react";

import { HttpError } from "@/lib/api";
import { fetchFirmwareStatuses, uploadFirmware } from "@/lib/firmware";
import type { DeviceFirmwareStatus, FirmwareDevice } from "@/types";

interface UseFirmwareResult {
  statuses: DeviceFirmwareStatus[];
  loading: boolean;
  error: string | null;
  uploadingDevice: FirmwareDevice | null;
  refresh: () => Promise<void>;
  upload: (device: FirmwareDevice, file: File, version: string) => Promise<void>;
}

export function useFirmware(): UseFirmwareResult {
  const [statuses, setStatuses] = useState<DeviceFirmwareStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingDevice, setUploadingDevice] = useState<FirmwareDevice | null>(null);

  const refresh = useCallback(async () => {
    try {
      const nextStatuses = await fetchFirmwareStatuses();
      setStatuses(nextStatuses);
      setError(null);
    } catch (err) {
      const message =
        err instanceof HttpError
          ? `Backend error (${err.status})`
          : "Unable to reach backend";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (device: FirmwareDevice, file: File, version: string) => {
      setUploadingDevice(device);
      try {
        await uploadFirmware(device, file, version);
        await refresh();
      } finally {
        setUploadingDevice(null);
      }
    },
    [refresh],
  );

  return { statuses, loading, error, uploadingDevice, refresh, upload };
}
