import { createOpenAPI } from 'fumadocs-openapi/server';

export const openapi = createOpenAPI({
  input: ['./openapi/sna.json', './openapi/sna.ko.json', './openapi/sna.ja.json'],
});
