import type { Metadata } from "next";
import { Suspense } from "react";
import { PRODUCT_NAME } from "@/lib/brand";
import { SceneLab, type SceneParams } from "./scene-lab";

export const metadata: Metadata = { title: `${PRODUCT_NAME} scenes` };

type Query = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const numberOr = (value: string | undefined, fallback: number | null) => {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function sceneParams(query: Query): SceneParams {
  return {
    city: one(query.city) ?? null,
    minutes: numberOr(one(query.t), null),
    play: one(query.play) === "1",
    speed: numberOr(one(query.speed), null),
    frame: one(query.frame) ?? null,
    chrome: one(query.chrome) !== "0",
    replay: one(query.replay) === "1",
  };
}

async function SceneFromQuery({ searchParams }: { searchParams: Promise<Query> }) {
  return <SceneLab params={sceneParams(await searchParams)} />;
}

// /lab/scenes?city=<id>&t=<minutes>&play=1&speed=<scenario minutes per second>&frame=<name>&chrome=0&replay=1
export default function Page({ searchParams }: { searchParams: Promise<Query> }) {
  return (
    <Suspense>
      <SceneFromQuery searchParams={searchParams} />
    </Suspense>
  );
}
