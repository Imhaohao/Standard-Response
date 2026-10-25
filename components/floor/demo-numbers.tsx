"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { FormEvent, useState } from "react";
import { ArrowUUpLeft, HouseLine, MagnifyingGlass, Phone, Plus, Trash } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { phoneForPeople } from "@/lib/labels";
import { formatPhoneAsTyped, isFictionalNumber } from "@/lib/phone-number";
import { Button } from "../ui/button";
import { ON_PANEL_FIELD } from "../ui/field";
import { Switch } from "../ui/switch";
import { useDismiss } from "../ui/use-dismiss";

type DemoNumber = FunctionReturnType<typeof api.demoNumbers.list>["numbers"][number];

const MATCHES_SHOWN = 6;

// Every house is in the same town, so the street line is enough to tell them apart.
function streetLine(address: string) {
  return address.split(",")[0];
}

function messageOf(failure: unknown, fallback: string) {
  return failure instanceof ConvexError ? String(failure.data) : fallback;
}

// Runs a mutation and keeps its refusal for the row to show in place.
function useAttempt() {
  const [error, setError] = useState<string | null>(null);
  const attempt = async (run: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await run();
      return true;
    } catch (failure) {
      setError(messageOf(failure, fallback));
      return false;
    }
  };
  return { error, attempt };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="type-small font-semibold text-signal">
      {error}
    </p>
  );
}

function HousePicker({ number, onDone }: { number: DemoNumber; onDone: () => void }) {
  const homes = useQuery(api.households.coverage);
  const putOn = useMutation(api.demoNumbers.putOn);
  const [search, setSearch] = useState("");
  const { error, attempt } = useAttempt();
  const words = search.trim().toLowerCase();
  const matches = words === "" ? [] : (homes ?? []).filter((home) => isFictionalNumber(home.callbackNumber) && home.address.toLowerCase().includes(words)).slice(0, MATCHES_SHOWN);
  const choose = async (householdId: Id<"households">) => {
    if (await attempt(() => putOn({ numberId: number._id, householdId }), "Couldn't put the number on that house")) onDone();
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="relative">
        <span className="sr-only">Find a house for {number.name}</span>
        <MagnifyingGlass weight="bold" className="pointer-events-none absolute top-3 left-3 size-4 text-on-panel-muted" aria-hidden />
        <input className={`${ON_PANEL_FIELD} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Street or house number" autoComplete="off" autoFocus />
      </label>
      {matches.length > 0 && (
        <ul className="flex flex-col">
          {matches.map((home) => (
            <li key={home._id}>
              <button
                type="button"
                onClick={() => void choose(home._id)}
                className="type-small flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-on-panel"
              >
                <HouseLine weight="bold" className="size-4 shrink-0 text-on-panel-muted" aria-hidden />
                {streetLine(home.address)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {words !== "" && matches.length === 0 && homes !== undefined && <p className="type-small text-on-panel-muted">No house without a real phone matches that.</p>}
      <ErrorLine error={error} />
      <div className="flex justify-end">
        <Button variant="onPanelQuiet" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// The house a number is on, or, while it's switched off, the house it goes back to.
function HouseLineOf({ number }: { number: DemoNumber }) {
  const address = number.home?.address ?? (number.on ? undefined : number.rememberedAddress);
  return (
    <span className={`flex min-w-0 flex-1 items-center gap-2 transition-opacity duration-150 ${number.on ? "" : "opacity-55"}`}>
      <HouseLine weight={number.home ? "fill" : "bold"} className={`size-4 shrink-0 ${number.home ? "" : "text-on-panel-muted"}`} aria-hidden />
      <span className={`type-small min-w-0 flex-1 truncate ${number.home ? "font-semibold" : "text-on-panel-muted"}`}>{address ? streetLine(address) : "Not on a house"}</span>
    </span>
  );
}

function NumberRow({ number }: { number: DemoNumber }) {
  const setOn = useMutation(api.demoNumbers.setOn);
  const remove = useMutation(api.demoNumbers.remove);
  const [picking, setPicking] = useState(false);
  const { error, attempt } = useAttempt();
  const hasHouse = number.home !== null || number.rememberedAddress !== undefined;
  return (
    <li className="flex flex-col gap-2 border-b border-panel-raised px-3 py-3">
      <Switch
        checked={number.on}
        onChange={(on) => void attempt(() => setOn({ numberId: number._id, on }), on ? "Couldn't switch the number on" : "Couldn't switch the number off")}
        label={number.name}
        hint={phoneForPeople(number.phone)}
        className={`w-full transition-opacity duration-150 ${number.on ? "" : "opacity-55"}`}
      />
      {picking ? (
        <HousePicker number={number} onDone={() => setPicking(false)} />
      ) : (
        <div className="flex items-center gap-2">
          <HouseLineOf number={number} />
          <Button variant="onPanelQuiet" size="sm" onClick={() => setPicking(true)}>
            {hasHouse ? "Move" : "Put on a house"}
          </Button>
          <Button
            variant="onPanelQuiet"
            size="sm"
            square
            aria-label={`Delete ${number.name}'s number`}
            onClick={() => void attempt(() => remove({ numberId: number._id }), "Couldn't delete the number")}
          >
            <Trash weight="bold" className="size-4" />
          </Button>
        </div>
      )}
      <ErrorLine error={error} />
    </li>
  );
}

function AddNumberForm() {
  const add = useMutation(api.demoNumbers.add);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const { error, attempt } = useAttempt();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!(await attempt(() => add({ name, phone }), "Couldn't add the number"))) return;
    setName("");
    setPhone("");
  };
  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-2 p-3">
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">Whose phone</span>
          <input className={ON_PANEL_FIELD} value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, like Boris" autoComplete="off" required />
        </label>
        <label className="flex-1">
          <span className="sr-only">Phone number</span>
          <input className={ON_PANEL_FIELD} value={phone} onChange={(event) => setPhone(formatPhoneAsTyped(event.target.value))} placeholder="(626) 555-0142" inputMode="tel" autoComplete="off" required />
        </label>
      </div>
      <ErrorLine error={error} />
      <Button type="submit" variant="onPanel" size="sm" disabled={name.trim() === "" || phone.trim() === ""}>
        Add number
      </Button>
    </form>
  );
}

// After a reset clears every home, numbers remember the address they were on.
function PutBackButton({ numbers }: { numbers: DemoNumber[] }) {
  const putBack = useMutation(api.demoNumbers.putBack);
  const { error, attempt } = useAttempt();
  const waiting = numbers.filter((number) => number.on && number.rememberedAddress && !number.home).length;
  if (waiting === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-b border-panel-raised p-3">
      <Button variant="onPanel" size="sm" onClick={() => void attempt(() => putBack({}), "Couldn't put the numbers back")}>
        <ArrowUUpLeft weight="bold" className="size-4" />
        Put {waiting === 1 ? "1 number" : `${waiting} numbers`} back on their houses
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}

// Real numbers already on houses, like a house made for one teammate, join the list in one click.
function AddUnlistedButton({ count }: { count: number }) {
  const addNumbersOnHouses = useMutation(api.demoNumbers.addNumbersOnHouses);
  const { error, attempt } = useAttempt();
  if (count === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-b border-panel-raised p-3">
      <Button variant="onPanelQuiet" size="sm" onClick={() => void attempt(() => addNumbersOnHouses({}), "Couldn't add those numbers")}>
        <Plus weight="bold" className="size-4" />
        Add the {count === 1 ? "real number" : `${count} real numbers`} already on houses
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}

// The team's real phones. A number on a house turns it into a real rider, so the voice agent rings
// that phone for it instead of the stand-in playing the call.
export function DemoNumbers() {
  const listed = useQuery(api.demoNumbers.list);
  const numbers = listed?.numbers;
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const onHouses = numbers?.filter((number) => number.home).length ?? 0;
  return (
    <div ref={ref} className="relative">
      <Button variant="onPanelQuiet" size="sm" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <Phone weight={onHouses > 0 ? "fill" : "bold"} className="size-4" />
        <span className="max-sm:hidden">Real phones</span>
        {numbers && numbers.length > 0 && (
          <span className="tabular-nums">
            {onHouses}/{numbers.length}
          </span>
        )}
      </Button>
      {open && numbers && (
        <div
          role="dialog"
          aria-label="Real phones"
          className="absolute top-full right-0 z-30 mt-2 flex max-h-[min(36rem,80vh)] w-96 flex-col overflow-y-auto bg-panel text-on-panel shadow-popover max-sm:fixed max-sm:inset-x-4 max-sm:w-auto"
        >
          <AddUnlistedButton count={listed?.unlistedOnHouses ?? 0} />
          <PutBackButton numbers={numbers} />
          {numbers.length > 0 ? (
            <ul>
              {numbers.map((number) => (
                <NumberRow key={number._id} number={number} />
              ))}
            </ul>
          ) : (
            <p className="type-small border-b border-panel-raised px-3 py-3 text-on-panel-muted">
              Add a phone, then put it on a house. The voice agent rings that phone for the house instead of playing the call.
            </p>
          )}
          <AddNumberForm />
        </div>
      )}
    </div>
  );
}
