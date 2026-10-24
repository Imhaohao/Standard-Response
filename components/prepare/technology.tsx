import { ReactNode } from "react";
import { ROUND_MASS } from "@/lib/mesh/rounds";
import { MAX_BEHIND } from "@/lib/prepare/county";
import { UPLOAD_MIN_MASS } from "@/lib/prepare/mixing";
import { TALLY_EPSILON, TRUTH_PROBABILITY } from "@/lib/prepare/tally";
import { COHORT, SURVEY_TRAINING } from "@/lib/prepare/tasks";
import { Entry, EntryHowItWorks, EntryTags } from "../mesh/technology";

// The techniques behind the readiness survey's screens, named the same way everywhere they appear,
// in the mesh add-on's style: a tag on every panel that uses one, and a "How it works" note.

export type SurveyTechnology = "randomized" | "federated" | "mixing";

export const SURVEY_TECHNOLOGIES: Record<SurveyTechnology, Entry> = {
  randomized: {
    name: "Randomized response",
    summary:
      "Before an answer is counted, the phone flips a weighted coin: it tells the truth most of the time and the opposite otherwise. Nobody, the county included, can tell whether any one household's answer is true, but across a few hundred households the county can still work out the share.",
    equation: `P(report truth) = p = ${TRUTH_PROBABILITY}\nshare = (said yes / answered − (1 − p)) / (2p − 1)`,
    points: [
      `Each counted answer has ε = ln(p / (1 − p)) = ${TALLY_EPSILON.toFixed(2)} local differential privacy: the answer it sends is at most ${Math.round(TRUTH_PROBABILITY / (1 - TRUTH_PROBABILITY))} times likelier under one truth than the other.`,
      "The coin is flipped once per answer and kept, so asking the same household again learns nothing new.",
      "Counts are kept per census block group, a few hundred households, and each estimate comes with a 95% interval that includes the coin's noise.",
    ],
  },
  federated: {
    name: "Federated learning",
    summary:
      "Households train shared models without anyone sending their answers: whether a home's tap water will fail a test, and whether a household can afford to leave. Each phone sends only a clipped, noised change to the model.",
    points: [
      `The county asks a random share of households to train each version, about ${COHORT} of them (client sampling). A phone that's picked takes one gradient step on its own answers, clips the change to length ${SURVEY_TRAINING.clip} and adds Gaussian noise (σ = ${SURVEY_TRAINING.noiseMultiplier} × the clip) before it leaves.`,
      `A household trains at most ${SURVEY_TRAINING.maxContributions} versions of each model, which bounds what it can give away.`,
      `Every ${ROUND_MASS} households' worth of changes make the next version (DP-FedAvg). Changes trained on an older version count less, 1 / (1 + versions behind), and not at all past ${MAX_BEHIND}.`,
      "The models are public: every phone downloads them and shows its own household's risk without sending anything.",
    ],
  },
  mixing: {
    name: "Phone-to-phone mixing",
    summary:
      "What a phone sends is first mixed with what nearby phones send, over Bluetooth or Wi-Fi as phones pass each other. Mixes flow toward volunteer gateways, and the county only ever receives sums over several households.",
    equation: "meeting: (s, m) → keep (s/2, m/2), pass (s/2, m/2)",
    points: [
      "Each phone holds a running sum and a mass (how many households' worth it holds). When two phones meet, the one farther from a gateway passes half of everything to the other (push-sum gossip), so nothing is lost or counted twice.",
      "Phones learn how many meetings away the nearest gateway is from each other's hellos, and mass flows downhill toward it.",
      `A gateway uploads only once it holds ${UPLOAD_MIN_MASS} or more households' worth, and the county refuses anything smaller, so no upload is ever one household.`,
      "Messages carry no answer, area or phone id. The session id in a hello is new for every meeting. In the simulation (docs/prepare.md) nearly everything households sent reached the county within three months.",
    ],
  },
};

export function SurveyTags({ uses, className }: { uses: SurveyTechnology[]; className?: string }) {
  return <EntryTags entries={uses.map((tech) => SURVEY_TECHNOLOGIES[tech])} className={className} />;
}

export function SurveyHowItWorks({ tech, inset, children }: { tech: SurveyTechnology; inset?: string; children?: ReactNode }) {
  return (
    <EntryHowItWorks entry={SURVEY_TECHNOLOGIES[tech]} inset={inset}>
      {children}
    </EntryHowItWorks>
  );
}
