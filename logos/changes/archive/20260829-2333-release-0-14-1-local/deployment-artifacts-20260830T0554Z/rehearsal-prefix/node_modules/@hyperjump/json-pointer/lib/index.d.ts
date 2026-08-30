export type Json = string | number | boolean | null | JsonObject | Json[];
export type JsonObject = {
  [property: string]: Json;
};

export const nil: "";

export const pointerSegments: (pointer: string) => Generator<string>;

export const append: (segment: string, pointer: string) => string;

export const get: {
  (pointer: string, subject: Json): Json | undefined;
  (pointer: string): Getter;
};
export type Getter = (subject: Json) => Json | undefined;

export const set: {
  (pointer: string, subject: Json, value: Json): Json;
  (pointer: string): Setter;
};
export type Setter = (subject: Json, value: Json) => Json;

export const assign: {
  (pointer: string, subject: Json, value: Json): void;
  (pointer: string): Assigner;
};
export type Assigner = (subject: Json, value: Json) => void;

export const unset: {
  (pointer: string, subject: Json): Json | undefined;
  (pointer: string): Unsetter;
};
export type Unsetter = (subject: Json) => Json | undefined;

export const remove: {
  (pointer: string, subject: Json): void;
  (pointer: string): Remover;
};
export type Remover = (subject: Json) => void;
