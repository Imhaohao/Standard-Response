export const INDEX_NAME = "standard-response-search";
export const SEARCH_SIZE = 20;
export const HIGHLIGHT_OPEN = "[[";
export const HIGHLIGHT_CLOSE = "]]";

export type LineSource = {
  lineId: string;
  householdId: string;
  callId: string;
  address: string;
  language: string;
  speaker: "agent" | "resident";
  text: string;
  at: number;
};

export type HouseholdSource = {
  householdId: string;
  address: string;
  language: string;
  summary: string;
};

export type IndexedDocument = { id: string; body: Record<string, unknown> };

export type SearchResult = {
  householdId: string;
  address: string;
  snippet: string;
  callId?: string;
  at?: number;
};

export type HouseholdForIndex = {
  _id: string;
  address: string;
  language: string;
  canLeave?: string;
  peopleCount?: number;
  mobility?: string;
  assistanceRequired?: string;
  medical?: string[];
  pets?: boolean;
};

const PHONE_NUMBER = /\+?\(?\d[\d\s().-]{5,}\d/g;

// Residents sometimes read their number aloud on a call. Phone numbers never go into the search index.
export function redactPhoneNumbers(text: string) {
  return text.replace(PHONE_NUMBER, "[number removed]");
}

const analyzedText = {
  type: "text",
  analyzer: "standard",
  fields: {
    es: { type: "text", analyzer: "spanish" },
    cjk: { type: "text", analyzer: "cjk" },
  },
} as const;

export const INDEX_MAPPINGS = {
  properties: {
    kind: { type: "keyword" },
    householdId: { type: "keyword" },
    callId: { type: "keyword" },
    speaker: { type: "keyword" },
    language: { type: "keyword" },
    at: { type: "long" },
    address: { type: "text", analyzer: "standard" },
    text: analyzedText,
    summary: analyzedText,
  },
} as const;

export function lineDocument(line: LineSource): IndexedDocument {
  return {
    id: `line:${line.lineId}`,
    body: {
      kind: "line",
      householdId: line.householdId,
      callId: line.callId,
      speaker: line.speaker,
      language: line.language,
      at: line.at,
      address: line.address,
      text: redactPhoneNumbers(line.text),
    },
  };
}

export function householdDocument(household: HouseholdSource): IndexedDocument {
  return {
    id: `household:${household.householdId}`,
    body: {
      kind: "household",
      householdId: household.householdId,
      language: household.language,
      address: household.address,
      summary: household.summary,
    },
  };
}

function withValue<T>(label: string, value: T | undefined, show: (value: T) => string) {
  return value === undefined ? [] : [`${label} ${show(value)}`];
}

const readable = (value: string) => value.replace(/_/g, " ");

// What the dispatcher already sees on the call floor about a home: needs, never contact details.
export function householdSummary(home: HouseholdForIndex) {
  return [
    ...withValue("mobility", home.mobility, readable),
    ...withValue("help needed", home.assistanceRequired, readable),
    ...withValue("medical", home.medical, (needs) => needs.map(readable).join(" ")),
    ...withValue("can leave", home.canLeave, readable),
    ...withValue("people", home.peopleCount, String),
    ...(home.pets ? ["has pets"] : []),
  ].join(", ");
}

export function householdSource(home: HouseholdForIndex): HouseholdSource {
  return { householdId: home._id, address: home.address, language: home.language, summary: householdSummary(home) };
}

const SEARCH_FIELDS = ["text^3", "text.es^2", "text.cjk^2", "summary^2", "summary.es", "address"];
const HIGHLIGHT_FIELDS = ["text", "text.es", "text.cjk", "summary", "summary.es", "address"];

export function searchBody(q: string, language?: string) {
  const match = {
    multi_match: { query: q, fields: SEARCH_FIELDS, type: "best_fields", fuzziness: "AUTO", operator: "or" },
  };
  return {
    size: SEARCH_SIZE,
    query: language ? { bool: { must: [match], filter: [{ term: { language } }] } } : match,
    collapse: { field: "householdId" },
    highlight: {
      pre_tags: [HIGHLIGHT_OPEN],
      post_tags: [HIGHLIGHT_CLOSE],
      number_of_fragments: 1,
      fragment_size: 140,
      require_field_match: false,
      fields: Object.fromEntries(HIGHLIGHT_FIELDS.map((field) => [field, {}])),
    },
  };
}

export type SearchHit = {
  _source?: Record<string, unknown>;
  highlight?: Record<string, string[]>;
};

function firstHighlight(hit: SearchHit) {
  const fragments = Object.values(hit.highlight ?? {});
  return fragments[0]?.[0];
}

function plainSnippet(source: Record<string, unknown>) {
  const text = source.text ?? source.summary ?? source.address;
  return typeof text === "string" ? text.slice(0, 140) : "";
}

export function shapeHit(hit: SearchHit): SearchResult | null {
  const source = hit._source;
  if (!source || typeof source.householdId !== "string") return null;
  return {
    householdId: source.householdId,
    address: typeof source.address === "string" ? source.address : "",
    snippet: firstHighlight(hit) ?? plainSnippet(source),
    ...(typeof source.callId === "string" ? { callId: source.callId } : {}),
    ...(typeof source.at === "number" ? { at: source.at } : {}),
  };
}

export function shapeHits(hits: SearchHit[]): SearchResult[] {
  return hits.flatMap((hit) => {
    const result = shapeHit(hit);
    return result ? [result] : [];
  });
}
