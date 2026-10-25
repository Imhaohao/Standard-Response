import { ArrowRight, Brain, Check, Database, Icon, Path, Phone, PhoneIncoming, Polygon, Van } from "@phosphor-icons/react";
import { Disclosure } from "./disclosure";

const STAGES: { Icon: Icon; name: string; runs: string }[] = [
  { Icon: Polygon, name: "Warning zone", runs: "Drawn on the rescue map" },
  { Icon: Phone, name: "Call", runs: "Twilio dials; Cartesia hears and speaks" },
  { Icon: Brain, name: "Record", runs: "Claude fills it; code picks every promise" },
  { Icon: Database, name: "Request", runs: "Convex, with version checks" },
  { Icon: Path, name: "Plan", runs: "Our ALNS search, heuristic fallback" },
  { Icon: Check, name: "Approval", runs: "Dispatcher, one click" },
  { Icon: Van, name: "Acceptance", runs: "Driver, on their phone" },
  { Icon: PhoneIncoming, name: "Callback", runs: "Only after a driver accepts" },
];

// One rider's path through the system, left to right. A closed road or a changed answer sends it back to Plan.
export function ArchitectureDisclosure() {
  return (
    <Disclosure icon={Path} title="How it works" fact="Twilio, Cartesia, Claude, Convex, ALNS">
      <ol className="flex flex-wrap items-stretch gap-y-3">
        {STAGES.map(({ Icon: StageIcon, name, runs }, index) => (
          <li key={name} className="flex items-center">
            <div className="flex w-36 flex-col gap-1 self-stretch rounded-xl bg-panel-raised p-3">
              <StageIcon weight="bold" className="size-5" aria-hidden />
              <span className="type-small font-bold">{name}</span>
              <span className="type-caption text-on-panel-muted">{runs}</span>
            </div>
            {index < STAGES.length - 1 && <ArrowRight weight="bold" className="mx-1.5 size-4 shrink-0 text-on-panel-muted" aria-hidden />}
          </li>
        ))}
      </ol>
      <p className="type-small text-on-panel-muted">A closed road or a corrected answer sends the rider back to Plan. A van already accepted keeps its run.</p>
    </Disclosure>
  );
}
