"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api } from "@/convex/_generated/api";
import { ScenarioGeoJson } from "@/lib/ink-map/fire-field";
import { SIM_MINUTES_PER_SECOND } from "@/lib/ink-map/hazard";
import { MeetingResult } from "@/lib/mesh/node";
import { RoadCause, RoadStatus } from "@/lib/mesh/reports";
import { SEGMENT_INDEX } from "@/lib/mesh/roads";
import { segmentFireMinutes, streetFeatures } from "@/lib/mesh/street-features";
import { Link, PeerSession, TabMesh } from "@/lib/mesh/transport";
import { phoneStore } from "./phone-store";

// One resident's phone on the mesh. It talks to other tabs on this device and to phones paired
// over WebRTC, and uploads only while the person has "Upload for others" on and has internet.

const UPLOAD_EVERY_MS = 30_000;
const MAX_REPORTS_PER_UPLOAD = 400;

export type UploadState = { at: number; reports: number; mixes: number; error?: string } | null;

function useOnline() {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener("online", listener);
      window.addEventListener("offline", listener);
      return () => {
        window.removeEventListener("online", listener);
        window.removeEventListener("offline", listener);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

function useScenarioFireMinutes() {
  const [fire, setFire] = useState<Float64Array | null>(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/scenario")
      .then((r) => r.json() as Promise<ScenarioGeoJson | null>)
      .then((scenario) => live && setFire(segmentFireMinutes(scenario)))
      .catch(() => live && setFire(segmentFireMinutes(null)));
    return () => {
      live = false;
    };
  }, []);
  return fire;
}

// Tabs on this device: start once, and report what each meeting brought.
function useTabMesh(onMeeting: (result: MeetingResult) => void) {
  const store = phoneStore();
  const [mesh, setMesh] = useState<TabMesh | null>(null);
  const [peers, setPeers] = useState(0);
  useEffect(() => {
    store.restoreOnce();
    const tabs = new TabMesh(store.node, onMeeting);
    tabs.start();
    const timer = setInterval(() => {
      setMesh(tabs);
      setPeers(tabs.peerCount());
    }, 2000);
    return () => {
      clearInterval(timer);
      tabs.stop();
    };
  }, [store, onMeeting]);
  return { mesh, peers };
}

function useGatewayUploads(online: boolean) {
  const store = phoneStore();
  const gateway = store.settings.gateway;
  const [upload, setUpload] = useState<UploadState>(null);
  const uploadReports = useMutation(api.mesh.uploadReports);
  const uploadMixes = useMutation(api.mesh.uploadMixes);

  useEffect(() => {
    store.setOnline(online);
  }, [store, online]);

  const uploadNow = useCallback(async () => {
    const node = store.node;
    const taken = node.takeUpload();
    const reports = taken.reports.slice(0, MAX_REPORTS_PER_UPLOAD);
    try {
      const sent = await uploadReports({ reports });
      const mixes = taken.mixes.length > 0 ? await uploadMixes({ mixes: taken.mixes }) : null;
      node.confirmUpload(reports.map((r) => r.id));
      if (mixes) node.adoptModel(mixes.model);
      setUpload({ at: Date.now(), reports: sent.added, mixes: mixes?.accepted ?? 0 });
    } catch (error) {
      node.restoreUpload(taken.mixes);
      setUpload({ at: Date.now(), reports: 0, mixes: 0, error: error instanceof Error ? error.message : "Upload failed" });
    }
    store.changed();
  }, [store, uploadReports, uploadMixes]);

  useEffect(() => {
    if (!gateway || !online) return;
    const first = setTimeout(() => void uploadNow(), 0);
    const timer = setInterval(() => void uploadNow(), UPLOAD_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [gateway, online, uploadNow]);

  return { upload, uploadNow };
}

export function useMeshPhone() {
  const store = phoneStore();
  const revision = useSyncExternalStore(store.subscribe, store.getRevision, () => 0);
  const [links, setLinks] = useState<PeerSession[]>([]);
  const [lastMeeting, setLastMeeting] = useState<MeetingResult | null>(null);
  const online = useOnline();
  const fire = useScenarioFireMinutes();
  const control = useQuery(api.control.get);
  const sharedModel = useQuery(api.mesh.model);

  const onMeeting = useCallback(
    (result: MeetingResult) => {
      setLastMeeting(result);
      store.changed();
    },
    [store],
  );
  const tabs = useTabMesh(onMeeting);
  const { upload, uploadNow } = useGatewayUploads(online);

  // The warning time comes from the agency while online, and is remembered for when it isn't.
  useEffect(() => {
    if (control?.warningIssuedAt !== undefined && control.warningIssuedAt !== store.settings.warningIssuedAt) {
      store.update({ warningIssuedAt: control.warningIssuedAt });
    }
  }, [store, control?.warningIssuedAt]);

  useEffect(() => {
    if (sharedModel && store.node.adoptModel(sharedModel)) store.changed();
  }, [store, sharedModel]);

  const report = useCallback(
    (segment: string, status: RoadStatus, cause?: RoadCause) => {
      const node = store.node;
      node.report(segment, status, cause);
      const index = SEGMENT_INDEX.get(segment);
      const issuedAt = store.settings.warningIssuedAt;
      if (fire && index !== undefined) {
        const minutes = issuedAt === undefined ? 0 : ((Date.now() - issuedAt) / 1000) * SIM_MINUTES_PER_SECOND;
        const believed = new Set(node.reports.blockedSegments(Date.now()).map((key) => SEGMENT_INDEX.get(key)));
        node.observe({ x: streetFeatures(index, minutes, fire, (s) => believed.has(s)), y: status === "blocked" ? 1 : 0 });
      }
      tabs.mesh?.announce();
      for (const link of links) link.sayHello();
      store.changed();
    },
    [store, fire, tabs.mesh, links],
  );

  const addLink = useCallback(
    (link: Link, listen: (receive: (text: unknown) => void) => void) => {
      const session = new PeerSession(store.node, link, onMeeting);
      listen((text) => session.receive(text));
      session.start();
      setLinks((current) => [...current, session]);
      return () => {
        session.stop();
        setLinks((current) => current.filter((s) => s !== session));
      };
    },
    [store, onMeeting],
  );

  const setParticipation = useCallback(
    (participate: boolean) => {
      store.node.setParticipation(participate);
      store.changed();
    },
    [store],
  );

  const setGateway = useCallback((gateway: boolean) => store.update({ gateway }), [store]);

  return useMemo(
    () => ({
      node: store.node,
      revision,
      online,
      gateway: store.settings.gateway,
      tabPeers: tabs.peers,
      links: links.length,
      lastMeeting,
      upload,
      report,
      addLink,
      setParticipation,
      setGateway,
      uploadNow,
    }),
    [store, revision, online, tabs.peers, links.length, lastMeeting, upload, report, addLink, setParticipation, setGateway, uploadNow],
  );
}

export type MeshPhone = ReturnType<typeof useMeshPhone>;
