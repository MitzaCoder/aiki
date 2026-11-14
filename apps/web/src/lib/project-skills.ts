import type { ProjectSkill, SkillRole } from '@kemiri/protocol';

export const SKILL_FILTERS = ['All', 'Offered', 'Off', 'New'] as const;
export type SkillFilter = (typeof SKILL_FILTERS)[number];
export function skillOffered(skill: Pick<ProjectSkill, 'roles'>): boolean { return skill.roles.length > 0; }
export function skillSwitchRoles(offered: boolean): SkillRole[] { return offered ? ['coordinator', 'workers', 'background'] : []; }
export function skillSomeRoles(skill: Pick<ProjectSkill, 'roles'>): boolean {
  return skillOffered(skill) && !skillSwitchRoles(true).every(role => skill.roles.includes(role));
}
export function projectSkillLabel(skill: Pick<ProjectSkill, 'origin' | 'source'>): string {
  if (skill.origin === 'builtin') return 'Kemiri';
  const project = { harness: 'Kemiri', pi: '.pi/skills', claude: '.claude/skills', agents: '.agents/skills' };
  const global = { harness: 'Kemiri', pi: 'pi', claude: 'Claude Code', agents: '.agents' };
  return skill.origin === 'project' ? `Project · ${project[skill.source]}` : `Global · ${global[skill.source]}`;
}
export function filterProjectSkills(skills: ProjectSkill[], query: string, filter: SkillFilter): ProjectSkill[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return skills.filter(skill => {
    if (filter === 'Offered' && !skillOffered(skill)) return false;
    if (filter === 'Off' && skillOffered(skill)) return false;
    if (filter === 'New' && skill.decided) return false;
    const text = `${skill.name} ${skill.description} ${projectSkillLabel(skill)}`.toLowerCase();
    return words.every(word => text.includes(word));
  });
}
export function projectSkillGroups(skills: ProjectSkill[]) {
  return ([['project', 'This project'], ['builtin', 'Built in'], ['global', 'On this backend, for every project']] as const)
    .map(([origin, title]) => ({ origin, title, skills: skills.filter(skill => skill.origin === origin).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter(group => group.skills.length > 0);
}

export type SkillChange = { name: string; roles: SkillRole[] };
export type SkillChoicesSnapshot = { skills: ProjectSkill[]; loaded: boolean; saving: boolean; error: string; saved: boolean };
/** Serial, debounced writes with optimistic overlays. A push never overwrites an unsaved switch. */
export class ProjectSkillChoices {
  #catalogue: ProjectSkill[] = [];
  #pending = new Map<string, SkillRole[]>();
  #sending = new Map<string, SkillRole[]>();
  #timer?: ReturnType<typeof setTimeout>;
  #loaded = false;
  #error = '';
  #saved = false;
  #refreshAfterSave = false;
  #loadSequence = 0;
  #disposed = false;
  constructor(private readonly options: {
    get: () => Promise<ProjectSkill[]>;
    set: (changes: SkillChange[]) => Promise<ProjectSkill[]>;
    changed: (snapshot: SkillChoicesSnapshot) => void;
    delayMs?: number;
  }) {}
  get snapshot(): SkillChoicesSnapshot {
    return {
      skills: this.#catalogue.map(skill => {
        const roles = this.#pending.get(skill.name) ?? this.#sending.get(skill.name);
        return roles === undefined ? skill : { ...skill, roles, decided: true };
      }),
      loaded: this.#loaded, saving: this.#sending.size > 0 || this.#pending.size > 0,
      error: this.#error, saved: this.#saved,
    };
  }
  #notify() { if (!this.#disposed) this.options.changed(this.snapshot); }
  async refresh(): Promise<void> {
    if (this.#sending.size || this.#pending.size) { this.#refreshAfterSave = true; return; }
    const sequence = ++this.#loadSequence;
    try {
      const skills = await this.options.get();
      if (sequence !== this.#loadSequence) return;
      this.#catalogue = skills; this.#loaded = true; this.#error = '';
    } catch (failure) {
      if (sequence !== this.#loadSequence) return;
      this.#error = failure instanceof Error ? failure.message : 'Could not load Skills.';
    }
    this.#notify();
  }
  toggle(name: string, offered: boolean): void {
    this.#pending.set(name, skillSwitchRoles(offered)); this.#saved = false; this.#error = '';
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { void this.flush(); }, this.options.delayMs ?? 1000);
    this.#notify();
  }
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    if (this.#sending.size || !this.#pending.size) return;
    ++this.#loadSequence; // An older read must not win over this write.
    this.#sending = this.#pending; this.#pending = new Map(); this.#notify();
    let failed = false;
    try {
      this.#catalogue = await this.options.set([...this.#sending].map(([name, roles]) => ({ name, roles })));
      this.#loaded = true; this.#saved = true;
    } catch (failure) {
      failed = true;
      this.#error = failure instanceof Error ? failure.message : 'Could not save Skills.';
      // Dropping the failed overlay restores the confirmed catalogue, retaining newer edits.
    }
    this.#sending = new Map(); this.#notify();
    if (this.#pending.size) {
      this.#timer = setTimeout(() => { void this.flush(); }, this.options.delayMs ?? 1000);
    } else if (this.#refreshAfterSave) {
      this.#refreshAfterSave = false;
      if (!failed && !this.#disposed) await this.refresh();
    }
  }
  dispose(): void {
    this.#disposed = true;
    // Navigation must not silently discard the last second of edits.
    void this.flush();
  }
}
