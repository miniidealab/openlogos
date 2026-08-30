export const isUri: (uri: string) => boolean;
export const isUriReference: (uriReference: string) => boolean;
export const isAbsoluteUri: (uri: string) => boolean;

export const isIri: (iri: string) => boolean;
export const isIriReference: (iriReference: string) => boolean;
export const isAbsoluteIri: (iri: string) => boolean;

export const parseUri: (uri: string) => IdentifierComponents;
export const parseUriReference: (uriReference: string) => RelativeIdentifierComponents;
export const parseAbsoluteUri: (uri: string) => AbsoluteIdentifierComponents;

export const parseIri: (iri: string) => IdentifierComponents;
export const parseIriReference: (iriReference: string) => RelativeIdentifierComponents;
export const parseAbsoluteIri: (iri: string) => AbsoluteIdentifierComponents;

export const toAbsoluteUri: (uri: string) => string;
export const toAbsoluteIri: (iri: string) => string;

export const normalizeUri: (uri: string) => string;
export const normalizeIri: (iri: string) => string;

export const resolveUri: (reference: string, base: string) => string;
export const resolveIri: (reference: string, base: string) => string;

export const toRelativeUri: (uri: string, relativeTo: string) => string;
export const toRelativeIri: (iri: string, relativeTo: string) => string;

type IdentifierComponents = {
  scheme: string;
  authority: string;
  userinfo?: string;
  host: string;
  port?: string;
  path: string;
  query?: string;
  fragment?: string;
};

type RelativeIdentifierComponents = {
  scheme?: string;
  authority?: string;
  userinfo?: string;
  host?: string;
  port?: string;
  path: string;
  query?: string;
  fragment?: string;
};

type AbsoluteIdentifierComponents = {
  scheme: string;
  authority: string;
  userinfo?: string;
  host: string;
  port?: string;
  path: string;
  query?: string;
};
