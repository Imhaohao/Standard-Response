"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";
import { Link, PeerSession, TabMesh } from "@/lib/mesh/transport";
import { AreaShape, areaOf } from "@/lib/prepare/areas";
import { MeetingResult } from "@/lib/prepare/node";
import { Answers, Topic } from "@/lib/prepare/survey";
import { TASK_IDS } from "@/lib/prepare/tasks";
import { surveyStore } from "./survey-store";

// One household's phone in the readiness survey. It meets other tabs on this device and phones
// paired over WebRTC, downloads the public models whenever it is online, and uploads mixes only
// while the household has "Upload for others" on and has internet.

const UPLOAD_EVERY_MS = 30_000;

export type UploadState = { at: number; mixes: number; households: number; error?: string } | null;

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

export function useAreaShapes() {
  const [shapes, setShapes] = useState<AreaShape[] | null>(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/prepare/areas")
      .then((r) => r.json() as Promise<AreaShape[]>)
      .then((list) => live && setShapes(list))
      .catch(() => live && setShapes([]));
    return () => {
      live = false;
    };
  }, []);
  return shapes;
}

function useTabMesh(onMeeting: (result: MeetingResult) => void) {
  const store = surveyStore();
  const [mesh, setMesh] = useState<TabMesh<MeetingResult> | null>(null);
  const [peers, setPeers] = useState(0);
  useEffect(() => {
    store.restoreOnce();
    const tabs = new TabMesh(store.phone, onMeeting, "rollcall-prepare");
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
  const store = surveyStore();
  const gateway = store.settings.gateway;
  const [upload, setUpload] = useState<UploadState>(null);
  const send = useMutation(api.prepare.upload);

  useEffect(() => {
    store.setOnline(online);
  }, [store, online]);

  const uploadNow = useCallback(async () => {
    const phone = store.phone;
    const mixes = phone.takeUpload();
    if (mixes.length === 0) return;
    try {
      const result = await send({ mixes });
      for (const task of TASK_IDS) phone.adoptModel(task, result.models[task]);
      setUpload({ at: Date.now(), mixes: result.accepted, households: mixes.reduce((s, m) => s + m.mass, 0) });
    } catch (error) {
      phone.restoreUpload(mixes);
      setUpload({ at: Date.now(), mixes: 0, households: 0, error: error instanceof Error ? error.message : "Upload failed" });
    }
    store.changed();
  }, [store, send]);

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

export function useSurveyPhone() {
  const store = surveyStore();
  const revision = useSyncExternalStore(store.subscribe, store.getRevision, () => 0);
  const [links, setLinks] = useState<PeerSession<MeetingResult>[]>([]);
  const [lastMeeting, setLastMeeting] = useState<MeetingResult | null>(null);
  const online = useOnline();
  const shapes = useAreaShapes();
  const sharedModels = useQuery(api.prepare.models);

  const onMeeting = useCallback(
    (result: MeetingResult) => {
      setLastMeeting(result);
      store.changed();
    },
    [store],
  );
  const tabs = useTabMesh(onMeeting);
  const { upload, uploadNow } = useGatewayUploads(online);

  // The models are public, so the phone takes them whenever it has internet.
  useEffect(() => {
    if (!sharedModels) return;
    let changed = false;
    for (const task of TASK_IDS) changed = store.phone.adoptModel(task, sharedModels[task]) || changed;
    if (changed) store.changed();
  }, [store, sharedModels]);

  // Something new to pass on: say hello to everyone in reach so they meet again now.
  const announce = useCallback(() => {
    tabs.mesh?.announce();
    for (const link of links) link.sayHello();
    store.changed();
  }, [store, tabs.mesh, links]);

  const answer = useCallback(
    (answers: Answers) => {
      store.phone.answer(answers);
      announce();
    },
    [store, announce],
  );

  const setHome = useCallback(
    (home: LatLng) => {
      store.update({ home });
      store.phone.setArea(shapes ? areaOf(home, shapes) : null);
      announce();
    },
    [store, shapes, announce],
  );

  const setConsent = useCallback(
    (topic: Topic, agreed: boolean) => {
      store.phone.setConsent(topic, agreed);
      announce();
    },
    [store, announce],
  );

  const addLink = useCallback(
    (link: Link, listen: (receive: (text: unknown) => void) => void) => {
      const session = new PeerSession(store.phone, link, onMeeting);
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

  // Becoming a gateway changes which way mass flows, so phones in reach should hear it now.
  const setGateway = useCallback(
    (gateway: boolean) => {
      store.update({ gateway });
      announce();
    },
    [store, announce],
  );

  return useMemo(
    () => ({
      phone: store.phone,
      revision,
      online,
      home: store.settings.home,
      gateway: store.settings.gateway,
      shapes,
      tabPeers: tabs.peers,
      links: links.length,
      lastMeeting,
      upload,
      answer,
      setHome,
      setConsent,
      addLink,
      setGateway,
      uploadNow,
    }),
    [store, revision, online, shapes, tabs.peers, links.length, lastMeeting, upload, answer, setHome, setConsent, addLink, setGateway, uploadNow],
  );
}

export type SurveyPhoneState = ReturnType<typeof useSurveyPhone>;
