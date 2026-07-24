#!/usr/bin/env node

/**
 * Project policy: the schemas in published compatibility targets stay within
 * the OB-2020-12 comparison profile. This is not an OpenBindings requirement;
 * it ensures the contracts this repository recommends can actually be checked
 * by the comparison profile this repository publishes.
 */

import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
const errors = [];

const keywords = new Set([
  "$ref",
  "$defs",
  "allOf",
  "oneOf",
  "anyOf",
  "type",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

const annotations = new Set([
  "title",
  "description",
  "examples",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "$schema",
  "format",
  "discriminator",
  "nullable",
]);

function visitSchema(schema, path) {
  if (typeof schema === "boolean") return;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    errors.push(`${path}: schema must be an object or boolean`);
    return;
  }

  for (const key of Object.keys(schema)) {
    if (!keywords.has(key) && !annotations.has(key) && !key.startsWith("x-")) {
      errors.push(`${path}: keyword ${JSON.stringify(key)} is outside OB-2020-12`);
    }
  }

  for (const key of ["properties", "$defs"]) {
    const entries = schema[key];
    if (entries && typeof entries === "object" && !Array.isArray(entries)) {
      for (const [name, child] of Object.entries(entries)) {
        visitSchema(child, `${path}/${key}/${name}`);
      }
    }
  }
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      branches.forEach((child, index) => visitSchema(child, `${path}/${key}/${index}`));
    }
  }
  if (schema.items !== undefined) visitSchema(schema.items, `${path}/items`);
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== "boolean"
  ) {
    visitSchema(schema.additionalProperties, `${path}/additionalProperties`);
  }
}

for (const file of files) {
  const document = JSON.parse(readFileSync(file, "utf8"));
  for (const [name, schema] of Object.entries(document.schemas || {})) {
    visitSchema(schema, `${file}#/schemas/${name}`);
  }
  for (const [name, operation] of Object.entries(document.operations || {})) {
    if (operation.input !== undefined) {
      visitSchema(operation.input, `${file}#/operations/${name}/input`);
    }
    if (operation.output !== undefined) {
      visitSchema(operation.output, `${file}#/operations/${name}/output`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(`${files.length} interface contracts stay within OB-2020-12: OK`);
