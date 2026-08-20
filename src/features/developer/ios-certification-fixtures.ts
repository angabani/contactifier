export const IOS_FIXTURE_NAME_PREFIX = '[Contactifier Test]';
export const IOS_FIXTURE_MARKER_PREFIX = 'contactifier://certification-fixture/';

export type IosFixtureStatus = 'pending-create' | 'create-unknown' | 'created' | 'absent' | 'ambiguous';

export interface IosFixtureSpec {
  readonly key: 'merge-a' | 'merge-b';
  readonly givenName: string;
  readonly familyName: string;
  readonly phone: string;
  readonly email: string;
  readonly marker: string;
}

export interface IosFixtureRecord extends IosFixtureSpec {
  readonly status: IosFixtureStatus;
  readonly nativeContactId?: string;
}

export interface IosFixtureSet {
  readonly schemaVersion: 1;
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
  deleteIfOwned(input: { readonly id: string; readonly marker: string; readonly expectedGivenName: string }): Promise<boolean>;
}

export type IosFixtureSetupOutcome = 'ready' | 'retry-required' | 'ambiguous' | 'create-unknown';

export interface IosFixtureSetupResult {
  readonly outcome: IosFixtureSetupOutcome;
  readonly fixtureSet: IosFixtureSet;
}

function fixtureSpecs(id: string): readonly IosFixtureSpec[] {
  const marker = (key: IosFixtureSpec['key']) => `${IOS_FIXTURE_MARKER_PREFIX}${id}/${key}`;
  return Object.freeze([
    {
      key: 'merge-a',
      givenName: `${IOS_FIXTURE_NAME_PREFIX} Avery`,
      familyName: 'Merge A',
      phone: '+1 415 555 0101',
      email: 'avery.fixture@example.test',
      marker: marker('merge-a'),
    },
    {
      key: 'merge-b',
      givenName: `${IOS_FIXTURE_NAME_PREFIX} Avery`,
      familyName: 'Merge B',
      phone: '+1 (415) 555-0101',
      email: 'AVERY.FIXTURE@example.test',
      marker: marker('merge-b'),
    },
  ]);
}

function replaceFixture(set: IosFixtureSet, key: IosFixtureSpec['key'], next: IosFixtureRecord): IosFixtureSet {
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
    if (!set) {
      const id = this.nextId();
      set = {
        schemaVersion: 1,
        id,
        createdAt: this.now(),
        fixtures: fixtureSpecs(id).map((fixture) => ({ ...fixture, status: 'pending-create' })),
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
      if (await this.gateway.deleteIfOwned({ id: matches[0].id, marker: fixture.marker, expectedGivenName: fixture.givenName })) deleted += 1;
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
