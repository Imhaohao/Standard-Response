"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { deckRoom, listenForRemote, remoteAvailable, sendRemote } from "./channel";

type RemoteCommands = { next: () => void; previous: () => void; onPaired: () => void };

let room: string | null = null;

function currentRoom() {
  room ??= deckRoom();
  return room;
}

function noSubscription() {
  return () => {};
}

// Listens for the phone. The latest commands live in a ref so stepping through
// the deck never drops the relay connection.
export function useRemote(commands: RemoteCommands) {
  const deckRoomName = useSyncExternalStore(noSubscription, currentRoom, () => null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });

  useEffect(() => {
    if (!deckRoomName || !remoteAvailable) return;
    const tellPhone = (command: "ready" | "paired") => void sendRemote(deckRoomName, command).catch(() => {});
    return listenForRemote(
      deckRoomName,
      "deck",
      (command) => {
        if (command === "next") latest.current.next();
        if (command === "previous") latest.current.previous();
        if (command !== "hello") return;
        setPhoneConnected(true);
        latest.current.onPaired();
        tellPhone("paired");
      },
      () => tellPhone("ready"),
    );
  }, [deckRoomName]);

  return { room: deckRoomName, phoneConnected };
}
