let metaSchemaOutputFormat;
export const getMetaSchemaOutputFormat = () => metaSchemaOutputFormat;
export const setMetaSchemaOutputFormat = (format) => {
  metaSchemaOutputFormat = format;
};

let shouldValidateSchema = true;
export const getShouldValidateSchema = () => shouldValidateSchema;
export const setShouldValidateSchema = (isEnabled) => {
  shouldValidateSchema = isEnabled;
};

let shouldValidateFormat;
export const getShouldValidateFormat = () => shouldValidateFormat;
export const setShouldValidateFormat = (isEnabled) => {
  shouldValidateFormat = isEnabled;
};
