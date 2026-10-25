// A US number on the 555 exchange is fictional: the seeded town and the sample rider list use them,
// and no carrier routes them, so overwriting one loses nothing.
export function isFictionalNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") && digits.slice(4, 7) === "555";
}


function groupedUsDigits(digits: string) {
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

// Formats a US number while it is typed: "6265550142" reads "(626) 555-0142". Punctuation appears
// only once the digit after it does, so backspace never sticks on a bracket or a dash. US area codes
// never start with 1, so a leading 1 is the country code. Any other "+" number is left as typed.
export function formatPhoneAsTyped(input: string) {
  const trimmed = input.trimStart();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) return input;
  const digits = input.replace(/\D/g, "");
  if (!digits.startsWith("1")) return groupedUsDigits(digits);
  const countryCode = trimmed.startsWith("+") ? "+1" : "1";
  const national = digits.slice(1);
  return national ? `${countryCode} ${groupedUsDigits(national)}` : countryCode;
}
