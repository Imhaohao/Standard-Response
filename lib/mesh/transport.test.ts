import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIMENSIONS } from "./federated";
import { MeshNode } from "./node";
import { seededIds, seededRandom } from "./random";
import { TabMesh, PeerSession, Link } from "./transport";
import { decodeDescription, encodeDescription } from "./webrtc";

const SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=candidate:1 1 udp 2122260223 4f3c2a1e-1111-2222-3333-444455556666.local 54400 typ host generation 0",
  "a=candidate:2 1 udp 1686052607 203.0.113.7 54400 typ srflx raddr 0.0.0.0 rport 0 generation 0",
  "a=ice-ufrag:abcd",
  "a=ice-pwd:abcdefghijklmnopqrstuvwx",
  "a=fingerprint:sha-256 " + Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":"),
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "",
].join("\r\n");

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const node = (seed: number) => {
  const random = seededRandom(seed);
  return new MeshNode({ newId: seededIds(random), random, now: () => Date.now() });
};

describe("pairing codes", () => {
  it("survive the round trip, keep host candidates only, and stay short enough for a QR code", async () => {
    const code = await encodeDescription({ type: "offer", sdp: SDP });
    const back = await decodeDescription(code);
    assert.equal(back.type, "offer");
    assert.ok(back.sdp!.includes("typ host"));
    assert.ok(!back.sdp!.includes("typ srflx"));
    assert.ok(code.length < 1200, `${code.length} characters`);
  });

  it("refuse text that isn't a pairing code", async () => {
    await assert.rejects(decodeDescription("hello"));
  });
});

describe("tabs on one device", () => {
  it("share reports and move mass without creating any", async () => {
    const a = node(1);
    const b = node(2);
    a.report("100-200-0", "blocked", "fire");
    a.pool.contribute(0, Array(DIMENSIONS).fill(0.1));
    b.pool.contribute(0, Array(DIMENSIONS).fill(0.2));
    const name = `test-${Math.random()}`;
    const tabA = new TabMesh(a, () => {}, name);
    const tabB = new TabMesh(b, () => {}, name);
    tabA.start();
    tabB.start();
    await wait(150);
    tabA.stop();
    tabB.stop();
    assert.equal(b.reports.size, 1);
    assert.ok(Math.abs(a.pool.totalMass() + b.pool.totalMass() - 2) < 1e-9);
  });
});

describe("a point-to-point link", () => {
  it("syncs two phones through a pair of linked sessions", () => {
    const a = node(3);
    const b = node(4);
    b.report("300-400-0", "clear");
    let sessionA: PeerSession | null = null;
    let sessionB: PeerSession | null = null;
    const linkA: Link = { send: (text) => sessionB!.receive(text), close: () => {} };
    const linkB: Link = { send: (text) => sessionA!.receive(text), close: () => {} };
    sessionA = new PeerSession(a, linkA, () => {});
    sessionB = new PeerSession(b, linkB, () => {});
    sessionA.sayHello();
    sessionB.sayHello();
    assert.equal(a.reports.size, 1);
  });
});
