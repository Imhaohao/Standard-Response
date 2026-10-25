import { motion } from "motion/react";
import { BrandMark } from "@/components/ui/brand-mark";
import { PRODUCT_NAME, WORDMARK, WORDMARK_LAST_WORD } from "@/lib/brand";

// The product mark at slide size: the ringing flame, then the name in Nexa Rust. Sized by the type class it
// carries. At display sizes the words stack and the mark grows to their height. `shared` gives the mark
// and the last word layout ids, so the close can fly them in from where they first appeared.
type WordmarkProps = { className: string; stacked?: boolean; shared?: boolean };

export function Wordmark({ className, stacked = false, shared = false }: WordmarkProps) {
  const leadingWords = WORDMARK.split(" ").slice(0, -1);
  return (
    <div className={`flex items-center gap-[0.22em] text-on-night ${className} font-brand`} role="img" aria-label={PRODUCT_NAME}>
      <motion.span layoutId={shared ? "wordmark-mark" : undefined} className="flex">
        <BrandMark className={stacked ? "size-[1.7em]" : "size-[0.95em]"} />
      </motion.span>
      {stacked ? (
        <span className="flex flex-col items-start">
          {leadingWords.map((word) => (
            <span key={word}>{word}</span>
          ))}
          <motion.span layoutId={shared ? "wordmark-last" : undefined}>{WORDMARK_LAST_WORD}</motion.span>
        </span>
      ) : (
        <span className="whitespace-nowrap">{WORDMARK}</span>
      )}
    </div>
  );
}
