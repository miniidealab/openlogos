import { pipe, asyncMap, asyncCollectArray } from "@hyperjump/pact";
import * as Browser from "@hyperjump/browser";
import * as Instance from "../lib/instance.js";
import { Validation } from "../lib/experimental.js";


const id = "https://json-schema.org/keyword/draft-04/dependencies";

const compile = (schema, ast) => pipe(
  Browser.entries(schema),
  asyncMap(async ([key, dependency]) => [
    key,
    Browser.typeOf(dependency) === "array" ? Browser.value(dependency) : await Validation.compile(dependency, ast)
  ]),
  asyncCollectArray
);

const interpret = (dependencies, instance, context) => {
  if (Instance.typeOf(instance) !== "object") {
    return true;
  }

  let isValid = true;
  for (const [propertyName, dependency] of dependencies) {
    if (!Instance.has(propertyName, instance)) {
      continue;
    }

    if (Array.isArray(dependency)) {
      isValid &&= dependency.every((key) => Instance.has(key, instance));
    } else {
      const isSchemaValid = Validation.interpret(dependency, instance, context);
      isValid &&= isSchemaValid;
    }
  }

  return isValid;
};

export default { id, compile, interpret };
