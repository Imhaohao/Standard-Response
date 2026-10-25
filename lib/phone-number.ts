// A US number on the 555 exchange is fictional: the seeded town and the sample rider list use them,
// and no carrier routes them, so overwriting one loses nothing.
export function isFictionalNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") && digits.slice(4, 7) === "555";
}

