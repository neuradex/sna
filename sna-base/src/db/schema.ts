// Re-export sna-core DB primitives.
// Add app-specific tables here by calling getDb() and running extra CREATE TABLE statements.
export { getDb, type SkillEvent } from "sna/db/schema";
