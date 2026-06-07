/**
 * lib/tenant — host parsing + the shared reserved-subdomain blocklist.
 *
 * The DB-backed tenant resolver and provisioning live in the identity-tenant
 * module (`@/modules/identity-tenant`), which imports RESERVED_SUBDOMAINS from
 * here so selection and routing share one blocklist.
 */

export * from "./host";
