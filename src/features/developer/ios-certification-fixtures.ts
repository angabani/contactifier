export const IOS_FIXTURE_NAME_PREFIX = '[Contactifier Test]';
export const IOS_FIXTURE_MARKER_PREFIX = 'contactifier://certification-fixture/';
export const IOS_FIXTURE_DATASET_VERSION = 5;

export type IosFixtureStatus = 'pending-create' | 'create-unknown' | 'created' | 'absent' | 'ambiguous';

export interface IosFixtureSpec {
  readonly key: string;
  readonly scenario: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly phones: readonly { readonly label: string; readonly value: string }[];
  readonly emails: readonly { readonly label: string; readonly value: string }[];
  readonly company?: string;
  readonly department?: string;
  readonly jobTitle?: string;
  readonly photoKey?: 'contactifier-avatar';
  readonly groups?: readonly string[];
  readonly prefix?: string;
  readonly middleName?: string;
  readonly suffix?: string;
  readonly phoneticGivenName?: string;
  readonly website?: { readonly label: string; readonly value: string };
  readonly birthday?: { readonly year?: number; readonly month: number; readonly day: number };
  readonly event?: {
    readonly label: string;
    readonly date: { readonly year?: number; readonly month: number; readonly day: number };
  };
  readonly address?: {
    readonly label: string;
    readonly street: string;
    readonly city: string;
    readonly region: string;
    readonly postalCode: string;
    readonly country: string;
  };
  readonly marker: string;
}

export interface IosFixtureRecord extends IosFixtureSpec {
  readonly status: IosFixtureStatus;
  readonly nativeContactId?: string;
}

export interface IosFixtureSet {
  readonly schemaVersion: 1;
  readonly datasetVersion: number;
  readonly id: string;
  readonly createdAt: string;
  readonly fixtures: readonly IosFixtureRecord[];
}

export interface IosFixtureRepository {
  load(): Promise<IosFixtureSet | null>;
  save(value: IosFixtureSet): Promise<void>;
  clear(): Promise<void>;
}

export interface IosFixtureCandidate {
  readonly id: string;
  readonly givenName?: string;
  readonly markerValues: readonly string[];
}

export interface IosFixtureGateway {
  create(spec: IosFixtureSpec): Promise<string>;
  findByMarker(marker: string): Promise<readonly IosFixtureCandidate[]>;
  deleteIfOwned(input: {
    readonly id: string;
    readonly marker: string;
    readonly expectedGivenName: string;
    readonly groups: readonly string[];
  }): Promise<boolean>;
}

export type IosFixtureSetupOutcome = 'ready' | 'retry-required' | 'ambiguous' | 'create-unknown' | 'dataset-update-required';

export interface IosFixtureSetupResult {
  readonly outcome: IosFixtureSetupOutcome;
  readonly fixtureSet: IosFixtureSet;
}

export function iosFixtureSpecs(id: string): readonly IosFixtureSpec[] {
  const marker = (key: string) => `${IOS_FIXTURE_MARKER_PREFIX}${id}/${key}`;
  const spec = (value: Omit<IosFixtureSpec, 'marker'>): IosFixtureSpec => ({ ...value, marker: marker(value.key) });
  const name = (value: string) => `${IOS_FIXTURE_NAME_PREFIX} ${value}`;
  const richGroup = `${IOS_FIXTURE_NAME_PREFIX} ${id} Rich Contacts`;
  return Object.freeze([
    spec({ key: 'phone-a', scenario: 'Exact normalized phone', givenName: name('Avery'), familyName: 'Phone A', phones: [{ label: 'mobile', value: '+1 415 555 0101' }], emails: [] }),
    spec({ key: 'phone-b', scenario: 'Exact normalized phone', givenName: name('Avery'), familyName: 'Phone B', phones: [{ label: 'work', value: '+1 (415) 555-0101' }], emails: [] }),
    spec({ key: 'email-a', scenario: 'Case-insensitive email', givenName: name('Priya'), familyName: 'Email A', phones: [], emails: [{ label: 'home', value: 'priya.fixture@example.test' }] }),
    spec({ key: 'email-b', scenario: 'Case-insensitive email', givenName: name('Priya'), familyName: 'Email B', phones: [], emails: [{ label: 'work', value: 'PRIYA.FIXTURE@example.test' }] }),
    spec({ key: 'both-a', scenario: 'Phone and email match', givenName: name('Morgan'), familyName: 'Both A', phones: [{ label: 'mobile', value: '+44 20 7946 0101' }], emails: [{ label: 'home', value: 'morgan.fixture@example.test' }] }),
    spec({ key: 'both-b', scenario: 'Phone and email match', givenName: name('Morgan'), familyName: 'Both B', phones: [{ label: 'work', value: '+44 (20) 7946-0101' }], emails: [{ label: 'work', value: 'MORGAN.FIXTURE@example.test' }] }),
    spec({ key: 'bridge-a', scenario: 'Non-transitive merge guard', givenName: name('Bridge'), familyName: 'A', phones: [{ label: 'mobile', value: '212-555-0200' }], emails: [] }),
    spec({ key: 'bridge-b', scenario: 'Non-transitive merge guard', givenName: name('Bridge'), familyName: 'B', phones: [{ label: 'mobile', value: '(212) 555-0200' }], emails: [{ label: 'home', value: 'bridge.fixture@example.test' }] }),
    spec({ key: 'bridge-c', scenario: 'Non-transitive merge guard', givenName: name('Bridge'), familyName: 'C', phones: [], emails: [{ label: 'home', value: 'BRIDGE.FIXTURE@example.test' }] }),
    spec({ key: 'conflict-a', scenario: 'Conflicting identity', givenName: name('Jordan'), familyName: 'Conflict A', phones: [{ label: 'mobile', value: '646-555-0300' }], emails: [] }),
    spec({ key: 'conflict-b', scenario: 'Conflicting identity', givenName: name('Taylor'), familyName: 'Conflict B', phones: [{ label: 'mobile', value: '(646) 555-0300' }], emails: [] }),
    spec({ key: 'incomplete', scenario: 'Incomplete contact', givenName: name('Incomplete'), familyName: '', phones: [], emails: [] }),
    spec({ key: 'unique', scenario: 'Unique negative control', givenName: name('Unique'), familyName: 'Control', phones: [{ label: 'mobile', value: '+1 202 555 0400' }], emails: [{ label: 'home', value: 'unique.fixture@example.test' }] }),
    spec({ key: 'rich-a', scenario: 'Rich multi-value merge', givenName: name('Riley'), middleName: 'Certification', familyName: 'Rich A', prefix: 'Dr.', suffix: 'III', phoneticGivenName: 'Rye-lee', phones: [{ label: 'mobile', value: '+1 303 555 0500' }, { label: 'work', value: '+1 303 555 0501' }], emails: [{ label: 'home', value: 'riley.fixture@example.test' }], company: 'Contactifier Labs', department: 'Certification', jobTitle: 'Test Contact', groups: [richGroup], address: { label: 'work', street: '100 Test Lane', city: 'Denver', region: 'CO', postalCode: '80202', country: 'US' }, website: { label: 'homepage', value: 'https://contactifier.example.test/riley' }, birthday: { year: 1988, month: 4, day: 12 }, event: { label: 'anniversary', date: { year: 2020, month: 9, day: 21 } } }),
    spec({ key: 'rich-b', scenario: 'Rich multi-value merge', givenName: name('Riley'), familyName: 'Rich B', phones: [{ label: 'mobile', value: '+1 (303) 555-0500' }], emails: [{ label: 'work', value: 'riley.work@example.test' }], company: 'Contactifier Labs' }),
    spec({ key: 'photo-a', scenario: 'Photo merge and restore', givenName: name('Casey'), familyName: 'Photo A', phones: [{ label: 'mobile', value: '+1 720 555 0600' }], emails: [], photoKey: 'contactifier-avatar' }),
    spec({ key: 'photo-b', scenario: 'Photo merge and restore', givenName: name('Casey'), familyName: 'Photo B', phones: [{ label: 'work', value: '+1 (720) 555-0600' }], emails: [], photoKey: 'contactifier-avatar' }),
  ]);
}

function replaceFixture(set: IosFixtureSet, key: string, next: IosFixtureRecord): IosFixtureSet {
  return { ...set, fixtures: set.fixtures.map((fixture) => fixture.key === key ? next : fixture) };
}

function isOwned(candidate: IosFixtureCandidate, fixture: IosFixtureSpec): boolean {
  return candidate.givenName === fixture.givenName && candidate.markerValues.includes(fixture.marker);
}

export class IosCertificationFixtureManager {
  constructor(
    private readonly repository: IosFixtureRepository,
    private readonly gateway: IosFixtureGateway,
    private readonly nextId: () => string,
    private readonly now: () => string,
  ) {}

  load(): Promise<IosFixtureSet | null> {
    return this.repository.load();
  }

  async setup(): Promise<IosFixtureSetupResult> {
    let set = await this.repository.load();
    if (set && set.datasetVersion !== IOS_FIXTURE_DATASET_VERSION) {
      return { outcome: 'dataset-update-required', fixtureSet: set };
    }
    if (!set) {
      const id = this.nextId();
      set = {
        schemaVersion: 1,
        datasetVersion: IOS_FIXTURE_DATASET_VERSION,
        id,
        createdAt: this.now(),
        fixtures: iosFixtureSpecs(id).map((fixture) => ({ ...fixture, status: 'pending-create' })),
      };
      await this.repository.save(set);
    }

    for (const fixture of set.fixtures) {
      if (fixture.status === 'created') continue;
      if (fixture.status === 'ambiguous') return { outcome: 'ambiguous', fixtureSet: set };
      if (fixture.status === 'create-unknown') {
        const reconciled = await this.reconcile(set, fixture);
        set = reconciled.fixtureSet;
        if (reconciled.outcome !== 'ready') return reconciled;
        continue;
      }
      if (fixture.status === 'absent') {
        set = replaceFixture(set, fixture.key, { ...fixture, status: 'pending-create' });
        await this.repository.save(set);
      }
      try {
        const nativeContactId = await this.gateway.create(fixture);
        set = replaceFixture(set, fixture.key, { ...fixture, status: 'created', nativeContactId });
        await this.repository.save(set);
      } catch {
        set = replaceFixture(set, fixture.key, { ...fixture, status: 'create-unknown' });
        await this.repository.save(set);
        return { outcome: 'create-unknown', fixtureSet: set };
      }
    }
    return { outcome: 'ready', fixtureSet: set };
  }

  async cleanup(): Promise<{ readonly deleted: number; readonly retained: number }> {
    const set = await this.repository.load();
    if (!set) return { deleted: 0, retained: 0 };
    let deleted = 0;
    const retained: IosFixtureRecord[] = [];
    for (const fixture of set.fixtures) {
      const matches = await this.gateway.findByMarker(fixture.marker);
      if (matches.length !== 1 || !isOwned(matches[0], fixture)) {
        if (matches.length > 0) retained.push({ ...fixture, status: 'ambiguous' });
        continue;
      }
      if (await this.gateway.deleteIfOwned({
        id: matches[0].id,
        marker: fixture.marker,
        expectedGivenName: fixture.givenName,
        groups: fixture.groups ?? [],
      })) deleted += 1;
      else retained.push({ ...fixture, status: 'ambiguous' });
    }
    if (retained.length === 0) await this.repository.clear();
    else await this.repository.save({ ...set, fixtures: retained });
    return { deleted, retained: retained.length };
  }

  private async reconcile(set: IosFixtureSet, fixture: IosFixtureRecord): Promise<IosFixtureSetupResult> {
    const matches = await this.gateway.findByMarker(fixture.marker);
    if (matches.length === 0) {
      const next = replaceFixture(set, fixture.key, { ...fixture, status: 'absent', nativeContactId: undefined });
      await this.repository.save(next);
      return { outcome: 'retry-required', fixtureSet: next };
    }
    if (matches.length !== 1 || !isOwned(matches[0], fixture)) {
      const next = replaceFixture(set, fixture.key, { ...fixture, status: 'ambiguous', nativeContactId: undefined });
      await this.repository.save(next);
      return { outcome: 'ambiguous', fixtureSet: next };
    }
    const next = replaceFixture(set, fixture.key, { ...fixture, status: 'created', nativeContactId: matches[0].id });
    await this.repository.save(next);
    return { outcome: 'ready', fixtureSet: next };
  }
}
