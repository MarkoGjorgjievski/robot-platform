const fs = require('fs');
const path = require('path');

const DOMAIN_OVERRIDES_ROOT = path.resolve(__dirname, '..');

describe('Domain Override Spot Checks (Tier 5)', () => {
  // Test 1: Goto domain override exports expected shape
  it('goto domain override exports a function or object with expected shape', () => {
    const gotoFile = path.join(DOMAIN_OVERRIDES_ROOT, 'goto/domains/am/amazon.com.js');
    expect(fs.existsSync(gotoFile)).toBe(true);

    const gotoOverride = require(gotoFile);
    expect(gotoOverride).toBeDefined();
    expect(gotoOverride).toHaveProperty('implements');
    expect(gotoOverride).toHaveProperty('parameterValues');
    expect(gotoOverride.parameterValues).toHaveProperty('domain');
    expect(typeof gotoOverride.implementation).toBe('function');
  });

  // Test 2: Robot domain override has index.js with parameterValues
  it('robot domain override (redfin US) has index.js with parameterValues', () => {
    const robotFile = path.join(DOMAIN_OVERRIDES_ROOT, 'robot/domains/r/redfin/US/index.js');
    expect(fs.existsSync(robotFile)).toBe(true);

    const robotOverride = require(robotFile);
    expect(robotOverride).toBeDefined();
    expect(robotOverride).toHaveProperty('implements');
    expect(robotOverride.implements).toBe('robots/san-antonio');
    expect(robotOverride).toHaveProperty('parameterValues');
    expect(robotOverride.parameterValues).toHaveProperty('country');
    expect(robotOverride.parameterValues).toHaveProperty('resultsTarget');
  });

  // Test 3: YAML schema files exist for a domain
  it('YAML schema files exist for redfin US domain', () => {
    const domainDir = path.join(DOMAIN_OVERRIDES_ROOT, 'robot/domains/r/redfin/US');
    expect(fs.existsSync(domainDir)).toBe(true);

    const files = fs.readdirSync(domainDir);
    const yamlFiles = files.filter(f => f.endsWith('.yaml'));

    expect(yamlFiles.length).toBeGreaterThan(0);
    expect(yamlFiles).toContain('singlePage.yaml');
  });

  // Test 4: Domain overrides follow naming convention
  it('goto domain overrides follow naming convention (prefix directory matches domain start)', () => {
    const gotoDomainBase = path.join(DOMAIN_OVERRIDES_ROOT, 'goto/domains');
    const prefixDirs = fs.readdirSync(gotoDomainBase).filter(
      d => fs.statSync(path.join(gotoDomainBase, d)).isDirectory(),
    );

    // Check a sample of prefix directories
    const samplePrefixes = prefixDirs.slice(0, 10);
    for (const prefix of samplePrefixes) {
      const domainFiles = fs.readdirSync(path.join(gotoDomainBase, prefix));
      // Filter to primary domain files only (exclude setZipCode.* and other helper files)
      const primaryFiles = domainFiles.filter(f => f.endsWith('.js') && !f.includes('setZipCode') && !f.includes('Custom'));
      for (const file of primaryFiles) {
        const domainName = file.replace('.js', '');
        expect(domainName.substring(0, prefix.length).toLowerCase()).toBe(prefix.toLowerCase());
      }
    }
  });

  // Test 5: At least N domain overrides exist (basic sanity)
  it('contains a substantial number of domain overrides (goto >= 100, robot >= 100)', () => {
    // Count goto domain override files
    const gotoDomainBase = path.join(DOMAIN_OVERRIDES_ROOT, 'goto/domains');
    let gotoCount = 0;
    const gotoPrefixes = fs.readdirSync(gotoDomainBase).filter(
      d => fs.statSync(path.join(gotoDomainBase, d)).isDirectory(),
    );
    for (const prefix of gotoPrefixes) {
      const files = fs.readdirSync(path.join(gotoDomainBase, prefix)).filter(f => f.endsWith('.js'));
      gotoCount += files.length;
    }

    // Count robot domain override directories (each country dir with index.js)
    const robotDomainBase = path.join(DOMAIN_OVERRIDES_ROOT, 'robot/domains');
    let robotCount = 0;
    const robotPrefixes = fs.readdirSync(robotDomainBase).filter(
      d => fs.statSync(path.join(robotDomainBase, d)).isDirectory(),
    );
    for (const prefix of robotPrefixes) {
      const domains = fs.readdirSync(path.join(robotDomainBase, prefix)).filter(
        d => fs.statSync(path.join(robotDomainBase, prefix, d)).isDirectory(),
      );
      for (const domain of domains) {
        const countries = fs.readdirSync(path.join(robotDomainBase, prefix, domain)).filter(
          d => fs.statSync(path.join(robotDomainBase, prefix, domain, d)).isDirectory(),
        );
        robotCount += countries.length;
      }
    }

    expect(gotoCount).toBeGreaterThanOrEqual(100);
    expect(robotCount).toBeGreaterThanOrEqual(100);
  });
});
