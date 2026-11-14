import { describe, expect, test } from 'bun:test';
import type { ProjectSkill } from '@kemiri/protocol';
import { ProjectSkillChoices, SKILL_FILTERS, filterProjectSkills, projectSkillGroups, projectSkillLabel, skillOffered, skillSomeRoles, skillSwitchRoles, type SkillChange } from '../src/lib/project-skills.ts';
import { PROJECT_SECTIONS, projectSectionAvailable, settingsLocation } from '../src/lib/settings.ts';

const skill = (name: string, fields: Partial<ProjectSkill> = {}): ProjectSkill => ({
  name, description: 'Fold synthetic paper birds', path: `/example/skills/${name}/SKILL.md`,
  origin: 'project', source: 'pi', hides: [], roles: skillSwitchRoles(true), decided: false, ...fields,
});
function fixture(set?: (changes: SkillChange[]) => Promise<ProjectSkill[]>) {
  let catalogue = [skill('cranes'), skill('kites')];
  const calls: SkillChange[][] = [];
  const choices = new ProjectSkillChoices({
    get: async () => catalogue,
    set: async changes => {
      calls.push(changes);
      if (set) return set(changes);
      catalogue = catalogue.map(entry => {
        const change = changes.find(change => change.name === entry.name);
        return change ? { ...entry, roles: change.roles, decided: true } : entry;
      });
      return catalogue;
    },
    changed: () => {}, delayMs: 15,
  });
  return { choices, calls };
}
describe('project Skills', () => {
  test('capability gates both the list and deep link', () => {
    expect(PROJECT_SECTIONS.findIndex(section => section.id === 'skills')).toBe(PROJECT_SECTIONS.findIndex(section => section.id === 'mcp') + 1);
    expect(projectSectionAvailable('skills', { supports: () => false, links: true, longPromptCache: true })).toBe(false);
    expect(projectSectionAvailable('skills', { supports: feature => feature === 'project-skills', links: false, longPromptCache: false })).toBe(true);
    expect(settingsLocation('/b/demo/projects/p/settings/skills')?.section).toBe('skills');
  });
  test('groups in project, builtin, global order with sorted names', () => {
    const groups = projectSkillGroups([skill('z'), skill('g', { origin: 'global' }), skill('a'), skill('b', { origin: 'builtin' })]);
    expect(groups.map(group => group.title)).toEqual(['This project', 'Built in', 'On this backend, for every project']);
    expect(groups[0]!.skills.map(entry => entry.name)).toEqual(['a', 'z']);
    expect(projectSkillGroups([])).toEqual([]);
  });
  test('all source and origin labels', () => {
    for (const [source, project, global] of [
      ['pi', '.pi/skills', 'pi'], ['claude', '.claude/skills', 'Claude Code'], ['agents', '.agents/skills', '.agents'], ['harness', 'Kemiri', 'Kemiri'],
    ] as const) {
      expect(projectSkillLabel({ source, origin: 'project' })).toBe(`Project · ${project}`);
      expect(projectSkillLabel({ source, origin: 'global' })).toBe(`Global · ${global}`);
      expect(projectSkillLabel({ source, origin: 'builtin' })).toBe('Kemiri');
    }
  });
  test('switch maps off/all roles and preserves the meaning of subsets', () => {
    expect(skillSwitchRoles(false)).toEqual([]);
    expect(skillSwitchRoles(true)).toEqual(['coordinator', 'workers', 'background']);
    for (const roles of [[], ['workers'], skillSwitchRoles(true)] as ProjectSkill['roles'][]) {
      expect(skillOffered({ roles })).toBe(roles.length > 0);
      expect(skillSomeRoles({ roles })).toBe(roles.length === 1);
    }
  });
  test('chips combine with case-insensitive text search', () => {
    const catalogue = [skill('cranes'), skill('kites', { roles: [], decided: true }), skill('boats', { roles: ['workers'], decided: true })];
    expect(SKILL_FILTERS).toEqual(['All', 'Offered', 'Off', 'New']);
    const names = (filter: typeof SKILL_FILTERS[number], query = '') => filterProjectSkills(catalogue, query, filter).map(entry => entry.name);
    expect(names('All')).toEqual(['cranes', 'kites', 'boats']);
    expect(names('Offered')).toEqual(['cranes', 'boats']);
    expect(names('Off')).toEqual(['kites']);
    expect(names('New')).toEqual(['cranes']);
    expect(names('All', 'PAPER CRAN')).toEqual(['cranes']);
    expect(names('Off', 'cranes')).toEqual([]);
    expect(names('All', '.pi/skills')).toHaveLength(3);
  });
  test('debounce batches different names and keeps the last choice for a name', async () => {
    const { choices, calls } = fixture(); await choices.refresh();
    choices.toggle('cranes', false); choices.toggle('kites', false); choices.toggle('cranes', true);
    expect(calls).toHaveLength(0);
    expect(choices.snapshot.skills[0]!.decided).toBe(true);
    expect(choices.snapshot.saving).toBe(true);
    await Bun.sleep(45);
    expect(calls).toEqual([[{ name: 'cranes', roles: skillSwitchRoles(true) }, { name: 'kites', roles: [] }]]);
    expect(choices.snapshot.saved).toBe(true); expect(choices.snapshot.saving).toBe(false);
    choices.dispose();
  });
  test('failed batch rolls back and exposes the error', async () => {
    const { choices } = fixture(async () => { throw new Error('Synthetic save failure'); }); await choices.refresh();
    choices.toggle('cranes', false); expect(skillOffered(choices.snapshot.skills[0]!)).toBe(false);
    await choices.flush();
    expect(choices.snapshot.skills[0]!.decided).toBe(false);
    expect(skillOffered(choices.snapshot.skills[0]!)).toBe(true);
    expect(choices.snapshot.error).toBe('Synthetic save failure'); choices.dispose();
  });
  test('push refresh does not overwrite edits made during a save', async () => {
    let resolve!: (skills: ProjectSkill[]) => void;
    const { choices, calls } = fixture(() => new Promise(done => { resolve = done; })); await choices.refresh();
    choices.toggle('cranes', false); const first = choices.flush();
    choices.toggle('cranes', true); await choices.refresh();
    resolve([skill('cranes', { roles: [], decided: true }), skill('kites')]); await first;
    expect(skillOffered(choices.snapshot.skills[0]!)).toBe(true);
    const second = choices.flush();
    expect(calls).toHaveLength(2);
    resolve([skill('cranes', { decided: true }), skill('kites')]); await second;
    expect(choices.snapshot.saving).toBe(false); choices.dispose();
  });
  test('leaving the section flushes pending changes', async () => {
    const { choices, calls } = fixture(); await choices.refresh();
    choices.toggle('cranes', false); choices.dispose();
    expect(calls).toHaveLength(1);
  });
});
