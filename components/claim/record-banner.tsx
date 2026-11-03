import { ArrowUpRight, Trophy } from "@phosphor-icons/react";

const CAL_HACKS_WRITE_UP_URL = "https://www.borisnezlobin.com/writing/calhacks-record";

export function RecordBanner() {
  return (
    <a
      href={CAL_HACKS_WRITE_UP_URL}
      target="_blank"
      rel="noopener"
      className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-2xl bg-ink px-5 py-3 text-panel shadow-float transition-[background-color] duration-150 hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:px-6"
    >
      <span className="type-heading flex items-center gap-2.5">
        <Trophy aria-hidden className="size-5 shrink-0" />
        The most awarded project in Cal Hacks history!
      </span>
      <span className="type-small inline-flex items-center gap-1 font-semibold underline underline-offset-2">
        Read about it
        <ArrowUpRight aria-hidden className="size-4 shrink-0" />
      </span>
    </a>
  );
}
