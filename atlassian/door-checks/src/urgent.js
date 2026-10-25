const TOP_COUNT = 5;

// The Rovo action: highest-ranked unreached homes whose address contains the street text.
export function urgentNear(queue, street) {
  const needle = street.trim().toLowerCase();
  if (!needle) return [];
  return queue.filter((item) => item.address.toLowerCase().includes(needle)).slice(0, TOP_COUNT);
}

export function urgentAnswer(queue, street) {
  const homes = urgentNear(queue, street);
  if (!homes.length) return `No unreached homes match "${street}" on the door-check list.`;
  return homes
    .map((h) => `#${h.rank} ${h.address} (need: ${h.needLevel}; language: ${h.language}; ${h.needSummary}). ${h.reason}`)
    .join("\n");
}
