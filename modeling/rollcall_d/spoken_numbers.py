"""Turn spoken house numbers into digits, in English and Spanish.

Handles the ways people say addresses on the phone:
  "twenty six oh nine"            -> 2609   (pairs)
  "eleven eighty two"             -> 1182
  "two six zero nine"             -> 2609   (digit by digit)
  "four hundred eighty six"       -> 486    (cardinal)
  "cuatrocientos ochenta y seis"  -> 486
  "dos mil seiscientos nueve"     -> 2609
"""

import re
import unicodedata

UNITS = {
    "zero": 0, "oh": 0, "o": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "cero": 0, "uno": 1, "un": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7,
    "ocho": 8, "nueve": 9, "diez": 10, "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15,
    "dieciseis": 16, "diecisiete": 17, "dieciocho": 18, "diecinueve": 19, "veintiuno": 21, "veintiun": 21,
    "veintidos": 22, "veintitres": 23, "veinticuatro": 24, "veinticinco": 25, "veintiseis": 26,
    "veintisiete": 27, "veintiocho": 28, "veintinueve": 29,
}
TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "veinte": 20, "treinta": 30, "cuarenta": 40, "cincuenta": 50, "sesenta": 60, "setenta": 70, "ochenta": 80, "noventa": 90,
}
HUNDREDS = {
    "cien": 100, "ciento": 100, "doscientos": 200, "trescientos": 300, "cuatrocientos": 400, "quinientos": 500,
    "seiscientos": 600, "setecientos": 700, "ochocientos": 800, "novecientos": 900,
    "doscientas": 200, "trescientas": 300, "cuatrocientas": 400, "quinientas": 500, "seiscientas": 600,
    "setecientas": 700, "ochocientas": 800, "novecientas": 900,
}
SCALES = {"hundred": 100, "thousand": 1000, "mil": 1000}
JOINERS = {"y", "and"}
NUMBER_WORDS = set(UNITS) | set(TENS) | set(HUNDREDS) | set(SCALES)


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def tokenize(text: str) -> list[str]:
    text = strip_accents(text.lower())
    text = re.sub(r"(\d)-(\d)", r"\1\2", text)  # "26-09" said as a hyphenated pair
    return re.findall(r"[a-z]+|\d+", text.replace("-", " "))


def _is_number_token(token: str) -> bool:
    return token.isdigit() or token in NUMBER_WORDS


def _cardinal(tokens: list[str]) -> int:
    total, current = 0, 0
    for token in tokens:
        if token in UNITS:
            current += UNITS[token]
        elif token in TENS:
            current += TENS[token]
        elif token in HUNDREDS:
            current += HUNDREDS[token]
        elif token == "hundred":
            current = max(current, 1) * 100
        elif token in ("thousand", "mil"):
            total += max(current, 1) * 1000
            current = 0
        elif token.isdigit():
            current += int(token)
    return total + current


def _chunks(tokens: list[str]) -> str:
    """Pairs and digits said in a row: each tens word absorbs a following unit (twenty six -> 26)."""
    out, i = [], 0
    while i < len(tokens):
        token = tokens[i]
        if token.isdigit():
            out.append(token)
        elif token in TENS:
            nxt = tokens[i + 1] if i + 1 < len(tokens) else None
            if nxt in UNITS and 0 < UNITS[nxt] < 10:
                out.append(str(TENS[token] + UNITS[nxt]))
                i += 1
            else:
                out.append(str(TENS[token]))
        elif token in UNITS:
            out.append(str(UNITS[token]))
        i += 1
    return "".join(out)


def run_to_digits(tokens: list[str]) -> str:
    tokens = [t for t in tokens if t not in JOINERS]
    if any(t in SCALES or t in HUNDREDS for t in tokens):
        return str(_cardinal(tokens))
    return _chunks(tokens)


def digits_in(text: str) -> list[tuple[str, list[str]]]:
    """Every spoken or written number in the text, each with the tokens that follow it."""
    tokens = tokenize(text)
    found = []
    i = 0
    while i < len(tokens):
        if not _is_number_token(tokens[i]) or tokens[i] in ("o", "un", "una", "y"):
            i += 1
            continue
        j = i
        while j < len(tokens) and (_is_number_token(tokens[j]) or (tokens[j] in JOINERS and j + 1 < len(tokens) and _is_number_token(tokens[j + 1]))):
            j += 1
        found.append((run_to_digits(tokens[i:j]), tokens[j:]))
        i = j
    return found
