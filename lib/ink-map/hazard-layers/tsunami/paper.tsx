import { PlaceholderPaper } from "../placeholder-paper";
import type { PaperHazardProps } from "../types";

// Stand-in until the tsunami renderer lands its flat drawing.
export function TsunamiPaper(props: PaperHazardProps) {
  return <PlaceholderPaper {...props} color="var(--map-indigo)" angle={-20} />;
}
