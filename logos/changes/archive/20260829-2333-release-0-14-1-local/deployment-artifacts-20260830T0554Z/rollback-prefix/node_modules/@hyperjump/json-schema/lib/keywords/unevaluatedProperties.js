import { Validation } from "../experimental.js";
import * as Instance from "../instance.js";


const id = "https://json-schema.org/keyword/unevaluatedProperties";

const compile = (schema, ast) => Validation.compile(schema, ast);

const interpret = (unevaluatedProperties, instance, context) => {
  if (Instance.typeOf(instance) !== "object") {
    return true;
  }

  const evaluatedProperties = context.schemaEvaluatedProperties;

  let isValid = true;
  for (const [propertyNameNode, property] of Instance.entries(instance)) {
    const propertyName = Instance.value(propertyNameNode);
    if (evaluatedProperties.has(propertyName)) {
      continue;
    }

    if (!Validation.interpret(unevaluatedProperties, property, context)) {
      isValid = false;
    }

    context.evaluatedProperties?.add(propertyName);
  }

  return isValid;
};

const simpleApplicator = true;

const plugin = {
  id: `${id}#plugin`,
  beforeSchema(_url, instance, context) {
    context.evaluatedProperties ??= new Set();
    context.schemaEvaluatedProperties = new Set();
    context.instanceLocation ??= Instance.uri(instance);
  },

  beforeKeyword(_node, instance, context, schemaContext) {
    context.evaluatedProperties = new Set();
    context.schemaEvaluatedProperties = schemaContext.schemaEvaluatedProperties;
    context.instanceLocation = Instance.uri(instance);
  },

  afterKeyword(_node, _instance, context, _valid, schemaContext) {
    for (const property of context.evaluatedProperties) {
      schemaContext.schemaEvaluatedProperties.add(property);
    }
  },

  afterSchema(_node, instance, context, valid) {
    if (valid && Instance.uri(instance) === context.instanceLocation) {
      for (const property of context.schemaEvaluatedProperties) {
        context.evaluatedProperties.add(property);
      }
    }
  }
};

export default { id, compile, interpret, simpleApplicator, plugin };
