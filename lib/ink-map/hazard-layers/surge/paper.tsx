import { PlaceholderPaper } from "../placeholder-paper";
import type { PaperHazardProps } from "../types";

// Stand-in until the surge renderer lands its flat drawing.
export function SurgePaper(props: PaperHazardProps) {
  return <PlaceholderPaper {...props} color="var(--map-indigo)" angle={20} />;
}
