import { WaterPaper } from "../water/paper";
import type { PaperHazardProps } from "../types";

export function TsunamiPaper(props: PaperHazardProps) {
  return <WaterPaper kind="tsunami" {...props} />;
}
