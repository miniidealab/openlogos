import * as Pact from "@hyperjump/pact";
import { getKeyword } from "./keywords.js";


const REGEXP_MARKER = "a6d8f3e1-9b2c-4f7a-8d5b-1c2e3f4a5b6c";

export const serialize = (compiledSchema) => {
  const plugins = [];
  for (const plugin of compiledSchema.ast.plugins) {
    if (!plugin.id) {
      throw Error("Cannot serialize plugin without id");
    }
    plugins.push(plugin.id);
  }

  const toSerialize = {
    ...compiledSchema,
    ast: {
      ...compiledSchema.ast,
      plugins
    }
  };

  return JSON.stringify(toSerialize, (_key, value) => {
    if (value instanceof RegExp) {
      return { [REGEXP_MARKER]: { source: value.source, flags: value.flags } };
    }

    return value;
  });
};

export const deserialize = (serialized) => {
  const parsed = JSON.parse(serialized, (_key, value) => {
    if (value?.[REGEXP_MARKER]) {
      return new RegExp(value[REGEXP_MARKER].source, value[REGEXP_MARKER].flags);
    }

    return value;
  });

  parsed.ast.plugins = Pact.pipe(
    parsed.ast.plugins,
    Pact.map((pluginUri) => resolvePlugin(pluginUri)),
    Pact.collectSet
  );

  return parsed;
};

const resolvePlugin = (pluginUri) => {
  const keyword = getKeyword(pluginUri);
  if (keyword?.plugin?.id === pluginUri) {
    return keyword.plugin;
  }

  throw Error(`Plugin with id '${pluginUri}' is not found`);
};
