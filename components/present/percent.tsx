// The Nexa Rust trial has no % glyph (it draws "TRIAL FONT" instead), so the sign is set in the
// condensed display face beside the Nexa figure.
export function Percent() {
  return <span className="font-display">%</span>;
}
