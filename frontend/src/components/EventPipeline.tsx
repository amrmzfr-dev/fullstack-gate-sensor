import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

import { formatTimestamp } from "@/lib/format";
import type { GateEventRecord } from "@/types";

interface PipelineStepProps {
  label: string;
  done: boolean;
  timestamp: string | null;
  showTimestamps: boolean;
}

function PipelineStep({ label, done, timestamp, showTimestamps }: PipelineStepProps) {
  return (
    <div className="flex items-center gap-1.5">
      {done ? (
        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Loader2 className="size-3.5 animate-spin text-amber-500" />
      )}
      <span className={done ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
      {showTimestamps && timestamp && (
        <span className="text-muted-foreground">
          ({formatTimestamp(timestamp)})
        </span>
      )}
    </div>
  );
}

interface EventPipelineProps {
  event: GateEventRecord;
  // Hide per-step timestamps on narrow screens where they wrap badly.
  showTimestamps?: boolean;
}

export function EventPipeline({ event, showTimestamps = true }: EventPipelineProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <PipelineStep
        label="Sensor triggered"
        done
        timestamp={event.timestamp}
        showTimestamps={showTimestamps}
      />
      <ArrowRight className="size-3 text-muted-foreground" />
      <PipelineStep
        label="Relayed to buzzer"
        done={event.relayedAt !== null}
        timestamp={event.relayedAt}
        showTimestamps={showTimestamps}
      />
      <ArrowRight className="size-3 text-muted-foreground" />
      <PipelineStep
        label="Receiver confirmed"
        done={event.receiverConfirmedAt !== null}
        timestamp={event.receiverConfirmedAt}
        showTimestamps={showTimestamps}
      />
    </div>
  );
}
