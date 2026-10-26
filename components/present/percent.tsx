// The Nexa Rust trial has no % or × glyph (it draws "TRIAL FONT" instead), so those signs are set in
// the condensed display face beside the Nexa figure.
function OutsideTrial({ glyph }: { glyph: string }) {
  return <span className="font-display">{glyph}</span>;
}

export function Percent() {
  return <OutsideTrial glyph="%" />;
}

export function Times() {
  return <OutsideTrial glyph="×" />;
}
