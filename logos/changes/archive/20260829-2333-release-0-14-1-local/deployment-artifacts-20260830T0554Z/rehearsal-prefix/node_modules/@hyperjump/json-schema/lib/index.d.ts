import type { Json } from "@hyperjump/json-pointer";
import type { EvaluationPlugin } from "./experimental.js";


export type SchemaFragment = string | number | boolean | null | SchemaObject | SchemaFragment[];
export type SchemaObject = {
  [keyword: string]: SchemaFragment;
};

export const registerSchema: (schema: SchemaObject | boolean, retrievalUri?: string, contextDialectId?: string) => void;
export const unregisterSchema: (retrievalUri: string) => void;
export const hasSchema: (uri: string) => boolean;
export const getAllRegisteredSchemaUris: () => string[];

/**
 * @deprecated since 1.7.0. Use registerSchema instead.
 */
export const addSchema: typeof registerSchema;

export type ValidationOptions = {
  outputFormat?: OutputFormat;
  plugins?: EvaluationPlugin[];
};

export const validate: (
  (url: string, value: Json, options?: OutputFormat | ValidationOptions) => Promise<Output>
) & (
  (url: string) => Promise<Validator>
);

export const restoreValidator: (json: string) => Validator;

export type Validator = {
  (value: Json, options?: OutputFormat | ValidationOptions): Output;
  serialize(): string;
};

export type Output = {
  valid: true;
} | {
  valid: false;
  errors?: OutputUnit[];
};

export type OutputUnit = {
  keyword: string;
  absoluteKeywordLocation: string;
  instanceLocation: string;
  valid: boolean;
  annotation?: unknown;
  errors?: OutputUnit[];
};

export const FLAG: "FLAG";

export type OutputFormat = "FLAG" | "BASIC" | "DETAILED";

export const setMetaSchemaOutputFormat: (format: OutputFormat) => void;
export const getMetaSchemaOutputFormat: () => OutputFormat;
export const setShouldValidateSchema: (isEnabled: boolean) => void;
export const getShouldValidateSchema: () => boolean;
export const setShouldValidateFormat: (isEnabled: boolean | undefined) => void;
export const getShouldValidateFormat: () => boolean | undefined;

export class InvalidSchemaError extends Error {
  public output: Output & { valid: false };

  public constructor(output: Output);
}
