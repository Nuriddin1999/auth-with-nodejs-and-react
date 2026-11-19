/**
 * Request body validation with the same rules and error format as the DRF serializers:
 * 400 {"field": ["message", ...]} - the frontend shows the first message.
 *
 *   const data = validate(req.body, { email: email({ maxLength: 254 }), code: regex(/.../) });
 *
 * Throws ValidationError; unknown fields are ignored.
 */

export type FieldErrors = Record<string, string[]>;

export class ValidationError extends Error {
  errors: FieldErrors;

  constructor(errors: FieldErrors) {
    super('Invalid input');
    this.errors = errors;
  }
}

type ParseResult<T> = { value: T; errors?: undefined } | { value?: undefined; errors: string[] };

export interface Field<T> {
  required: boolean;
  parse(value: unknown): ParseResult<T>;
}

type Validator = (value: string) => string | null;

interface CharOptions {
  maxLength?: number;
  trim?: boolean;
  allowBlank?: boolean;
  required?: boolean;
  validators?: Validator[];
}

/** DRF CharField. Like DRF, every failing validator adds its message. */
export function char({ maxLength, trim = true, allowBlank = false, required = true, validators = [] }: CharOptions = {}): Field<string> {
  return {
    required,
    parse(value) {
      if (value === '' || (trim && typeof value === 'string' && value.trim() === '')) {
        return allowBlank ? { value: '' } : { errors: ['This field may not be blank.'] };
      }
      if (typeof value !== 'string' && typeof value !== 'number') return { errors: ['Not a valid string.'] };
      const str = trim ? String(value).trim() : String(value);
      const errors: string[] = [];
      if (maxLength !== undefined && Array.from(str).length > maxLength) {
        errors.push(`Ensure this field has no more than ${maxLength} characters.`);
      }
      for (const validator of validators) {
        const message = validator(str);
        if (message) errors.push(message);
      }
      return errors.length ? { errors } : { value: str };
    },
  };
}

// Django's EmailValidator
const UL = '¡-￿';
const USER_RE =
  /^(?:[-!#$%&'*+/=?^_`{}|~0-9A-Z]+(?:\.[-!#$%&'*+/=?^_`{}|~0-9A-Z]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f!#-[\]-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")$/i;
const DOMAIN_RE = new RegExp(
  `^[a-z${UL}0-9](?:[a-z${UL}0-9-]{0,61}[a-z${UL}0-9])?` + // hostname
    `(?:\\.(?!-)[a-z${UL}0-9-]{1,63}(?<!-))*` + // domain
    `\\.(?!-)(?:[a-z${UL}-]{2,63}|xn--[a-z0-9]{1,59})(?<!-)$`, // top-level domain
  'i',
);
const LITERAL_RE = /^\[([A-F0-9:.]+)\]$/i;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isValidEmail(value: string): boolean {
  if (!value || !value.includes('@') || value.length > 320) return false;
  const at = value.lastIndexOf('@');
  const user = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!USER_RE.test(user)) return false;
  if (domain === 'localhost' || DOMAIN_RE.test(domain)) return true;
  const literal = LITERAL_RE.exec(domain);
  return Boolean(literal && (IPV4_RE.test(literal[1]) || literal[1].includes(':')));
}

/** DRF EmailField. */
export function email({ maxLength }: { maxLength?: number } = {}): Field<string> {
  return char({ maxLength, validators: [(v) => (isValidEmail(v) ? null : 'Enter a valid email address.')] });
}

/** DRF RegexField (whitespace is trimmed first). */
export function regex(pattern: RegExp, { message = 'This value does not match the required pattern.', maxLength }: { message?: string; maxLength?: number } = {}): Field<string> {
  return char({ maxLength, validators: [(v) => (pattern.test(v) ? null : message)] });
}

/**
 * DRF IntegerField. Values outside the safe-integer range come back as their exact
 * decimal string (Telegram ids are hashed as text).
 */
export function integer(): Field<number | string> {
  return {
    required: true,
    parse(value) {
      const invalid = { errors: ['A valid integer is required.'] };
      let text: string;
      if (typeof value === 'number') {
        if (!Number.isInteger(value)) return invalid;
        text = BigInt(value).toString();
      } else if (typeof value === 'string') {
        if (value.length > 1000) return { errors: ['String value too large.'] };
        text = value.replace(/\.0*\s*$/, '').trim();
        if (!/^[+-]?\d+$/.test(text)) return invalid;
      } else {
        return invalid;
      }
      const exact = BigInt(text);
      return { value: Number.isSafeInteger(Number(exact)) ? Number(exact) : exact.toString() };
    },
  };
}

/** DRF ChoiceField. */
export function choice<T extends string>(choices: readonly T[]): Field<T> {
  return {
    required: true,
    parse(value) {
      const str = typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
      return (choices as readonly string[]).includes(str) ? { value: str as T } : { errors: [`"${str}" is not a valid choice.`] };
    },
  };
}

export function optional<T>(field: Field<T>): Field<T> {
  return { ...field, required: false };
}

type Schema = Record<string, Field<unknown>>;
type Output<S extends Schema> = {
  [K in keyof S]: S[K] extends Field<infer T> ? T : never;
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Validate `body` against `schema`; `check(data)` may return cross-field errors.
 * It runs only when every field is valid, like Serializer.validate().
 * Optional fields that were not sent are missing from the result.
 */
export function validate<S extends Schema>(body: unknown, schema: S, check?: (data: Output<S>) => FieldErrors | null): Output<S> {
  if (!isPlainObject(body)) {
    const type = Array.isArray(body) ? 'list' : body === null ? 'NoneType' : typeof body;
    throw new ValidationError({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${type}.`] });
  }
  const data: Record<string, unknown> = {};
  const errors: FieldErrors = {};
  for (const [name, field] of Object.entries(schema)) {
    if (!Object.hasOwn(body, name)) {
      if (field.required) errors[name] = ['This field is required.'];
      continue;
    }
    if (body[name] === null) {
      errors[name] = ['This field may not be null.'];
      continue;
    }
    const result = field.parse(body[name]);
    if (result.errors) errors[name] = result.errors;
    else data[name] = result.value;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const output = data as Output<S>;
  const extra = check?.(output);
  if (extra) throw new ValidationError(extra);
  return output;
}
