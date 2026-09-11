import { CURRENCIES, type Currency, type Obligation, type ObligationCategory } from "@idle/core";

const CATEGORIES: readonly ObligationCategory[] = ["payroll", "supplier", "tax", "rent"] as const;

/**
 * Raised when a request body cannot become the thing it claims to be.
 *
 * Carries a message aimed at whoever typed it, not at a log file: these come
 * from a form a finance person is filling in.
 */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new BadRequestError(`${key} is required`);
  }
  return v.trim();
}

/** Same discipline as the agent's parser: a decimal integer string, or nothing. */
function minorUnits(v: unknown, key: string): bigint {
  if (typeof v === "number") {
    // A JSON number has already been through a double. For money that is a
    // lossy channel, so it is refused at the door rather than rounded here.
    throw new BadRequestError(`${key} must be a string of digits, not a number`);
  }
  if (typeof v !== "string" || !/^\d+$/.test(v)) {
    throw new BadRequestError(`${key} must be a whole number of minor units, as a string`);
  }
  const parsed = BigInt(v);
  if (parsed <= 0n) throw new BadRequestError(`${key} must be greater than zero`);
  return parsed;
}

function isCalendarDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  // Date.parse accepts 2026-02-31 and rolls it over, so round-trip it back.
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function parseBusinessName(body: unknown): string {
  if (typeof body !== "object" || body === null) throw new BadRequestError("a JSON body is required");
  const name = str(body as Record<string, unknown>, "name");
  if (name.length > 80) throw new BadRequestError("name must be 80 characters or fewer");
  return name;
}

export function parseObligation(raw: unknown, index: number): Obligation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BadRequestError(`obligation ${index} is not an object`);
  }
  const o = raw as Record<string, unknown>;

  const currency = str(o, "currency").toUpperCase();
  if (!CURRENCIES.includes(currency as Currency)) {
    throw new BadRequestError(`obligation ${index}: currency must be one of ${CURRENCIES.join(", ")}`);
  }

  const category = str(o, "category").toLowerCase();
  if (!CATEGORIES.includes(category as ObligationCategory)) {
    throw new BadRequestError(`obligation ${index}: category must be one of ${CATEGORIES.join(", ")}`);
  }

  const dueDate = str(o, "dueDate");
  if (!isCalendarDate(dueDate)) {
    throw new BadRequestError(`obligation ${index}: dueDate must be a real date as YYYY-MM-DD`);
  }

  const confidence = o.confidence === undefined ? 1 : o.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new BadRequestError(`obligation ${index}: confidence must be between 0 and 1`);
  }

  return {
    id: typeof o.id === "string" && o.id.trim().length > 0 ? o.id.trim() : `ob_${index}_${Date.now().toString(36)}`,
    currency: currency as Currency,
    amountMinor: minorUnits(o.amountMinor, `obligation ${index}: amountMinor`),
    dueDate,
    category: category as ObligationCategory,
    confidence,
  };
}

export function parseObligations(body: unknown): Obligation[] {
  if (typeof body !== "object" || body === null) throw new BadRequestError("a JSON body is required");
  const list = (body as Record<string, unknown>).obligations;
  if (!Array.isArray(list)) throw new BadRequestError("obligations must be an array");
  if (list.length > 100) throw new BadRequestError("no more than 100 obligations at a time");

  const parsed = list.map(parseObligation);
  const ids = new Set(parsed.map((o) => o.id));
  if (ids.size !== parsed.length) throw new BadRequestError("two obligations share an id");
  return parsed;
}

export function parseFundAmount(body: unknown): bigint {
  if (typeof body !== "object" || body === null) throw new BadRequestError("a JSON body is required");
  return minorUnits((body as Record<string, unknown>).amountUsdc, "amountUsdc");
}
