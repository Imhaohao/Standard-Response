import { WaterPaper } from "../water/paper";
import type { PaperHazardProps } from "../types";

export function SurgePaper(props: PaperHazardProps) {
  return <WaterPaper kind="surge" {...props} />;
}
