import type { Json } from "@hyperjump/json-pointer";
import type { JsonSchemaType } from "../lib/common.js";


export type OasSchema30 = {
  $ref: string;
} | {
  title?: string;
  description?: string;
  default?: Json;
  multipleOf?: number;
  maximum?: number;
  exclusiveMaximum?: boolean;
  minimum?: number;
  exclusiveMinimum?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  items?: OasSchema30;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  maxProperties?: number;
  minProperties?: number;
  required?: string[];
  additionalProperties?: boolean | OasSchema30;
  properties?: Record<string, OasSchema30>;
  enum?: Json[];
  type?: JsonSchemaType;
  nullable?: boolean;
  format?: "date-time" | "email" | "hostname" | "ipv4" | "ipv6" | "uri" | "int32" | "int64" | "float" | "double" | "byte" | "binary" | "date" | "password";
  allOf?: OasSchema30[];
  anyOf?: OasSchema30[];
  oneOf?: OasSchema30[];
  not?: OasSchema30;
  example?: Json;
  discriminator?: Discriminator;
  externalDocs?: ExternalDocs;
  xml?: Xml;
};

export type Discriminator = {
  propertyName: string;
  mappings?: Record<string, string>;
};

export type ExternalDocs = {
  url: string;
  description?: string;
};

export type Xml = {
  name?: string;
  namespace?: string;
  prefix?: string;
  attribute?: boolean;
  wrapped?: boolean;
};

export type OpenApi30 = {
  openapi: string;
  info: Info;
  externalDocs?: ExternalDocs;
  servers?: Server[];
  security?: SecurityRequirement[];
  tags?: Tag[];
  paths: Paths;
  components?: Components;
};

export type Reference = {
  $ref: "string";
};

export type Info = {
  title: string;
  description?: string;
  termsOfService?: string;
  contact?: Contact;
  license?: License;
  version: string;
};

export type Contact = {
  name?: string;
  url?: string;
  email?: string;
};

export type License = {
  name: string;
  url?: string;
};

export type Server = {
  url: string;
  description?: string;
  variables?: Record<string, ServerVariable>;
};

export type ServerVariable = {
  enum?: string[];
  default: string;
  description?: string;
};

export type Components = {
  schemas?: Record<string, OasSchema30>;
  responses?: Record<string, Response | Reference>;
  parameters?: Record<string, Parameter | Reference>;
  examples?: Record<string, Example | Reference>;
  requestBodies?: Record<string, RequestBody | Reference>;
  headers?: Record<string, Header | Reference>;
  securitySchemes: Record<string, SecurityScheme | Reference>;
  links: Record<string, Link | Reference>;
  callbacks: Record<string, Callback | Reference>;
};

export type Response = {
  description: string;
  headers?: Record<string, Header | Reference>;
  content?: Record<string, MediaType>;
  links?: Record<string, Link | Reference>;
};

export type MediaType = {
  schema?: OasSchema30;
  example?: unknown;
  examples?: Record<string, Example | Reference>;
  encoding?: Record<string, Encoding>;
};

export type Example = {
  summary?: string;
  description?: string;
  value?: unknown;
  externalValue?: string;
};

export type Header = {
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  style?: "simple";
  explode?: boolean;
  allowReserved?: boolean;
  schema?: OasSchema30;
  content?: Record<string, MediaType>;
  example?: unknown;
  examples: Record<string, Example | Reference>;
};

export type Paths = Record<string, PathItem>;

export type PathItem = {
  $ref?: string;
  summary?: string;
  description?: string;
  servers: Server[];
  parameters: (Parameter | Reference)[];
  get?: Operation;
  put?: Operation;
  post?: Operation;
  delete?: Operation;
  options?: Operation;
  head?: Operation;
  patch?: Operation;
  trace?: Operation;
};

export type Operation = {
  tags?: string[];
  summary?: string;
  description?: string;
  externalDocs?: ExternalDocs;
  operationId?: string;
  parameters?: (Parameter | Reference)[];
  requestBody?: RequestBody | Reference;
  responses: Responses;
  callbacks?: Record<string, Callback | Reference>;
  deprecated?: boolean;
  security?: SecurityRequirement[];
  servers?: Server[];
};

export type Responses = Record<string, Response | Reference>;

export type SecurityRequirement = Record<string, string[]>;

export type Tag = {
  name: string;
  description?: string;
  externalDocs?: ExternalDocs;
};

export type Parameter = {
  name: string;
  in: string;
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
  schema?: OasSchema30;
  content?: Record<string, MediaType>;
  example?: unknown;
  examples?: Record<string, Example | Reference>;
};

export type RequestBody = {
  description?: string;
  content: Record<string, MediaType>;
  required?: boolean;
};

export type SecurityScheme = APIKeySecurityScheme | HTTPSecurityScheme | OAuth2SecurityScheme | OpenIdConnectSecurityScheme;

export type APIKeySecurityScheme = {
  type: "apiKey";
  name: string;
  in: "header" | "query" | "cookie";
  description?: string;
};

export type HTTPSecurityScheme = {
  scheme: string;
  bearerFormat?: string;
  description?: string;
  type: "http";
};

export type OAuth2SecurityScheme = {
  type: "oauth2";
  flows: OAuthFlows;
  description?: string;
};

export type OpenIdConnectSecurityScheme = {
  type: "openIdConnect";
  openIdConnectUrl: string;
  description?: string;
};

export type OAuthFlows = {
  implicit?: ImplicitOAuthFlow;
  password?: PasswordOAuthFlow;
  clientCredentials?: ClientCredentialsFlow;
  authorizationCode?: AuthorizationCodeOAuthFlow;
};

export type ImplicitOAuthFlow = {
  authorizationUrl: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
};

export type PasswordOAuthFlow = {
  tokenUrl: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
};

export type ClientCredentialsFlow = {
  tokenUrl: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
};

export type AuthorizationCodeOAuthFlow = {
  authorizationUrl: string;
  tokenUrl: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
};

export type Link = {
  operationId?: string;
  operationRef?: string;
  parameters?: Record<string, unknown>;
  requestBody?: unknown;
  description?: string;
  server?: Server;
};

export type Callback = Record<string, PathItem>;

export type Encoding = {
  contentType?: string;
  headers?: Record<string, Header | Reference>;
  style?: "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";
  explode?: boolean;
  allowReserved?: boolean;
};

export * from "../lib/index.js";
