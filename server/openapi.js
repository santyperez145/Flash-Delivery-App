import { baseOpenApiDocument } from "./openapi/document-base.js";
import { commercePaths } from "./openapi/paths-commerce.js";
import { mobilityFinancePaths } from "./openapi/paths-mobility-finance.js";
import { dispatchOperationsPaths } from "./openapi/paths-dispatch-operations.js";
import { extraTags } from "./openapi/extra-tags.js";
import { domainSchemas } from "./openapi/schemas-domains.js";

export const openApiDocument = structuredClone(baseOpenApiDocument);

Object.assign(openApiDocument.paths, commercePaths, mobilityFinancePaths, dispatchOperationsPaths);
openApiDocument.tags.push(...extraTags);
Object.assign(openApiDocument.components.schemas, domainSchemas);
