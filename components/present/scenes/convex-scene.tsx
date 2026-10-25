"use client";

import { motion } from "motion/react";
import type { ComponentType } from "react";
import { sceneMove } from "../motion";
import type { Beat } from "../script";
import { Show } from "../show";
import { CallFloor, CallScreen, DriverPhone, RescueMap } from "./convex/surfaces";

type Tile = { Surface: ComponentType; left: number; width: number };

const TILE_TOP = 110;
const TILE_HEIGHT = 360;
const TILES: Tile[] = [
  { Surface: CallScreen, left: 170, width: 220 },
  { Surface: RescueMap, left: 450, width: 480 },
  { Surface: DriverPhone, left: 990, width: 220 },
  { Surface: CallFloor, left: 1270, width: 480 },
];
const HUB = { x: 960, y: 800, radius: 104 };

// Each surface's wire leaves the bottom of its tile and bends down into the top of the hub.
function wireFor({ left, width }: Tile, i: number) {
  const startX = left + width / 2;
  const startY = TILE_TOP + TILE_HEIGHT + 16;
  const endX = HUB.x + (i - (TILES.length - 1) / 2) * 44;
  const endY = HUB.y - HUB.radius + 8;
  const bend = (endY - startY) * 0.6;
  return `M${startX} ${startY} C${startX} ${startY + bend} ${endX} ${endY - bend} ${endX} ${endY}`;
}
const WIRES = TILES.map(wireFor);

const PACKETS_PER_WIRE = 7;
const PACKET_SECONDS = 1.4;

// Writes leave every surface at once and run down its wire into the hub, over and over.
function Packets({ wire }: { wire: string }) {
  return (
    <>
      {Array.from({ length: PACKETS_PER_WIRE }, (_, i) => (
        <motion.span
          key={i}
          className="absolute top-0 left-0 size-4 rounded-full bg-on-night shadow-[0_0_18px_6px_oklch(0.95_0.006_85/0.45)]"
          style={{ offsetPath: `path("${wire}")`, offsetRotate: "0deg", marginLeft: -8, marginTop: -8 }}
          initial={{ offsetDistance: "0%", opacity: 0 }}
          animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
          transition={{ duration: PACKET_SECONDS, delay: (i / PACKETS_PER_WIRE) * PACKET_SECONDS, repeat: Infinity, ease: "easeIn", times: [0, 0.1, 0.9, 1] }}
        />
      ))}
    </>
  );
}

function Wires({ shown, storming }: { shown: boolean; storming: boolean }) {
  return (
    <>
      <svg width={1920} height={1080} className="absolute inset-0" aria-hidden>
        {WIRES.map((wire, i) => (
          <motion.path
            key={wire}
            d={wire}
            fill="none"
            stroke="var(--on-night-muted)"
            strokeWidth={3}
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: shown ? 1 : 0, opacity: shown ? 1 : 0, strokeOpacity: storming ? 0.6 : 0.35 }}
            transition={{ ...sceneMove, duration: 1.4, delay: shown ? 0.5 + i * 0.12 : 0 }}
          />
        ))}
      </svg>
      {storming && WIRES.map((wire) => <Packets key={wire} wire={wire} />)}
    </>
  );
}

function Hub({ shown, storming }: { shown: boolean; storming: boolean }) {
  const size = HUB.radius * 2;
  return (
    <Show when={shown} delay={0.3} rise={0} className="absolute" style={{ left: HUB.x - HUB.radius, top: HUB.y - HUB.radius, width: size, height: size }}>
      {storming && (
        <span className="absolute inset-0 animate-ping rounded-full bg-on-night/20 [animation-duration:1.4s]" aria-hidden />
      )}
      <motion.span
        className="relative flex size-full items-center justify-center rounded-full bg-on-night text-night shadow-[0_0_0_10px_var(--night),0_0_80px_20px_oklch(0.95_0.006_85/0.18)]"
        initial={false}
        animate={storming ? { scale: [1, 1.05, 1] } : { scale: 1 }}
        transition={storming ? { duration: PACKET_SECONDS / 2, repeat: Infinity, ease: "easeInOut" } : sceneMove}
      >
        <span className="type-deck-label">Convex</span>
      </motion.span>
    </Show>
  );
}

export function ConvexScene({ beat }: { beat: Beat }) {
  const storming = beat === "stress";
  const shown = beat === "hub" || storming;
  return (
    <>
      {TILES.map(({ Surface, left, width }, i) => (
        <Show key={left} when={shown} delay={i * 0.1} className="absolute" style={{ left, top: TILE_TOP, width, height: TILE_HEIGHT }}>
          <Surface />
        </Show>
      ))}
      <Wires shown={shown} storming={storming} />
      <Hub shown={shown} storming={storming} />
      <Show when={storming} delay={0.4} className="absolute" style={{ left: 128, top: 640, width: 640 }}>
        <p className="type-deck-figure">300</p>
        <p className="type-deck-lede mt-6">accepts sent at once</p>
      </Show>
      <Show when={storming} delay={1.4} className="absolute text-right" style={{ right: 128, top: 640, width: 640 }}>
        <p className="type-deck-figure">25</p>
        <p className="type-deck-lede mt-6">rides, one driver each</p>
      </Show>
    </>
  );
}
