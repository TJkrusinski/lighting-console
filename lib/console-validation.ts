import { getMode, getProfile } from "./fixture-profiles";
import type { PatchedFixture } from "./console-types";

export function validatePatch(fixtures: PatchedFixture[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const fixture of fixtures) {
    if (!fixture.id || ids.has(fixture.id)) {
      errors.push(`Fixture IDs must be unique (${fixture.id || "missing"}).`);
    }
    ids.add(fixture.id);

    const profile = getProfile(fixture.profileId);
    const mode = getMode(fixture.profileId, fixture.modeId);
    if (!profile?.dmxCapable || !mode) {
      errors.push(`${fixture.name || "Fixture"} has no patchable DMX mode.`);
      continue;
    }
    if (!Number.isInteger(fixture.address) || fixture.address < 1 || fixture.address > 512) {
      errors.push(`${fixture.name} must start at a channel from 1 to 512.`);
    }
  }
  return errors;
}
