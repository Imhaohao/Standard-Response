"use client";

import { WifiHigh, WifiSlash } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { GeoLine } from "@/components/map/layers";
import { MapStage } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { createProjection, Point } from "@/lib/ink-map/data";
import { UPLOAD_MIN_MASS } from "@/lib/mesh/federated";
import { ROAD_CAUSES, RoadCause, RoadReport } from "@/lib/mesh/reports";
import { nearestSegment, SEGMENTS } from "@/lib/mesh/roads";
import { useNow } from "@/lib/time";
import { PRODUCT_NAME } from "@/lib/brand";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { PairingCard } from "./pairing";
import { HowItWorks, TechTags } from "./technology";
import { MeshPhone, useMeshPhone } from "./use-mesh-phone";
import { PhoneScreen } from "@/components/ui/phone-screen";

const INK = "var(--map-ink)";
const PAPER = "var(--map-paper)";
const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;

const CAUSE_LABELS: Record<RoadCause, string> = {
  fire: "Fire",
  debris: "Debris",
  traffic: "Stopped traffic",
  police: "Police closure",
  power_line: "Power line down",
  other: "Something else",
};

function streetName(segment: string) {
  return SEGMENTS.get(segment)?.name || "Unnamed street";
}

function Header({ phone }: { phone: MeshPhone }) {
  return (
    <header className="flex items-center gap-3 px-4 py-3">
      <span className="size-3 shrink-0 bg-signal" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-heading">{PRODUCT_NAME} on your phone</span>
        <span className="type-small text-on-panel-muted">Road reports, shared phone to phone</span>
      </div>
      <span className="type-small flex items-center gap-1.5 font-semibold">
        {phone.online ? <WifiHigh weight="bold" className="size-4" /> : <WifiSlash weight="bold" className="size-4" />}
        {phone.online ? "Online" : "No signal"}
      </span>
    </header>
  );
}

// Streets this phone has heard about: blocked in heavy broken ink, open in thin ink, and the
// street being reported on outlined.
function StreetLayer({ phone, selected }: { phone: MeshPhone; selected: string | null }) {
  const now = useNow(30_000);
  const statuses = phone.node.reports.segments().map((segment) => ({ segment, status: phone.node.reports.consensus(segment, now).status }));
  const path = (segment: string) => SEGMENTS.get(segment)?.path ?? [];
  return (
    <g fill="none">
      {statuses.map(({ segment, status }) =>
        status === "blocked" ? (
          <g key={segment}>
            <GeoLine route={path(segment)} stroke={PAPER} strokeWidth={7} />
            <GeoLine route={path(segment)} stroke={INK} strokeWidth={5} strokeDasharray="3 2" />
          </g>
        ) : status === "clear" ? (
          <GeoLine key={segment} route={path(segment)} stroke={INK} strokeWidth={2.5} />
        ) : null,
      )}
      {selected && (
        <>
          <GeoLine route={path(selected)} stroke={INK} strokeWidth={10} strokeOpacity={0.25} />
          <GeoLine route={path(selected)} stroke={INK} strokeWidth={2} />
        </>
      )}
    </g>
  );
}

function StreetCard({ phone, segment, onDone }: { phone: MeshPhone; segment: string | null; onDone: () => void }) {
  const [cause, setCause] = useState<RoadCause | null>(null);
  const now = useNow(30_000);
  if (!segment) return <p className="type-small px-4 py-4 text-on-panel-muted">Tap a street on the map to say whether it&apos;s blocked or open.</p>;
  const consensus = phone.node.reports.consensus(segment, now);
  const send = (status: "blocked" | "clear") => {
    phone.report(segment, status, status === "blocked" ? (cause ?? undefined) : undefined);
    setCause(null);
    onDone();
  };
  return (
    <section className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-heading">{streetName(segment)}</h2>
        <span className="type-small text-on-panel-muted">{consensus.status === "unknown" ? "No reports yet" : `Reported ${consensus.status === "blocked" ? "blocked" : "open"}`}</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What's blocking it">
        {ROAD_CAUSES.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={cause === key}
            onClick={() => setCause(cause === key ? null : key)}
            className={`type-small h-8 px-2.5 font-semibold ${cause === key ? "bg-on-panel text-panel" : "bg-panel-raised text-on-panel"}`}
          >
            {CAUSE_LABELS[key]}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="onPanel" size="lg" className="flex-1" onClick={() => send("blocked")}>
          Blocked
        </Button>
        <Button variant="onPanelQuiet" size="lg" className="flex-1" onClick={() => send("clear")}>
          Open
        </Button>
      </div>
    </section>
  );
}

function NearbyCard({ phone }: { phone: MeshPhone }) {
  const meeting = phone.lastMeeting;
  const news = meeting && (meeting.reportsReceived > 0 || meeting.modelUpdated) ? describeMeeting(meeting) : null;
  return (
    <section className="flex flex-col gap-1 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-heading">Phones nearby</h2>
        <span className="type-figure text-lg tabular-nums">{phone.tabPeers + phone.links}</span>
      </div>
      <TechTags uses={["mesh"]} className="pb-1" />
      <p className="type-small text-on-panel-muted">
        {phone.tabPeers} on this device, {phone.links} paired. {news ?? "Nothing new from them yet."}
      </p>
      <div className="-mx-4 mt-2">
        <HowItWorks tech="mesh" inset="px-4">Here: your reports and the ones nearby phones passed to you.</HowItWorks>
      </div>
    </section>
  );
}

function describeMeeting(meeting: NonNullable<MeshPhone["lastMeeting"]>) {
  const parts = [];
  if (meeting.reportsReceived > 0) parts.push(`${meeting.reportsReceived} new report${meeting.reportsReceived === 1 ? "" : "s"}`);
  if (meeting.modelUpdated) parts.push("a newer model");
  return `Last meeting brought ${parts.join(" and ")}.`;
}

function SharingCard({ phone }: { phone: MeshPhone }) {
  const node = phone.node;
  const privacy = node.privacy();
  const held = node.pool.totalMass();
  const upload = phone.upload;
  return (
    <section className="flex flex-col">
      <TechTags uses={["federated"]} className="px-4 pt-3" />
      <Switch
        checked={node.participate}
        onChange={phone.setParticipation}
        label="Help train the shared model"
        hint="What you report stays on this phone. Only a noised change to the model leaves it, always mixed with other phones'."
      />
      <Switch
        checked={phone.gateway}
        onChange={phone.setGateway}
        label="Upload for others when I have internet"
        hint="Sends the road reports this phone carries, and mixed model updates once they hold five or more phones."
      />
      <dl className="flex flex-col gap-0.5 px-4 py-3">
        <Row label="Shared model" value={`version ${node.model.version}`} />
        <Row label="Your updates so far" value={`${node.contributions()} (privacy spent ε ${privacy.epsilon.toFixed(1)})`} />
        <Row label="Mixed updates carried" value={`${held.toFixed(1)} phones' worth${held >= UPLOAD_MIN_MASS ? ", ready to upload" : ""}`} />
        {upload && <Row label="Last upload" value={upload.error ? upload.error : `${upload.reports} reports, ${upload.mixes} mixes`} />}
      </dl>
      <HowItWorks tech="federated" inset="px-4">Here: this phone&apos;s part in training, and what it has given away.</HowItWorks>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="type-small text-on-panel-muted">{label}</dt>
      <dd className="type-small text-right font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ReportList({ phone }: { phone: MeshPhone }) {
  const now = useNow(10_000);
  const reports = phone.node.reports
    .all()
    .sort((a, b) => b.observedAt - a.observedAt)
    .slice(0, 12);
  if (reports.length === 0) return <p className="type-small px-4 py-4 text-on-panel-muted">No road reports yet, from you or anyone nearby.</p>;
  return (
    <ul className="flex flex-col divide-y divide-panel-raised">
      {reports.map((report) => (
        <ReportRow key={report.id} report={report} now={now} />
      ))}
    </ul>
  );
}

// Report times are rounded to the minute on purpose, so they're shown to the minute.
function minutesAgo(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return minutes === 0 ? "this minute" : `${minutes} min ago`;
}

function ReportRow({ report, now }: { report: RoadReport; now: number }) {
  const source = report.hops === 0 ? "From this phone" : `Passed through ${report.hops} phone${report.hops === 1 ? "" : "s"}`;
  return (
    <li className="flex items-baseline justify-between gap-3 px-4 py-2">
      <span className="flex min-w-0 flex-col">
        <span className="type-small truncate font-semibold">
          {streetName(report.segment)} {report.status === "blocked" ? "blocked" : "open"}
          {report.cause ? `: ${CAUSE_LABELS[report.cause].toLowerCase()}` : ""}
        </span>
        <span className="type-small text-on-panel-muted">{source}</span>
      </span>
      <span className="type-small shrink-0 tabular-nums text-on-panel-muted">{now ? minutesAgo(now - report.observedAt) : ""}</span>
    </li>
  );
}

export function PhoneMesh() {
  const data = useInkMapData();
  const phone = useMeshPhone();
  const [selected, setSelected] = useState<string | null>(null);
  const projection = useMemo(() => createProjection(data?.origin ?? { lat: 0, lng: 0 }), [data?.origin]);
  const pick = useCallback((point: Point) => setSelected(nearestSegment(projection.toLatLng(point))?.key ?? null), [projection]);

  return (
    <PhoneScreen>
      <Header phone={phone} />
      <div className="relative h-[38dvh] min-h-64 overflow-hidden">
        {data ? (
          <MapStage data={data} view={VIEW} onPick={pick} interactive className="absolute inset-0">
            <StreetLayer phone={phone} selected={selected} />
          </MapStage>
        ) : (
          <p className="type-small grid h-full place-items-center bg-map-paper text-ink-muted">Loading the map…</p>
        )}
      </div>
      <div className="flex flex-col divide-y divide-panel-raised">
        <StreetCard phone={phone} segment={selected} onDone={() => setSelected(null)} />
        <NearbyCard phone={phone} />
        <PairingCard addLink={phone.addLink} links={phone.links} />
        <SharingCard phone={phone} />
        <ReportList phone={phone} />
        <nav className="flex justify-between gap-3 px-4 py-4">
          <Link href="/flow" className="type-small font-semibold text-on-panel-muted hover:text-on-panel">
            Simulated night
          </Link>
          <Link href="/mesh/agency" className="type-small font-semibold text-on-panel-muted hover:text-on-panel">
            What the agency received
          </Link>
        </nav>
      </div>
    </PhoneScreen>
  );
}
