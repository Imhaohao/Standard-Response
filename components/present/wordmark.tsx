import { motion } from "motion/react";
import { BrandMark } from "@/components/ui/brand-mark";
import { PRODUCT_NAME, WORDMARK } from "@/lib/brand";

// The product mark at slide size: the ringing flame, then the name in hotdogs. Sized by the type class it
// carries. At display sizes the two words stack and the mark grows to their height. `shared` gives the mark
// and the second word layout ids, so the close can fly them in from where they first appeared.
type WordmarkProps = { className: string; stacked?: boolean; shared?: boolean };

export function Wordmark({ className, stacked = false, shared = false }: WordmarkProps) {
  const [first, ...rest] = WORDMARK.split(" ");
  return (
    <div className={`flex items-center gap-[0.22em] text-on-night ${className} font-brand`} role="img" aria-label={PRODUCT_NAME}>
      <motion.span layoutId={shared ? "wordmark-mark" : undefined} className="flex">
        <BrandMark className={stacked ? "size-[1.7em]" : "size-[0.95em]"} />
      </motion.span>
      {stacked ? (
        <span className="flex flex-col items-start">
          <span>{first}</span>
          <motion.span layoutId={shared ? "wordmark-second" : undefined}>{rest.join(" ")}</motion.span>
        </span>
      ) : (
        <span className="whitespace-nowrap">{WORDMARK}</span>
      )}
    </div>
  );
}
