// Helpers facade class — delegates to sub-modules while preserving backward-compatible API
// Usage: const helper = new Helpers(context); helper.methodName(args);

const fetchModule = require('./fetch');
const domModule = require('./dom');
const waitModule = require('./wait');
const scrollModule = require('./scroll');
const domMutationModule = require('./dom-mutation');
const captchaModule = require('./captcha');
const iframeModule = require('./iframe');
const miscModule = require('./misc');

const { preCompileFunctions } = require('../navigation/navigationHelperLibrary');

(async () => {
  module.exports.YAML = await preCompileFunctions.getYAMLs();
})();

module.exports.Helpers = class Helpers {
  constructor(context) {
    this.context = context;
  }

  // === Fetch ===
  async backendFetch(url, options, useLambda) {
    return fetchModule.backendFetch(this.context, url, options, useLambda);
  }
  async fetch(url, headers, options, returnObj) {
    return fetchModule.helperFetch(this.context, url, headers, options, returnObj);
  }
  async fetchRetry(url, headers, options, returnObj, retries, successCallback, waitingTime, opts) {
    return fetchModule.fetchRetry(this.context, url, headers, options, returnObj, retries, successCallback, waitingTime, opts);
  }

  // === DOM ===
  async isValidCSS(selectorToCheck) {
    return domModule.isValidCSS(this.context, selectorToCheck);
  }
  async isValidXpath(selectorToCheck) {
    return domModule.isValidXpath(this.context, selectorToCheck);
  }
  async checkCSSSelector(selector) {
    return domModule.checkCSSSelector(this.context, selector);
  }
  async checkXpathSelector(selector) {
    return domModule.checkXpathSelector(this.context, selector);
  }
  async checkURLFor(substring) {
    return domModule.checkURLFor(this.context, substring);
  }
  async checkAndClick(selector, input, type) {
    return domModule.checkAndClick(this.context, selector, input, type);
  }
  async checkSelector(selector, type) {
    return domModule.checkSelector(this.context, selector, type);
  }
  async checkAndReturnProp(selector, type, property) {
    return domModule.checkAndReturnProp(this.context, selector, type, property);
  }
  async checkAndSetProp(selector, value, type, property) {
    return domModule.checkAndSetProp(this.context, selector, value, type, property);
  }
  async addAttributeToMatches(params) {
    return domModule.addAttributeToMatches(this.context, params);
  }
  async waitAndCount(selector, timeout) {
    return domModule.waitAndCount(this.context, selector, timeout);
  }

  // === Wait ===
  async optionalWait(selector, timeout, type) {
    return waitModule.optionalWait(this.context, selector, timeout, type);
  }
  async waitToDisappear(selector, options) {
    return waitModule.waitToDisappear(this.context, selector, options);
  }
  async waitForInDifferentContext(selector, documentSelector, options) {
    return waitModule.waitForInDifferentContext(this.context, selector, documentSelector, options);
  }
  async waitForFrameToLoad(selector, options) {
    return waitModule.waitForFrameToLoad(this.context, selector, options);
  }

  // === Scroll ===
  async scrollIntoView(elementSelectorCSS) {
    return scrollModule.scrollIntoView(this.context, elementSelectorCSS);
  }
  async scrollBy(elementSelectorCSS, coefficient) {
    return scrollModule.scrollBy(this.context, elementSelectorCSS, coefficient);
  }
  async scrollToElementUntil(elementSelectorCSS, stopXPath, options, stopCSS) {
    return scrollModule.scrollToElementUntil(this.context, elementSelectorCSS, stopXPath, options, stopCSS);
  }
  async getAllScrollablesBetweenElems(topElementCSS, targetElementCSS, doNotScrollXpath) {
    return scrollModule.getAllScrollablesBetweenElems(this.context, topElementCSS, targetElementCSS, doNotScrollXpath);
  }
  async scrollTarget(topElementCSS, targetElementCSS, stopXPath, doNotScrollXpath, options) {
    return scrollModule.scrollTarget(this.context, topElementCSS, targetElementCSS, stopXPath, doNotScrollXpath, options);
  }

  // === DOM Mutation ===
  async addItemToDocument(key, value, options) {
    return domMutationModule.addItemToDocument(this.context, key, value, options);
  }
  async addArrayToDocument(key, values, options) {
    return domMutationModule.addArrayToDocument(this.context, key, values, options);
  }
  async addJSONURLtoDocument(key, lastPartOnly) {
    return domMutationModule.addJSONURLtoDocument(this.context, key, lastPartOnly);
  }
  async addURLtoDocument(params) {
    return domMutationModule.addURLtoDocument(this.context, params);
  }
  async removeScriptsWhichContains(text) {
    return domMutationModule.removeScriptsWhichContains(this.context, text);
  }
  async moveShadowToMainDom(shadowRootCSSSelector, index) {
    return domMutationModule.moveShadowToMainDom(this.context, shadowRootCSSSelector, index);
  }
  async deleteDuplicateDOMElements(selectors) {
    return domMutationModule.deleteDuplicateDOMElements(this.context, selectors);
  }

  // === Captcha ===
  async waitBlocking(waitAfterNavObject) {
    return captchaModule.waitBlocking(this.context, waitAfterNavObject);
  }
  async solveCaptcha(captchaConfig, timeoutConfig) {
    return captchaModule.solveCaptcha(this.context, captchaConfig, timeoutConfig);
  }
  async gotoWithCaptchaSolver(url, options) {
    return captchaModule.gotoWithCaptchaSolver(this.context, url, options);
  }

  // === Iframe ===
  async searchInFrame(frameSelector, listToSearch) {
    return iframeModule.searchInFrame(this.context, frameSelector, listToSearch);
  }
  async searchInFullPage(frameSelector, listToSearch) {
    return iframeModule.searchInFullPage(this.context, frameSelector, listToSearch);
  }

  // === Misc ===
  async throwError(errorMessage, options) {
    return miscModule.throwError(this.context, errorMessage, options);
  }
  async reload(timeoutOptions) {
    return miscModule.reload(this.context, timeoutOptions);
  }
  async make_opt_tags(params) {
    return miscModule.make_opt_tags(params);
  }
  async ifThereClickOnIt(selector, timeoutOptions, reloadPage) {
    return miscModule.ifThereClickOnIt(this.context, selector, timeoutOptions, reloadPage);
  }
  async goFromSearchToDetails(options) {
    return miscModule.goFromSearchToDetails(this.context, options);
  }
  async hijackRequests(restoreAfterCatch) {
    return miscModule.hijackRequests(this.context, restoreAfterCatch);
  }
  async randomClick(selectors) {
    return miscModule.randomClick(this.context, selectors);
  }
  async appendScreenCaptures(inputs, YAML, schemaYAML) {
    return miscModule.appendScreenCaptures(this.context, inputs, YAML, schemaYAML);
  }
  async addAttributeToExtractedRecords(attrParam, YAML) {
    return miscModule.addAttributeToExtractedRecords(this.context, attrParam, YAML);
  }
  getAllXPaths(rawData) {
    return miscModule.getAllXPaths(rawData);
  }
  async dropDownValue(CSSSelector, optionSubstring) {
    return miscModule.dropDownValue(this.context, CSSSelector, optionSubstring);
  }
};
