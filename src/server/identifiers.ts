import { randomInt } from "node:crypto";

export const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const BASE32_RADIX = BASE32_ALPHABET.length;
export const MAX_BASE32_SEQUENCE = BASE32_RADIX ** 4 - 1;

export function createPromptPrefix() {
  return Array.from({ length: 4 }, () => BASE32_ALPHABET[randomInt(BASE32_RADIX)]).join("");
}

export function normalizePromptPrefix(identifier: string | null | undefined) {
  if (!identifier || identifier.length < 4) return null;
  const legacyAliases: Record<string, string> = { I: "J", L: "M", O: "P", U: "V" };
  const prefix = identifier.slice(0, 4).toUpperCase().replace(/[ILOU]/g, (character) => legacyAliases[character]);
  return [...prefix].every((character) => BASE32_ALPHABET.includes(character)) ? prefix : null;
}

export function isPromptPrefix(value: string) {
  return value.length === 4 && [...value].every((character) => BASE32_ALPHABET.includes(character));
}

export function encodeBase32Sequence(sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > MAX_BASE32_SEQUENCE) {
    throw new RangeError("提示词图片序号超出 4 位 32 进制范围");
  }
  let value = sequence;
  let encoded = "";
  for (let digit = 0; digit < 4; digit += 1) {
    encoded = BASE32_ALPHABET[value % BASE32_RADIX] + encoded;
    value = Math.floor(value / BASE32_RADIX);
  }
  return encoded;
}

export function createMaterialIdentifier(promptPrefix: string, sequence: number) {
  if (!isPromptPrefix(promptPrefix)) throw new RangeError("提示词前缀格式无效");
  return `${promptPrefix}${encodeBase32Sequence(sequence)}`;
}
