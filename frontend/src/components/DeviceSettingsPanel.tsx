import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Radio, Save, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DeviceConfig, ReceiverConfig, TransmitterConfig } from "@/types";

type SaveTarget = "receiver" | "transmitter" | null;

interface DeviceSettingsPanelProps {
  config: DeviceConfig;
  saving: SaveTarget;
  onSaveReceiver: (config: ReceiverConfig) => Promise<string | null>;
  onSaveTransmitter: (config: TransmitterConfig) => Promise<string | null>;
}

type BeepPresetValues = Pick<
  ReceiverConfig,
  "beepOnMs" | "beepGapMs" | "pauseMs" | "beepsPerCycle"
>;

const BEEP_PRESETS: ReadonlyArray<{ id: string; label: string; values: BeepPresetValues }> = [
  { id: "standard", label: "Standard", values: { beepOnMs: 1000, beepGapMs: 1000, pauseMs: 2000, beepsPerCycle: 5 } },
  { id: "urgent", label: "Urgent", values: { beepOnMs: 200, beepGapMs: 150, pauseMs: 500, beepsPerCycle: 8 } },
  { id: "slow", label: "Slow", values: { beepOnMs: 1500, beepGapMs: 1500, pauseMs: 3000, beepsPerCycle: 3 } },
  { id: "double", label: "Double", values: { beepOnMs: 150, beepGapMs: 150, pauseMs: 1200, beepsPerCycle: 2 } },
  { id: "continuous", label: "Continuous", values: { beepOnMs: 5000, beepGapMs: 0, pauseMs: 0, beepsPerCycle: 1 } },
];

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
}

function matchingPreset(config: ReceiverConfig): string | null {
  const found = BEEP_PRESETS.find(
    (preset) =>
      preset.values.beepOnMs === config.beepOnMs &&
      preset.values.beepGapMs === config.beepGapMs &&
      preset.values.pauseMs === config.pauseMs &&
      preset.values.beepsPerCycle === config.beepsPerCycle,
  );
  return found?.id ?? null;
}

function describePattern(config: ReceiverConfig): string {
  if (config.beepsPerCycle <= 1) {
    return `One ${seconds(config.beepOnMs)} tone, repeating every ${seconds(config.pauseMs)} while the gate stays blocked.`;
  }
  return `${config.beepsPerCycle} beeps of ${seconds(config.beepOnMs)}, ${seconds(config.beepGapMs)} apart, then a ${seconds(config.pauseMs)} pause — repeating while blocked.`;
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}

function SliderField({ label, value, min, max, step, onChange, format }: SliderFieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />
    </div>
  );
}

interface SaveMessageProps {
  message: { type: "ok" | "err"; text: string } | null;
}

function SaveMessage({ message }: SaveMessageProps) {
  if (!message) {
    return null;
  }
  if (message.type === "err") {
    return <p className="text-xs text-destructive">{message.text}</p>;
  }
  return (
    <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="size-3.5" />
      {message.text}
    </p>
  );
}

function ReceiverSettings({
  initial,
  saving,
  onSave,
}: {
  initial: ReceiverConfig;
  saving: boolean;
  onSave: (config: ReceiverConfig) => Promise<string | null>;
}) {
  const [form, setForm] = useState<ReceiverConfig>(initial);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const set = (patch: Partial<ReceiverConfig>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setMessage(null);
  };

  const activePreset = matchingPreset(form);

  const handleSave = async () => {
    const error = await onSave(form);
    setMessage(error ? { type: "err", text: error } : { type: "ok", text: "Saved — pushed to receiver" });
    window.setTimeout(() => setMessage(null), 4000);
  };

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Volume2 className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Receiver — buzzer</h3>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-foreground">Beep style</span>
        <div className="flex flex-wrap gap-1.5">
          {BEEP_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              size="sm"
              variant={activePreset === preset.id ? "default" : "outline"}
              onClick={() => set(preset.values)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SliderField
          label="Beep length"
          value={form.beepOnMs}
          min={50}
          max={5000}
          step={50}
          onChange={(v) => set({ beepOnMs: v })}
          format={seconds}
        />
        <SliderField
          label="Gap between beeps"
          value={form.beepGapMs}
          min={0}
          max={5000}
          step={50}
          onChange={(v) => set({ beepGapMs: v })}
          format={seconds}
        />
        <SliderField
          label="Pause after a cycle"
          value={form.pauseMs}
          min={0}
          max={10000}
          step={100}
          onChange={(v) => set({ pauseMs: v })}
          format={seconds}
        />
        <SliderField
          label="Beeps per cycle"
          value={form.beepsPerCycle}
          min={1}
          max={20}
          step={1}
          onChange={(v) => set({ beepsPerCycle: v })}
          format={(v) => `${v}`}
        />
        <SliderField
          label="Alert window (min. sound time)"
          value={form.alertWindowMs}
          min={1000}
          max={30000}
          step={500}
          onChange={(v) => set({ alertWindowMs: v })}
          format={seconds}
        />
        <SliderField
          label="Acknowledge cooldown"
          value={form.acknowledgeCooldownMs}
          min={0}
          max={300000}
          step={5000}
          onChange={(v) => set({ acknowledgeCooldownMs: v })}
          format={seconds}
        />
      </div>

      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {describePattern(form)}
      </p>

      <div className="flex items-center justify-between gap-3">
        <SaveMessage message={message} />
        <Button
          className="ml-auto"
          disabled={saving}
          onClick={() => {
            void handleSave();
          }}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save receiver
        </Button>
      </div>
    </div>
  );
}

function TransmitterSettings({
  initial,
  saving,
  onSave,
}: {
  initial: TransmitterConfig;
  saving: boolean;
  onSave: (config: TransmitterConfig) => Promise<string | null>;
}) {
  const [form, setForm] = useState<TransmitterConfig>(initial);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const set = (patch: Partial<TransmitterConfig>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setMessage(null);
  };

  const handleSave = async () => {
    const error = await onSave(form);
    setMessage(error ? { type: "err", text: error } : { type: "ok", text: "Saved — pushed to transmitter" });
    window.setTimeout(() => setMessage(null), 4000);
  };

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Radio className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Transmitter — sensor</h3>
      </div>

      <div className="grid gap-4">
        <SliderField
          label="Re-ping interval (while blocked)"
          value={form.pingIntervalMs}
          min={500}
          max={6500}
          step={250}
          onChange={(v) => set({ pingIntervalMs: v })}
          format={seconds}
        />
        <SliderField
          label="Debounce (ignore flicker)"
          value={form.debounceMs}
          min={0}
          max={1000}
          step={10}
          onChange={(v) => set({ debounceMs: v })}
          format={(v) => `${v} ms`}
        />
      </div>

      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Re-checks a blocked beam every {seconds(form.pingIntervalMs)}; must stay under the receiver's alert window.
      </p>

      <div className="flex items-center justify-between gap-3">
        <SaveMessage message={message} />
        <Button
          className="ml-auto"
          disabled={saving}
          onClick={() => {
            void handleSave();
          }}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save transmitter
        </Button>
      </div>
    </div>
  );
}

export function DeviceSettingsPanel({
  config,
  saving,
  onSaveReceiver,
  onSaveTransmitter,
}: DeviceSettingsPanelProps) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-sm font-medium">Behaviour settings</h2>
        <p className="text-xs text-muted-foreground">
          Change how the devices behave — applied live over MQTT, no reflash needed
        </p>
      </div>
      <div className="grid gap-4 px-6 py-4 lg:grid-cols-2">
        <ReceiverSettings
          initial={config.receiver}
          saving={saving === "receiver"}
          onSave={onSaveReceiver}
        />
        <TransmitterSettings
          initial={config.transmitter}
          saving={saving === "transmitter"}
          onSave={onSaveTransmitter}
        />
      </div>
    </section>
  );
}
