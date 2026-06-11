/**
 * Suggest-mode PII classifier (YW-129).
 *
 * Produces human-readable reasons why a column is *suspected* sensitive.
 * Suggest-mode contract: this module never writes `Field.sensitivity` — it
 * only proposes; a user confirmation is what marks a field. It graduates to
 * default writer only after clearing a measured false-positive budget.
 *
 * Two signal layers:
 * - Name heuristics — pure string matching on the field's display name,
 *   usable at import time before any data analysis has run.
 * - Analysis heuristics — seeded by `ColumnAnalysis.semantic` (email) plus
 *   sample-value phone detection and free-text length, available once
 *   column analysis has run.
 */

import type { ColumnAnalysis } from "./column-analysis";

/** A name pattern and the legible reason it produces when it matches. */
type NameRule = {
  pattern: RegExp;
  /** Names matching this are exempt from the rule (false-positive guards) */
  exclude?: RegExp;
  reason: string;
};

const NAME_RULES: NameRule[] = [
  // Person names
  {
    pattern:
      /^name$|first[ _-]?name|last[ _-]?name|full[ _-]?name|sur[ _-]?name|given[ _-]?name|middle[ _-]?name|maiden|nick[ _-]?name/i,
    reason: "Column name suggests personal names",
  },
  // Contact details
  {
    pattern: /e[ _-]?mail/i,
    reason: "Column name suggests email addresses",
  },
  {
    pattern: /phone|mobile|telephone|\bfax\b|\bcell\b/i,
    reason: "Column name suggests phone numbers",
  },
  {
    pattern: /address|street|zip[ _-]?code|postal|postcode/i,
    // "email_address", "ip_address", etc. are covered by their own rules
    exclude: /(e[ _-]?mail|ip|mac|web|url)[ _-]?address/i,
    reason: "Column name suggests physical addresses",
  },
  {
    pattern: /ip[ _-]?address/i,
    reason: "Column name suggests IP addresses",
  },
  // Government / financial identifiers
  {
    pattern:
      /\bssn\b|social[ _-]?security|passport|driver[ _-]?s?[ _-]?licen[sc]e|national[ _-]?id|tax[ _-]?id/i,
    reason: "Column name suggests government identifiers",
  },
  {
    pattern:
      /salary|income|iban|credit[ _-]?card|card[ _-]?num|account[ _-]?num|routing[ _-]?num/i,
    reason: "Column name suggests financial details",
  },
  // Credentials
  {
    pattern:
      /password|passwd|secret(?!ar)|api[ _-]?key|private[ _-]?key|auth[ _-]?token|access[ _-]?token/i,
    reason: "Column name suggests credentials or secrets",
  },
  // Personal attributes
  {
    pattern: /birth|\bdob\b/i,
    reason: "Column name suggests dates of birth",
  },
  {
    pattern: /gender|\bsex\b|ethnicity|religion|nationality/i,
    reason: "Column name suggests demographic attributes",
  },
  {
    pattern: /diagnosis|medical|health[ _-]?record/i,
    reason: "Column name suggests health information",
  },
];

// Sample-value phone detection: digits with common separators, 7+ digits.
const PHONE_PATTERN = /^\+?[\d\s().-]{7,20}$/;
const MIN_PHONE_DIGITS = 7;
// Date-shaped strings (2023-01-15, 15.01.2023) would otherwise pass the
// phone pattern and flag every string-typed date column on import.
const DATE_SHAPE_PATTERN =
  /^(\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{4})$/;
// Compact YYYYMMDD dates (20230115) also pass the phone pattern; only treat
// 8-digit strings as dates when month/day positions are plausible.
const COMPACT_DATE_PATTERN = /^\d{8}$/;

function looksLikeCompactDate(value: string): boolean {
  if (!COMPACT_DATE_PATTERN.test(value)) return false;
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}
/** Fraction of samples that must match a value pattern to count as a signal. */
const SAMPLE_MATCH_THRESHOLD = 0.8;
/** Average string length above which free-text is flagged as a PII risk. */
const FREE_TEXT_MIN_AVG_LENGTH = 20;

function looksLikePhone(value: string): boolean {
  if (!PHONE_PATTERN.test(value)) return false;
  if (DATE_SHAPE_PATTERN.test(value)) return false;
  if (looksLikeCompactDate(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS;
}

/**
 * Name-only sensitivity signals. Pure and data-free, so it can run at import
 * time, before any column analysis exists.
 */
export function suggestSensitivityFromName(name: string): string[] {
  return NAME_RULES.filter(
    (rule) => rule.pattern.test(name) && !rule.exclude?.test(name),
  ).map((rule) => rule.reason);
}

/**
 * Data-driven sensitivity signals from a column analysis.
 */
export function suggestSensitivityFromAnalysis(
  analysis: ColumnAnalysis,
): string[] {
  const reasons: string[] = [];

  if (analysis.dataType === "string") {
    if (analysis.semantic === "email") {
      reasons.push("Values look like email addresses");
    }

    const samples = analysis.sampleValues
      .map((v) => String(v))
      .filter((v) => v.length > 0);
    if (samples.length > 0) {
      const phoneCount = samples.filter(looksLikePhone).length;
      if (phoneCount >= samples.length * SAMPLE_MATCH_THRESHOLD) {
        reasons.push("Values look like phone numbers");
      }
    }

    if (
      analysis.semantic === "text" &&
      (analysis.avgLength ?? 0) >= FREE_TEXT_MIN_AVG_LENGTH
    ) {
      reasons.push("Free-text values may contain personal information");
    }
  }

  return reasons;
}

/**
 * Combined suggest-mode classification for one column.
 *
 * @param input.name - The field's display name (not a UUID column alias)
 * @param input.analysis - Optional column analysis for data-driven signals
 * @returns Legible reasons the column is suspected sensitive; empty = no
 *   suggestion. Never mutates or implies `Field.sensitivity`.
 */
export function suggestSensitivityReasons(input: {
  name: string;
  analysis?: ColumnAnalysis;
}): string[] {
  const reasons = suggestSensitivityFromName(input.name);
  if (input.analysis) {
    for (const reason of suggestSensitivityFromAnalysis(input.analysis)) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }
  }
  return reasons;
}
