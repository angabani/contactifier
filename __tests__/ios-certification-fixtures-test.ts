import {
  IOS_FIXTURE_DATASET_VERSION,
  IOS_FIXTURE_NAME_PREFIX,
  IosCertificationFixtureManager,
  iosFixtureSpecs,
  type IosFixtureCandidate,
  type IosFixtureGateway,
  type IosFixtureRepository,
  type IosFixtureSet,
  type IosFixtureSpec,
} from '@/features/developer/ios-certification-fixtures';

class MemoryRepository implements IosFixtureRepository {
  value: IosFixtureSet | null = null;
  save = jest.fn(async (value: IosFixtureSet) => { this.value = value; });
  clear = jest.fn(async () => { this.value = null; });
  async load() { return this.value; }
}

function gateway(): IosFixtureGateway & {
  create: jest.Mock<Promise<string>, [IosFixtureSpec]>;
  findByMarker: jest.Mock<Promise<readonly IosFixtureCandidate[]>, [string]>;
  deleteIfOwned: jest.Mock<Promise<boolean>, [{ id: string; marker: string; expectedGivenName: string; groups: readonly string[] }]>;
} {
  return {
    create: jest.fn(async (spec) => `native-${spec.key}`),
    findByMarker: jest.fn(async (_marker: string) => [] as readonly IosFixtureCandidate[]),
    deleteIfOwned: jest.fn(async (_input: { id: string; marker: string; expectedGivenName: string; groups: readonly string[] }) => true),
  };
}

function manager(repository: MemoryRepository, native: ReturnType<typeof gateway>) {
  return new IosCertificationFixtureManager(repository, native, () => 'set-1', () => '2026-08-20T00:00:00.000Z');
}

describe('IosCertificationFixtureManager', () => {
  it('persists marker ownership before the first native create', async () => {
    const repository = new MemoryRepository();
    const native = gateway();
    native.create.mockImplementationOnce(async () => {
      expect(repository.value?.id).toBe('set-1');
      expect(repository.value?.fixtures[0].marker).toBe('contactifier://certification-fixture/set-1/phone-a');
      throw new Error('unknown native result');
    });

    const result = await manager(repository, native).setup();

    expect(result.outcome).toBe('create-unknown');
    expect(result.failureReason).toBe('unknown native result');
    expect(repository.value?.fixtures[0].status).toBe('create-unknown');
  });

  it('adopts one exact owned contact after an unknown create without retrying', async () => {
    const repository = new MemoryRepository();
    const native = gateway();
    native.create.mockRejectedValueOnce(new Error('unknown'));
    await manager(repository, native).setup();
    const fixture = repository.value!.fixtures[0];
    native.findByMarker.mockResolvedValueOnce([{ id: 'recovered', givenName: fixture.givenName, markerValues: [fixture.marker] }]);

    const result = await manager(repository, native).setup();

    expect(result.outcome).toBe('ready');
    expect(native.create.mock.calls.filter(([spec]) => spec.key === fixture.key)).toHaveLength(1);
    expect(repository.value?.fixtures[0].nativeContactId).toBe('recovered');
  });

  it('requires a separate action before retrying when reconciliation finds no contact', async () => {
    const repository = new MemoryRepository();
    const native = gateway();
    native.create.mockRejectedValueOnce(new Error('unknown'));
    await manager(repository, native).setup();

    const result = await manager(repository, native).setup();

    expect(result.outcome).toBe('retry-required');
    expect(native.create).toHaveBeenCalledTimes(1);
    expect(repository.value?.fixtures[0].status).toBe('absent');
  });

  it('locks ambiguous ownership instead of creating or deleting', async () => {
    const repository = new MemoryRepository();
    const native = gateway();
    native.create.mockRejectedValueOnce(new Error('unknown'));
    await manager(repository, native).setup();
    const fixture = repository.value!.fixtures[0];
    native.findByMarker.mockResolvedValueOnce([
      { id: 'one', givenName: fixture.givenName, markerValues: [fixture.marker] },
      { id: 'two', givenName: fixture.givenName, markerValues: [fixture.marker] },
    ]);

    expect((await manager(repository, native).setup()).outcome).toBe('ambiguous');
    expect(native.create).toHaveBeenCalledTimes(1);
    expect(native.deleteIfOwned).not.toHaveBeenCalled();
  });

  it('deletes only a unique candidate with both exact name and marker ownership', async () => {
    const repository = new MemoryRepository();
    const native = gateway();
    await manager(repository, native).setup();
    const fixtures = repository.value!.fixtures;
    native.findByMarker
      .mockResolvedValueOnce([{ id: 'a', givenName: fixtures[0].givenName, markerValues: [fixtures[0].marker] }])
      .mockResolvedValueOnce([{ id: 'b', givenName: 'Renamed', markerValues: [fixtures[1].marker] }]);

    const result = await manager(repository, native).cleanup();

    expect(result).toEqual({ deleted: 1, retained: 1 });
    expect(native.deleteIfOwned).toHaveBeenCalledWith({ id: 'a', marker: fixtures[0].marker, expectedGivenName: fixtures[0].givenName, groups: [] });
    expect(native.deleteIfOwned).toHaveBeenCalledTimes(1);
    expect(repository.value?.fixtures[0].status).toBe('ambiguous');
  });

  it('uses an unmistakable visible prefix on every fixture', async () => {
    const repository = new MemoryRepository();
    const native = gateway();
    await manager(repository, native).setup();
    expect(repository.value?.fixtures.every(({ givenName }) => givenName.startsWith(IOS_FIXTURE_NAME_PREFIX))).toBe(true);
  });

  it('defines a versioned dataset covering positive, negative, conflict, and rich cases', () => {
    const fixtures = iosFixtureSpecs('matrix');

    expect(IOS_FIXTURE_DATASET_VERSION).toBe(6);
    expect(fixtures).toHaveLength(18);
    expect(new Set(fixtures.map(({ key }) => key)).size).toBe(fixtures.length);
    expect(new Set(fixtures.map(({ scenario }) => scenario))).toEqual(new Set([
      'Exact normalized phone',
      'Case-insensitive email',
      'Phone and email match',
      'Non-transitive merge guard',
      'Conflicting identity',
      'Incomplete contact',
      'Single-operation cleanup',
      'Unique negative control',
      'Rich multi-value merge',
      'Photo merge and restore',
    ]));
    expect(fixtures.find(({ key }) => key === 'rich-a')).toMatchObject({
      company: 'Contactifier Labs',
      prefix: 'Dr.',
      phoneticGivenName: 'Rye-lee',
      website: { value: 'https://contactifier.example.test/riley' },
      birthday: { year: 1988, month: 4, day: 12 },
      event: { label: 'anniversary' },
      groups: ['[Contactifier Test] matrix Rich Contacts'],
      phones: expect.arrayContaining([{ label: 'work', value: '+1 303 555 0501' }]),
    });
    expect(fixtures.filter(({ photoKey }) => photoKey === 'contactifier-avatar')).toHaveLength(2);
  });
});
