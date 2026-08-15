import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Play, Radio, Save, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  GK_ACCENT,
  GK_CARD,
  GK_HAIR,
  GK_INK,
  GK_LIME,
  GK_MONO,
  GK_SANS,
  GK_YELLOW,
} from "@/lib/gatekeepTheme";
import type { ReceiverConfig, TransmitterConfig } from "@/types";

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
  styled?: boolean;
}

const STYLED_THUMB =
  "[&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-[#0C0C0C] [&::-webkit-slider-thumb]:bg-[#F4C33F] [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-[#0C0C0C] [&::-moz-range-thumb]:bg-[#F4C33F] [&::-moz-range-thumb]:shadow-md";

function SliderField({ label, value, min, max, step, onChange, format, styled = false }: SliderFieldProps) {
  const pct = ((value - min) / (max - min)) * 100;
  if (styled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ font: `500 10px ${GK_MONO}`, letterSpacing: ".14em", textTransform: "uppercase", color: "rgba(255,255,255,.4)" }}>
            {label}
          </span>
          <span style={{ font: `600 12px ${GK_MONO}`, color: GK_YELLOW }}>{format(value)}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ backgroundImage: `linear-gradient(to right, ${GK_YELLOW} ${pct}%, #2A2A2A ${pct}%)` }}
          className={`h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none ${STYLED_THUMB}`}
        />
      </div>
    );
  }
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
  styled?: boolean;
}

function SaveMessage({ message, styled = false }: SaveMessageProps) {
  if (!message) {
    return null;
  }
  if (message.type === "err") {
    return (
      <p style={styled ? { font: `400 11px ${GK_SANS}`, color: GK_ACCENT, margin: 0 } : undefined} className={styled ? undefined : "text-xs text-destructive"}>
        {message.text}
      </p>
    );
  }
  return (
    <p
      style={styled ? { display: "flex", alignItems: "center", gap: 4, font: `400 11px ${GK_SANS}`, color: GK_LIME, margin: 0 } : undefined}
      className={styled ? undefined : "flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"}
    >
      <CheckCircle2 className="size-3.5" />
      {message.text}
    </p>
  );
}

export function ReceiverSettings({
  initial,
  saving,
  onSave,
  onTest,
  styled = false,
}: {
  initial: ReceiverConfig;
  saving: boolean;
  onSave: (config: ReceiverConfig) => Promise<string | null>;
  onTest: () => Promise<void>;
  styled?: boolean;
}) {
  const [form, setForm] = useState<ReceiverConfig>(initial);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const set = (patch: Partial<ReceiverConfig>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setMessage(null);
  };

  const activePreset = matchingPreset(form);
  const activeLabel = BEEP_PRESETS.find((preset) => preset.id === activePreset)?.label ?? "Custom";

  const handleSave = async () => {
    const error = await onSave(form);
    setMessage(
      error
        ? { type: "err", text: error }
        : { type: "ok", text: "Saved — playing it on the receiver" },
    );
    window.setTimeout(() => setMessage(null), 4000);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await onTest();
    } finally {
      setTesting(false);
    }
  };

  const sliders = (
    <div className="grid gap-4 sm:grid-cols-2">
      <SliderField styled={styled} label="Beep length" value={form.beepOnMs} min={50} max={5000} step={50} onChange={(v) => set({ beepOnMs: v })} format={seconds} />
      <SliderField styled={styled} label="Gap between beeps" value={form.beepGapMs} min={0} max={5000} step={50} onChange={(v) => set({ beepGapMs: v })} format={seconds} />
      <SliderField styled={styled} label="Pause after a cycle" value={form.pauseMs} min={0} max={10000} step={100} onChange={(v) => set({ pauseMs: v })} format={seconds} />
      <SliderField styled={styled} label="Beeps per cycle" value={form.beepsPerCycle} min={1} max={20} step={1} onChange={(v) => set({ beepsPerCycle: v })} format={(v) => `${v}`} />
      <SliderField styled={styled} label="Alert window (min. sound time)" value={form.alertWindowMs} min={1000} max={30000} step={500} onChange={(v) => set({ alertWindowMs: v })} format={seconds} />
      <SliderField styled={styled} label="Acknowledge cooldown" value={form.acknowledgeCooldownMs} min={0} max={300000} step={5000} onChange={(v) => set({ acknowledgeCooldownMs: v })} format={seconds} />
    </div>
  );

  if (styled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: GK_YELLOW, borderRadius: 24, padding: 17, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ font: `500 10px ${GK_MONO}`, letterSpacing: ".14em", textTransform: "uppercase", color: "rgba(12,12,12,.7)" }}>
              Buzzer · beep style
            </span>
            <Volume2 size={16} color="rgba(12,12,12,.7)" />
          </div>
          <div style={{ font: `900 40px/.85 ${GK_SANS}`, letterSpacing: "-.05em", color: GK_INK, textTransform: "uppercase" }}>
            {activeLabel}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {BEEP_PRESETS.map((preset) => {
              const on = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => set(preset.values)}
                  style={{
                    padding: "7px 12px", borderRadius: 99, border: "none", cursor: "pointer",
                    background: on ? GK_INK : "rgba(12,12,12,.12)",
                    color: on ? GK_YELLOW : "rgba(12,12,12,.7)",
                    font: `500 10px ${GK_MONO}`, letterSpacing: ".1em", textTransform: "uppercase",
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ background: GK_CARD, border: `1px solid ${GK_HAIR}`, borderRadius: 20, padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          {sliders}
          <p style={{ margin: 0, borderRadius: 12, background: "rgba(255,255,255,.05)", padding: "8px 12px", font: `400 11px ${GK_SANS}`, color: "rgba(255,255,255,.5)" }}>
            {describePattern(form)}
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <SaveMessage message={message} styled />
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <Button
                variant="ghost"
                disabled={testing}
                style={{ background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.14)" }}
                onClick={() => {
                  void handleTest();
                }}
              >
                {testing ? <Loader2 className="animate-spin" /> : <Play />}
                Test
              </Button>
              <Button
                variant="ghost"
                disabled={saving}
                style={{ background: GK_YELLOW, color: GK_INK }}
                onClick={() => {
                  void handleSave();
                }}
              >
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-[20px] border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Volume2 className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-bold tracking-tight uppercase">Receiver — buzzer</h3>
      </div>

      <div className="space-y-1.5">
        <span className="font-mono text-[10px] font-medium tracking-[.1em] text-muted-foreground uppercase">Beep style</span>
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

      {sliders}

      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {describePattern(form)}
      </p>

      <div className="flex items-center justify-between gap-3">
        <SaveMessage message={message} />
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            disabled={testing}
            onClick={() => {
              void handleTest();
            }}
          >
            {testing ? <Loader2 className="animate-spin" /> : <Play />}
            Test
          </Button>
          <Button
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
    </div>
  );
}

export function TransmitterSettings({
  initial,
  saving,
  onSave,
  styled = false,
}: {
  initial: TransmitterConfig;
  saving: boolean;
  onSave: (config: TransmitterConfig) => Promise<string | null>;
  styled?: boolean;
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

  const sliders = (
    <div className="grid gap-4">
      <SliderField styled={styled} label="Re-ping interval (while blocked)" value={form.pingIntervalMs} min={500} max={6500} step={250} onChange={(v) => set({ pingIntervalMs: v })} format={seconds} />
      <SliderField styled={styled} label="Debounce (ignore flicker)" value={form.debounceMs} min={0} max={1000} step={10} onChange={(v) => set({ debounceMs: v })} format={(v) => `${v} ms`} />
    </div>
  );

  if (styled) {
    return (
      <div style={{ background: GK_CARD, border: `1px solid ${GK_HAIR}`, borderRadius: 20, padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ font: `500 10px ${GK_MONO}`, letterSpacing: ".14em", textTransform: "uppercase", color: "rgba(255,255,255,.4)" }}>
            Transmitter · sensor
          </span>
          <Radio size={16} color="rgba(255,255,255,.4)" />
        </div>
        {sliders}
        <p style={{ margin: 0, borderRadius: 12, background: "rgba(255,255,255,.05)", padding: "8px 12px", font: `400 11px ${GK_SANS}`, color: "rgba(255,255,255,.5)" }}>
          Re-checks a blocked beam every {seconds(form.pingIntervalMs)}; must stay under the receiver's alert window.
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <SaveMessage message={message} styled />
          <Button
            variant="ghost"
            disabled={saving}
            style={{ marginLeft: "auto", background: GK_YELLOW, color: GK_INK }}
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

  return (
    <div className="space-y-4 rounded-[20px] border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Radio className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-bold tracking-tight uppercase">Transmitter — sensor</h3>
      </div>
      {sliders}
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
