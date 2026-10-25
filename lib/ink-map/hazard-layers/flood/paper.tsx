import { PlaceholderPaper } from "../placeholder-paper";
import type { PaperHazardProps } from "../types";

// Stand-in until the flood renderer lands its flat drawing.
export function FloodPaper(props: PaperHazardProps) {
  return <PlaceholderPaper {...props} color="var(--map-indigo)" angle={0} />;
}
