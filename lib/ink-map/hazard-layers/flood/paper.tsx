import { WaterPaper } from "../water/paper";
import type { PaperHazardProps } from "../types";

export function FloodPaper(props: PaperHazardProps) {
  return <WaterPaper kind="flood" {...props} />;
}
