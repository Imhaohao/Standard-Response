import { PlaceholderPaper } from "../placeholder-paper";
import type { PaperHazardProps } from "../types";

// Stand-in until the blizzard renderer lands its flat drawing.
export function BlizzardPaper(props: PaperHazardProps) {
  return <PlaceholderPaper {...props} color="var(--map-ink)" angle={90} />;
}
