vi.mock('../../navigation/navigationHelperLibrary', () => ({
  preCompileFunctions: {
    getRobotTemplateName: vi.fn().mockReturnValue('robots/san-antonio'),
    getAllYAMLFilePaths: vi.fn().mockReturnValue(['singlePage']),
    getCLIParams: vi.fn().mockReturnValue({}),
    getFolderPath: vi.fn().mockReturnValue(''),
  },
}));

vi.mock('../../helpers/helpers', () => {
  const mockHelper = {
    moveShadowToMainDom: vi.fn().mockResolvedValue(undefined),
    checkAndReturnProp: vi.fn().mockResolvedValue(null),
    checkSelector: vi.fn().mockResolvedValue(false),
    addAttributeToExtractedRecords: vi.fn().mockResolvedValue(undefined),
    appendScreenCaptures: vi.fn().mockResolvedValue(undefined),
    deleteDuplicateDOMElements: vi.fn().mockResolvedValue(undefined),
  };
  return {
    Helpers: vi.fn().mockImplementation(() => mockHelper),
    YAML: {},
    __mockHelper: mockHelper,
  };
});

const { createMockContext } = require('../../__mocks__/context');
const { DataModifier } = require('../../helpers/data');

// Load module under test after mocks are set up
const sanAntonioExtract = require('../san-antonio/extract');

describe('san-antonio/extract (Tier 4)', () => {
  let context;
  let dependencies;
  let defaultInputs;
  let transformFn;

  beforeEach(() => {
    vi.clearAllMocks();

    context = createMockContext({
      extract: vi.fn().mockResolvedValue([{ group: [{ name: [{ text: 'Product 1' }] }] }]),
      waitForXPath: vi.fn().mockResolvedValue(undefined),
    });

    const mockYAMLSchema = { selector: 'div.product', fields: { name: { selector: 'h1' } } };

    dependencies = {
      append: vi.fn().mockResolvedValue(undefined),
      beforeExtract: vi.fn().mockResolvedValue(undefined),
      dataHelper: { DataModifier },
      helpers: require('../../helpers/helpers'),
      singlePage: mockYAMLSchema,
    };

    defaultInputs = {
      schemaYAML: 'singlePage',
      mergeType: 'APPEND',
      originalInputs: { url: 'https://example.com' },
    };

    transformFn = '(data, context) => data';
  });

  // Test 1
  it('calls append with inputs', async () => {
    await sanAntonioExtract.implementation(
      defaultInputs,
      { transform: transformFn },
      context,
      dependencies,
    );

    expect(dependencies.append).toHaveBeenCalledWith(defaultInputs);
  });

  // Test 2
  it('calls beforeExtract with inputs', async () => {
    await sanAntonioExtract.implementation(
      defaultInputs,
      { transform: transformFn },
      context,
      dependencies,
    );

    expect(dependencies.beforeExtract).toHaveBeenCalledWith(defaultInputs);
  });

  // Test 3
  it('calls context.extract with correct schema dependency', async () => {
    await sanAntonioExtract.implementation(
      defaultInputs,
      { transform: transformFn },
      context,
      dependencies,
    );

    expect(context.extract).toHaveBeenCalledTimes(1);
    // First argument should be the YAML schema object from dependencies
    expect(context.extract).toHaveBeenCalledWith(
      dependencies.singlePage,
      expect.objectContaining({ type: 'APPEND' }),
    );
  });

  // Test 4
  it('throws when schemaYAML key not found in dependencies', async () => {
    const inputsBadSchema = { ...defaultInputs, schemaYAML: 'nonExistentSchema' };

    await expect(
      sanAntonioExtract.implementation(
        inputsBadSchema,
        { transform: transformFn },
        context,
        dependencies,
      ),
    ).rejects.toThrow('Issue with the specified schemaYAML');
  });

  // Test 5
  it('returns extracted data', async () => {
    const expectedData = [{ group: [{ name: [{ text: 'Product 1' }] }] }];
    context.extract.mockResolvedValue(expectedData);

    const result = await sanAntonioExtract.implementation(
      defaultInputs,
      { transform: transformFn },
      context,
      dependencies,
    );

    expect(result).toEqual(expectedData);
  });

  // Test 6
  it('calls addExtraFieldsToAllRows on extracted data', async () => {
    const addExtraFieldsSpy = vi.spyOn(DataModifier, 'addExtraFieldsToAllRows');
    const extractedData = [{ group: [{ name: [{ text: 'Product 1' }] }] }];
    context.extract.mockResolvedValue(extractedData);

    await sanAntonioExtract.implementation(
      defaultInputs,
      { transform: transformFn },
      context,
      dependencies,
    );

    expect(addExtraFieldsSpy).toHaveBeenCalledWith(extractedData, defaultInputs);
    addExtraFieldsSpy.mockRestore();
  });

  // Test 7
  it('calls addAttributeToExtractedRecords when flag is true', async () => {
    const mockAddAttr = vi.fn().mockResolvedValue(undefined);
    const mockHelperInstance = {
      moveShadowToMainDom: vi.fn().mockResolvedValue(undefined),
      checkAndReturnProp: vi.fn().mockResolvedValue(null),
      checkSelector: vi.fn().mockResolvedValue(false),
      addAttributeToExtractedRecords: mockAddAttr,
      appendScreenCaptures: vi.fn().mockResolvedValue(undefined),
      deleteDuplicateDOMElements: vi.fn().mockResolvedValue(undefined),
    };
    const localDeps = {
      ...dependencies,
      helpers: {
        Helpers: vi.fn().mockImplementation(() => mockHelperInstance),
        YAML: {},
      },
    };
    const inputsWithAttr = { ...defaultInputs, addAttributeToExtractedRecords: true };

    await sanAntonioExtract.implementation(
      inputsWithAttr,
      { transform: transformFn },
      context,
      localDeps,
    );

    expect(mockAddAttr).toHaveBeenCalled();
  });

  // Test 8
  it('handles deleteDuplicateDOMElements when array provided', async () => {
    const mockDeleteDup = vi.fn().mockResolvedValue(undefined);
    const mockHelperInstance = {
      moveShadowToMainDom: vi.fn().mockResolvedValue(undefined),
      checkAndReturnProp: vi.fn().mockResolvedValue(null),
      checkSelector: vi.fn().mockResolvedValue(false),
      addAttributeToExtractedRecords: vi.fn().mockResolvedValue(undefined),
      appendScreenCaptures: vi.fn().mockResolvedValue(undefined),
      deleteDuplicateDOMElements: mockDeleteDup,
    };
    const localDeps = {
      ...dependencies,
      helpers: {
        Helpers: vi.fn().mockImplementation(() => mockHelperInstance),
        YAML: {},
      },
    };
    const inputsWithDelete = { ...defaultInputs, deleteDuplicateDOMElements: ['#__input', '.duplicate'] };

    await sanAntonioExtract.implementation(
      inputsWithDelete,
      { transform: transformFn },
      context,
      localDeps,
    );

    expect(mockDeleteDup).toHaveBeenCalledWith(['#__input', '.duplicate']);
  });
});
