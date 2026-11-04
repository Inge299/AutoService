const latin = "ABEKMHOPCTYX", cyrillic = "АВЕКМНОРСТУХ";
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "").replace(/[ABEKMHOPCTYX]/g, char => cyrillic[latin.indexOf(char)]!);
}
export function plateVariants(value: string): string[] {
  const normalized = normalizePlate(value);
  const variants = [value.trim(), normalized, normalized.replace(/[АВЕКМНОРСТУХ]/g, char => latin[cyrillic.indexOf(char)]!)];
  // Old records may mix both alphabets in one plate; a normal Russian plate
  // has three letters, so enumerating its look-alikes remains bounded.
  if (/^[АВЕКМНОРСТУХ0-9]{3,12}$/.test(normalized) && normalized.replace(/\d/g, "").length <= 4) {
    let mixed = [""];
    for (const char of normalized) {
      const index = cyrillic.indexOf(char);
      mixed = mixed.flatMap(prefix => index < 0 ? [prefix + char] : [prefix + char, prefix + latin[index]]);
    }
    variants.push(...mixed);
  }
  return [...new Set(variants)].filter(Boolean);
}
